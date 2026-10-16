/**
 * Worker home: mine cleaning tasks + repair tickets with offline cache and
 * outbox. Falls back to IndexedDB cache when fetch fails; cleaning start/
 * complete go through `*Queued` helpers. Sections are role/capability gated.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  canPerformAction,
  canResolveIssues,
  fetchCleaningTasks,
  fetchTickets,
  todayHotelDate,
  type AuthUser,
  type CleaningTaskRow,
  type MaintenanceTicket,
} from "../../api/client";
import { OutboxIssuesPanel } from "../../components/OutboxIssuesPanel";
import { useLiveRefresh } from "../../hooks/useLiveRefresh";
import {
  completeCleaningQueued,
  getQueueStats,
  loadMyWorkCache,
  saveMyWorkCache,
  startCleaningQueued,
  subscribeOffline,
  type ConnMode,
  type QueueStats,
} from "../../offline";
import { t } from "./labels";
import { ConnStatusBadge } from "./offlineCache";
import {
  CleaningTasksSection,
  CurrentTaskSection,
} from "./tasks";
import { TicketsSection } from "./tickets";

type Props = {
  user: AuthUser;
  locale?: "bg" | "en";
};

/**
 * Worker home: mine cleaning tasks + repair tickets with offline cache and
 * outbox. Falls back to IndexedDB when fetch fails; start/complete go through queues.
 */
