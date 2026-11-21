/**
 * Worker home: mine cleaning tasks + repair tickets with offline cache and
 * outbox. Falls back to IndexedDB cache when fetch fails; cleaning start/
 * complete go through `*Queued` helpers. Sections are role/capability gated.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  canPerformAction,
  fetchMyWork,
  todayHotelDate,
  type AuthUser,
  type CleaningTaskRow,
  type MaintenanceTicket,
} from "../../api/client";
import { LoadingIndicator } from "../../components/LoadingIndicator";
import { OutboxIssuesPanel } from "../../components/OutboxIssuesPanel";
import { useLiveRefresh } from "../../hooks/useLiveRefresh";
import {
  completeCleaningQueued,
  startCleaningQueued,
} from "../../offline/mutations";
import { loadMyWorkCache, saveMyWorkCache } from "../../offline/session";
import { useOfflineStatus } from "../../hooks/useOfflineStatus";
import { t } from "./labels";
import { ConnStatusBadge } from "../../components/offline/ConnStatusBadge";
import {
  CleaningTasksSection,
  CurrentTaskSection,
} from "./tasks";
import { TicketsSection } from "./tickets";
import { listPendingSyncTaskIdsFromOutbox } from "./pendingSyncFromOutbox";

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
  const [ticketCursor, setTicketCursor] = useState<string | null>(null);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const requestRevision = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Per-row busy id for start/complete/ticket actions.
  const [busyId, setBusyId] = useState<string | null>(null);
  // True when UI is serving IndexedDB snapshot after a failed fetch.
  const [fromCache, setFromCache] = useState(false);
  // Task ids with a queued start still pending sync.
  const [pendingSyncTaskIds, setPendingSyncTaskIds] = useState<string[]>([]);
  // Capability gates use explicit grants when the session supplies them.
  const canClean = canPerformAction(user, "cleaning.start");
  const canResolve = canPerformAction(user, "tickets.resolve");
  // Role fallbacks keep housekeeper/technician UIs visible even if grants lag.
  const showCleaning =
    canClean || user.role === "housekeeper" || user.role === "supervisor";
  const showTickets = canResolve;

  /**
   * Fetch mine tasks/tickets and persist them to the offline cache.
   * Skips either fetch when the corresponding section is hidden.
   */
  const refresh = useCallback(async () => {
    const revision = ++requestRevision.current;
    setLoadingTickets(false);
    const hotelDate = todayHotelDate();
    // Single aggregate endpoint: roster/shift filter + tech empty cleaning queue.
    const data = await fetchMyWork({ hotelDate });
    if (revision !== requestRevision.current) return;
    const taskData = showCleaning ? data.tasks : ([] as CleaningTaskRow[]);
    const ticketData = showTickets
      ? data.tickets
      : ([] as MaintenanceTicket[]);
    setTasks(taskData);
    setTickets(ticketData);
    setTicketCursor(data.ticketNextCursor ?? null);
    // Fresh network data — clear cache marker, but keep pendingSync aligned
    // with the active user's outbox so a successful GET cannot re-enable start
    // while cleaning.start is still queued.
    setFromCache(false);
    setPendingSyncTaskIds(await listPendingSyncTaskIdsFromOutbox());
    // Write-through cache so offline reopen still has today's work.
    await saveMyWorkCache({
      tasks: taskData,
      tickets: ticketData,
      savedAt: Date.now(),
      hotelDate: data.hotelDate || hotelDate,
    });
  }, [showCleaning, showTickets]);

  // Define function loadMoreTickets and its behavior.
  async function loadMoreTickets() {
    if (!ticketCursor || loadingTickets) return;
    const revision = ++requestRevision.current;
    setLoadingTickets(true);
    try {
      const data = await fetchMyWork({ hotelDate: todayHotelDate(), ticketCursor });
      if (revision !== requestRevision.current) return;
      // Map source items into a derived list for rendering or logic.
      const seen = new Set(tickets.map((ticket) => ticket.id));
      // Filter items down to those relevant for this view.
      const merged = [...tickets, ...data.tickets.filter((ticket) => !seen.has(ticket.id))];
      setTickets(merged);
      setTicketCursor(data.ticketNextCursor ?? null);
      await saveMyWorkCache({ tasks, tickets: merged, savedAt: Date.now(), hotelDate: data.hotelDate });
    } catch (err) {
      if (revision === requestRevision.current) {
        setError(err instanceof Error ? err.message : "Failed to load more repairs");
      }
    } finally {
      if (revision === requestRevision.current) setLoadingTickets(false);
    }
  }

  /**
   * Soft background refresh when online (used after outbox drain / live events).
   * No-ops while the browser reports offline.
   */
  const refreshInBackground = useCallback(() => {
    if (!navigator.onLine) return;
    // Fire-and-forget async work without awaiting in this path.
    void refresh().catch(() => undefined);
  }, [refresh]);

  const { conn, queueStats, refreshQueueStats } = useOfflineStatus({
    onOnlineEmptyOutbox: refreshInBackground,
  });

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
      await refreshQueueStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="content ui-my-work">
      <header className="page-header ui-briefing">
        <div>
          <p className="ui-eyebrow">{t(locale, "ЛИЧЕН РАБОТЕН ПЛАН", "YOUR WORKDAY")}</p>
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
      {message && <div className="banner ok" role="status">{message}</div>}
      {error && <div className="banner error" role="alert">{error}</div>}
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
        <LoadingIndicator label={t(locale, "Зареждане…", "Loading…")} />
      ) : (
        // Open a React fragment to group children without an extra DOM node.
        <>
          <section className="ui-metrics" aria-label={t(locale, "Вашата работа", "Your workload")}>
            {showCleaning && <div className="ui-metric"><span>{t(locale, "Задачи за почистване", "Cleaning assignments")}</span><strong>{activeTasks.length}</strong><small>{t(locale, "Активни задачи за деня", "Active tasks for the day")}</small></div>}
            {showTickets && <div className="ui-metric"><span>{t(locale, "Възложени ремонти", "Assigned repairs")}</span><strong>{tickets.length}</strong><small>{ticketCursor ? t(locale, "Заредени · има още", "Loaded · more available") : t(locale, "Заредени отворени тикети", "Loaded open tickets")}</small></div>}
            <div className="ui-metric"><span>{t(locale, "Чакащи синхронизация", "Awaiting synchronization")}</span><strong>{queueStats.pending + queueStats.sending + queueStats.failed + queueStats.conflict}</strong><small>{t(locale, "Действия в локалната опашка", "Actions in the local outbox")}</small></div>
          </section>
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
                    currentTask.id,
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
                  if (result.queued) {
                    setPendingSyncTaskIds((ids) =>
                      ids.includes(currentTask.id)
                        ? ids
                        : [...ids, currentTask.id],
                    );
                  }
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
                  // Find the first matching item for this lookup.
                  const running = task.sessions.find(
                    (s) => s.status === "running",
                  );
                  if (!running) throw new Error("No running session");
                  const result = await completeCleaningQueued(
                    running.id,
                    notes,
                    task.version,
                    task.id,
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
                  if (result.queued) {
                    setPendingSyncTaskIds((ids) =>
                      ids.includes(task.id) ? ids : [...ids, task.id],
                    );
                  }
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
            // Open a React fragment to group children without an extra DOM node.
            <>
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
                        {ticketCursor && !fromCache && (
              <button type="button" className="btn" disabled={loadingTickets || busyId !== null}
                onClick={() => void loadMoreTickets()}>
                                {loadingTickets ? (
                  <LoadingIndicator
                    variant="inline"
                    delayMs={0}
                    label={t(locale, "Зареждане…", "Loading…")}
                  />
                ) : (
                  t(locale, "Още ремонти", "Load more repairs")
                )}
              </button>
            )}
            </>
          )}
        </>
      )}
    </main>
  );
}