export function MyWorkPage({ user, locale = "bg" }: Props) {
  // Mine cleaning tasks and open repair tickets.
  const [tasks, setTasks] = useState<CleaningTaskRow[]>([]);
  const [tickets, setTickets] = useState<MaintenanceTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Per-row busy id for start/complete/ticket actions.
  const [busyId, setBusyId] = useState<string | null>(null);
  // True when UI is serving IndexedDB snapshot after a failed fetch.
  const [fromCache, setFromCache] = useState(false);
  // Task ids with a queued start still pending sync.
  const [pendingSyncTaskIds, setPendingSyncTaskIds] = useState<string[]>([]);
  const [conn, setConn] = useState<ConnMode>("online");
  const [queueStats, setQueueStats] = useState<QueueStats>({
    pending: 0,
    sending: 0,
    conflict: 0,
    failed: 0,
  });

  // Capability gates; role fallbacks keep HK/tech UIs visible if grants lag.
  const canClean = canPerformAction(user, "cleaning.start");
  const canResolve = canResolveIssues(user.role);
  // Role fallbacks keep housekeeper/technician UIs visible even if grants lag.
  const showCleaning =
    canClean || user.role === "housekeeper" || user.role === "supervisor";
  const showTickets =
    canResolve || user.role === "technician" || user.role === "supervisor";

  /**
   * Fetch mine tasks/tickets and persist them to the offline cache.
   * Skips either fetch when the corresponding section is hidden.
   */
  const refresh = useCallback(async () => {
    const hotelDate = todayHotelDate();
    // Parallel mine fetches gated by section visibility.
    const [taskData, ticketData] = await Promise.all([
      showCleaning
        ? fetchCleaningTasks({
            mine: true,
            hotelDate,
            status: "assigned,rework,in_progress,awaiting_inspection",
          })
        : Promise.resolve([] as CleaningTaskRow[]),
      showTickets
        ? fetchTickets({ mine: true, status: "open", limit: 50 })
        : Promise.resolve([] as MaintenanceTicket[]),
    ]);
    setTasks(taskData);
    setTickets(ticketData);
    // Fresh network data — clear cache/pending markers.
    setFromCache(false);
    setPendingSyncTaskIds([]);
    // Write-through cache so offline reopen still has today's work.
    await saveMyWorkCache({
      tasks: taskData,
      tickets: ticketData,
      savedAt: Date.now(),
      hotelDate,
    });
  }, [showCleaning, showTickets]);

  /**
   * Soft background refresh when online (used after outbox drain / live events).
   * No-ops while the browser reports offline.
   */
  const refreshInBackground = useCallback(() => {
    if (!navigator.onLine) return;
    void refresh().catch(() => undefined);
  }, [refresh]);

  // Subscribe to offline/conn + queue stats updates.
  useEffect(() => {
    return subscribeOffline((next) => {
      setConn(next.conn);
      setQueueStats(next.stats);
      // When back online with an empty outbox, pull fresh mine data.
      if (
        next.conn === "online" &&
        next.stats.pending === 0 &&
        next.stats.sending === 0
      ) {
        refreshInBackground();
      }
    });
  }, [refreshInBackground]);

  // Initial queue stats snapshot for the status badge.
  useEffect(() => {
    void getQueueStats().then(setQueueStats);
  }, []);

  // Soft live refresh; failures keep the current (possibly cached) lists.
  const liveAt = useLiveRefresh(
    async () => {
      try {
        await refresh();
        setError(null);
      } catch {
        /* keep cache */
      }
    },
    {
      enabled: !loading,
      busy: busyId !== null,
      eventTypes: ["cleaning.changed", "ticket.changed", "location.changed"],
    },
  );

  // Mount-only load: network first, IndexedDB fallback on failure.
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);
        await refresh();
      } catch (err) {
        // Offline / network failure: serve last successful snapshot if present.
        const cached = await loadMyWorkCache();
        if (cached) {
          setTasks(cached.tasks as CleaningTaskRow[]);
          setTickets(cached.tickets as MaintenanceTicket[]);
          setFromCache(true);
          setMessage(
            t(
              locale,
              "Показани са запазени данни (офлайн)",
              "Showing cached data (offline)",
            ),
          );
        } else {
          setError(
            err instanceof Error ? err.message : "Failed to load My Work",
          );
        }
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Active (non-completed/cancelled) tasks sorted by workflow status priority.
   */
  const activeTasks = useMemo(() => {
    const order = ["in_progress", "rework", "assigned", "awaiting_inspection"];
    return [...tasks]
      .filter((task) => task.status !== "completed" && task.status !== "cancelled")
      .sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  }, [tasks]);

  // Task that currently has a running cleaning session (if any).
  const currentTask = activeTasks.find((task) =>
    task.sessions.some((s) => s.status === "running"),
  );

  /**
   * Run a mutation under busyId and refresh outbox queue stats afterward.
   */
  async function runBusy(id: string, fn: () => Promise<void>) {
    setBusyId(id);
    setError(null);
    setMessage(null);
    try {
      await fn();
      setQueueStats(await getQueueStats());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="page mywork-page">
      <header className="page-header mywork-header">
        <div>
          <h1>{t(locale, "Моите задачи", "My Work")}</h1>
          <p className="muted">
            {user.fullName}
            {/* Live stamp when soft refresh last succeeded. */}
            {liveAt
              ? ` · ${t(locale, "обновено", "updated")} ${new Date(liveAt).toLocaleTimeString()}`
              : ""}
          </p>
        </div>
        <ConnStatusBadge locale={locale} conn={conn} queueStats={queueStats} />
      </header>

      {/* Success / error / stale-cache banners. */}
      {message && <div className="banner ok">{message}</div>}
      {error && <div className="banner error">{error}</div>}
      {fromCache && (
        <div className="banner warn">
          {t(locale, "Данните може да са остарели", "Data may be stale")}
        </div>
      )}
      {/* Outbox conflict/failed counts when present. */}
      <OutboxIssuesPanel
        locale={locale}
        conflictCount={queueStats.conflict}
        failedCount={queueStats.failed}
      />

      {/* Loading gate vs work sections. */}
      {loading ? (
        <p className="muted">{t(locale, "Зареждане…", "Loading…")}</p>
      ) : (
        <>
          {/* Highlighted current running session, if any. */}
          {currentTask && (
            <CurrentTaskSection
              locale={locale}
              currentTask={currentTask}
              busy={busyId === currentTask.id}
              pendingSync={pendingSyncTaskIds.includes(currentTask.id)}
              onComplete={(notes) =>
                runBusy(currentTask.id, async () => {
                  // Require a running session to complete.
                  const running = currentTask.sessions.find(
                    (s) => s.status === "running",
                  );
                  if (!running) throw new Error("No running session");
                  // Queue-aware complete (may stay offline).
                  const result = await completeCleaningQueued(
                    running.id,
                    notes,
                    currentTask.version,
                  );
                  // Optimistic local status update.
                  setTasks((prev) =>
                    prev.map((task) =>
                      task.id === currentTask.id
                        ? {
                            ...task,
                            status: "completed",
                            sessions: task.sessions.map((s) =>
                              s.id === running.id
                                ? { ...s, status: "completed" as const }
                                : s,
                            ),
                          }
                        : task,
                    ),
                  );
                  setMessage(
                    result.queued
                      ? t(locale, "Приключване в опашката", "Complete queued")
                      : t(locale, "Сесията е приключена", "Session completed"),
                  );
                  // Online success: soft refresh in background.
                  if (!result.queued) refreshInBackground();
                })
              }
            />
          )}

          {/* Cleaning task list — capability/role gated. */}
          {showCleaning && (
            <CleaningTasksSection
              locale={locale}
              activeTasks={activeTasks}
              currentTaskId={currentTask?.id}
              busyId={busyId}
              pendingSyncTaskIds={pendingSyncTaskIds}
              onStart={(task) =>
                runBusy(task.id, async () => {
                  // Queue-aware start; may only update local state when queued.
                  const result = await startCleaningQueued(
                    task.id,
                    task.version,
                  );
                  if (result.queued) {
                    // Track pending sync and mark in_progress locally.
                    setPendingSyncTaskIds((ids) =>
                      ids.includes(task.id) ? ids : [...ids, task.id],
                    );
                    setTasks((prev) =>
                      prev.map((row) =>
                        row.id === task.id
                          ? { ...row, status: "in_progress" }
                          : row,
                      ),
                    );
                  }
                  setMessage(
                    result.queued
                      ? t(locale, "Старт в опашката", "Start queued")
                      : t(locale, "Задачата е стартирана", "Started"),
                  );
                  if (!result.queued) refreshInBackground();
                })
              }
              onComplete={(task, notes) =>
                runBusy(task.id, async () => {
                  const running = task.sessions.find(
                    (s) => s.status === "running",
                  );
                  if (!running) throw new Error("No running session");
                  const result = await completeCleaningQueued(
                    running.id,
                    notes,
                    task.version,
                  );
                  // Optimistic complete of the running session locally.
                  setTasks((prev) =>
                    prev.map((row) =>
                      row.id === task.id
                        ? {
                            ...row,
                            status: "completed",
                            sessions: row.sessions.map((s) =>
                              s.id === running.id
                                ? {
                                    ...s,
                                    status: "completed" as const,
                                  }
                                : s,
                            ),
                          }
                        : row,
                    ),
                  );
                  setMessage(
                    result.queued
                      ? t(locale, "Приключване в опашката", "Complete queued")
                      : t(locale, "Сесията е приключена", "Session completed"),
                  );
                  if (!result.queued) refreshInBackground();
                })
              }
            />
          )}

          {/* Repair tickets section — capability/role gated. */}
          {showTickets && (
            <TicketsSection
              locale={locale}
              tickets={tickets}
              busyId={busyId}
              canResolve={canResolve}
              onBusy={setBusyId}
              onDone={(ticket, result) => {
                setMessage(result.message);
                // Drop resolved tickets from the open list; else patch status.
                setTickets((prev) => {
                  if (result.nextStatus === "resolved") {
                    return prev.filter((row) => row.id !== ticket.id);
                  }
                  return prev.map((row) =>
                    row.id === ticket.id
                      ? { ...row, status: result.nextStatus }
                      : row,
                  );
                });
                if (!result.queued) refreshInBackground();
              }}
              onError={setError}
            />
          )}
        </>
      )}
    </div>
  );
}
