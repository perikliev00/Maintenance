/**
 * Worker home: mine cleaning tasks + repair tickets with offline cache and
 * outbox. Falls back to IndexedDB cache when fetch fails; cleaning start/
 * complete go through `*Queued` helpers. Sections are role/capability gated.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  canPerformAction,
  // Support the surrounding logic for this step.
  fetchMyWork,
  // Support the surrounding logic for this step.
  todayHotelDate,
  // Declare type alias AuthUser.
  type AuthUser,
  // Declare type alias CleaningTaskRow.
  type CleaningTaskRow,
  // Declare type alias MaintenanceTicket.
  type MaintenanceTicket,
// Support the surrounding logic for this step.
} from "../../api/client";
// Import module dependency from ../../components/LoadingIndicator.
import { LoadingIndicator } from "../../components/LoadingIndicator";
// Import module dependency from ../../components/OutboxIssuesPanel.
import { OutboxIssuesPanel } from "../../components/OutboxIssuesPanel";
// Import module dependency from ../../hooks/useLiveRefresh.
import { useLiveRefresh } from "../../hooks/useLiveRefresh";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  completeCleaningQueued,
  // Support the surrounding logic for this step.
  startCleaningQueued,
// Support the surrounding logic for this step.
} from "../../offline/mutations";
// Import module dependency from ../../offline/session.
import { loadMyWorkCache, saveMyWorkCache } from "../../offline/session";
// Import module dependency from ../../hooks/useOfflineStatus.
import { useOfflineStatus } from "../../hooks/useOfflineStatus";
// Import module dependency from ./labels.
import { t } from "./labels";
// Import module dependency from ../../components/offline/ConnStatusBadge.
import { ConnStatusBadge } from "../../components/offline/ConnStatusBadge";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  CleaningTasksSection,
  // Support the surrounding logic for this step.
  CurrentTaskSection,
// Support the surrounding logic for this step.
} from "./tasks";
// Import module dependency from ./tickets.
import { TicketsSection } from "./tickets";
// Import module dependency from ./pendingSyncFromOutbox.
import { listPendingSyncTaskIdsFromOutbox } from "./pendingSyncFromOutbox";

// Declare type alias Props.
type Props = {
  // Provide user field used by this structure.
  user: AuthUser;
  // Support the surrounding logic for this step.
  locale?: "bg" | "en";
};

/**
 * Worker home: mine cleaning tasks + repair tickets with offline cache and
 * outbox. Falls back to IndexedDB when fetch fails; start/complete go through queues.
 */
export function MyWorkPage({ user, locale = "bg" }: Props) {
  // Mine cleaning tasks and open repair tickets.
  const [tasks, setTasks] = useState<CleaningTaskRow[]>([]);
  // React state slot for local UI/data that can change over time.
  const [tickets, setTickets] = useState<MaintenanceTicket[]>([]);
  // React state slot for local UI/data that can change over time.
  const [ticketCursor, setTicketCursor] = useState<string | null>(null);
  // React state slot for local UI/data that can change over time.
  const [loadingTickets, setLoadingTickets] = useState(false);
  // Hold a mutable ref that persists across renders without re-render.
  const requestRevision = useRef(0);
  // React state slot for local UI/data that can change over time.
  const [loading, setLoading] = useState(true);
  // React state slot for local UI/data that can change over time.
  const [error, setError] = useState<string | null>(null);
  // React state slot for local UI/data that can change over time.
  const [message, setMessage] = useState<string | null>(null);
  // Per-row busy id for start/complete/ticket actions.
  const [busyId, setBusyId] = useState<string | null>(null);
  // True when UI is serving IndexedDB snapshot after a failed fetch.
  const [fromCache, setFromCache] = useState(false);
  // Task ids with a queued start still pending sync.
  const [pendingSyncTaskIds, setPendingSyncTaskIds] = useState<string[]>([]);
  // Capability gates use explicit grants when the session supplies them.
  const canClean = canPerformAction(user, "cleaning.start");
  // Bind canResolve for use in the following logic.
  const canResolve = canPerformAction(user, "tickets.resolve");
  // Role fallbacks keep housekeeper/technician UIs visible even if grants lag.
  const showCleaning =
    // Support the surrounding logic for this step.
    canClean || user.role === "housekeeper" || user.role === "supervisor";
  // Bind showTickets for use in the following logic.
  const showTickets = canResolve;

  /**
   * Fetch mine tasks/tickets and persist them to the offline cache.
   * Skips either fetch when the corresponding section is hidden.
   */
  const refresh = useCallback(async () => {
    // Bind revision for use in the following logic.
    const revision = ++requestRevision.current;
    // Update React state so the UI reflects the new value.
    setLoadingTickets(false);
    // Bind hotelDate for use in the following logic.
    const hotelDate = todayHotelDate();
    // Single aggregate endpoint: roster/shift filter + tech empty cleaning queue.
    const data = await fetchMyWork({ hotelDate });
    // Conditional branch for the case described by this guard.
    if (revision !== requestRevision.current) return;
    // Bind taskData for use in the following logic.
    const taskData = showCleaning ? data.tasks : ([] as CleaningTaskRow[]);
    // Bind ticketData for use in the following logic.
    const ticketData = showTickets
      // Support the surrounding logic for this step.
      ? data.tickets
      // Support the surrounding logic for this step.
      : ([] as MaintenanceTicket[]);
    // Update React state so the UI reflects the new value.
    setTasks(taskData);
    // Update React state so the UI reflects the new value.
    setTickets(ticketData);
    // Update React state so the UI reflects the new value.
    setTicketCursor(data.ticketNextCursor ?? null);
    // Fresh network data — clear cache marker, but keep pendingSync aligned
    // with the active user's outbox so a successful GET cannot re-enable start
    // while cleaning.start is still queued.
    setFromCache(false);
    // Update React state so the UI reflects the new value.
    setPendingSyncTaskIds(await listPendingSyncTaskIdsFromOutbox());
    // Write-through cache so offline reopen still has today's work.
    await saveMyWorkCache({
      // Provide tasks field used by this structure.
      tasks: taskData,
      // Provide tickets field used by this structure.
      tickets: ticketData,
      // Provide savedAt field used by this structure.
      savedAt: Date.now(),
      // Provide hotelDate field used by this structure.
      hotelDate: data.hotelDate || hotelDate,
    });
  // Support the surrounding logic for this step.
  }, [showCleaning, showTickets]);

  // Define function loadMoreTickets and its behavior.
  async function loadMoreTickets() {
    // Conditional branch for the case described by this guard.
    if (!ticketCursor || loadingTickets) return;
    // Bind revision for use in the following logic.
    const revision = ++requestRevision.current;
    // Update React state so the UI reflects the new value.
    setLoadingTickets(true);
    // Begin guarded block to catch runtime failures.
    try {
      // Bind data for use in the following logic.
      const data = await fetchMyWork({ hotelDate: todayHotelDate(), ticketCursor });
      // Conditional branch for the case described by this guard.
      if (revision !== requestRevision.current) return;
      // Map source items into a derived list for rendering or logic.
      const seen = new Set(tickets.map((ticket) => ticket.id));
      // Filter items down to those relevant for this view.
      const merged = [...tickets, ...data.tickets.filter((ticket) => !seen.has(ticket.id))];
      // Update React state so the UI reflects the new value.
      setTickets(merged);
      // Update React state so the UI reflects the new value.
      setTicketCursor(data.ticketNextCursor ?? null);
      // Wait for an async operation before continuing.
      await saveMyWorkCache({ tasks, tickets: merged, savedAt: Date.now(), hotelDate: data.hotelDate });
    // Support the surrounding logic for this step.
    } catch (err) {
      // Conditional branch for the case described by this guard.
      if (revision === requestRevision.current) {
        // Update React state so the UI reflects the new value.
        setError(err instanceof Error ? err.message : "Failed to load more repairs");
      }
    // Support the surrounding logic for this step.
    } finally {
      // Conditional branch for the case described by this guard.
      if (revision === requestRevision.current) setLoadingTickets(false);
    }
  }

  /**
   * Soft background refresh when online (used after outbox drain / live events).
   * No-ops while the browser reports offline.
   */
  const refreshInBackground = useCallback(() => {
    // Conditional branch for the case described by this guard.
    if (!navigator.onLine) return;
    // Fire-and-forget async work without awaiting in this path.
    void refresh().catch(() => undefined);
  // Support the surrounding logic for this step.
  }, [refresh]);

  // Bind a local value for the following logic.
  const { conn, queueStats, refreshQueueStats } = useOfflineStatus({
    // Provide onOnlineEmptyOutbox field used by this structure.
    onOnlineEmptyOutbox: refreshInBackground,
  });

  // Soft live refresh; failures keep the current (possibly cached) lists.
  const liveAt = useLiveRefresh(
    // Support the surrounding logic for this step.
    async () => {
      // Begin guarded block to catch runtime failures.
      try {
        // Wait for an async operation before continuing.
        await refresh();
        // Update React state so the UI reflects the new value.
        setError(null);
      // Support the surrounding logic for this step.
      } catch {
        /* keep cache */
      }
    },
    {
      // Provide enabled field used by this structure.
      enabled: !loading,
      // Provide busy field used by this structure.
      busy: busyId !== null,
      // Provide eventTypes field used by this structure.
      eventTypes: ["cleaning.changed", "ticket.changed", "location.changed"],
    },
  );

  // Mount-only load: network first, IndexedDB fallback on failure.
  useEffect(() => {
    // Support the surrounding logic for this step.
    (async () => {
      // Begin guarded block to catch runtime failures.
      try {
        // Update React state so the UI reflects the new value.
        setLoading(true);
        // Update React state so the UI reflects the new value.
        setError(null);
        // Wait for an async operation before continuing.
        await refresh();
      // Support the surrounding logic for this step.
      } catch (err) {
        // Offline / network failure: serve last successful snapshot if present.
        const cached = await loadMyWorkCache();
        // Conditional branch for the case described by this guard.
        if (cached) {
          // Update React state so the UI reflects the new value.
          setTasks(cached.tasks as CleaningTaskRow[]);
          // Update React state so the UI reflects the new value.
          setTickets(cached.tickets as MaintenanceTicket[]);
          // Update React state so the UI reflects the new value.
          setFromCache(true);
          // Update React state so the UI reflects the new value.
          setMessage(
            // Invoke t to perform this step.
            t(
              // Support the surrounding logic for this step.
              locale,
              // Support the surrounding logic for this step.
              "Показани са запазени данни (офлайн)",
              // Support the surrounding logic for this step.
              "Showing cached data (offline)",
            ),
          );
        // Support the surrounding logic for this step.
        } else {
          // Update React state so the UI reflects the new value.
          setError(
            // Support the surrounding logic for this step.
            err instanceof Error ? err.message : "Failed to load My Work",
          );
        }
      // Support the surrounding logic for this step.
      } finally {
        // Update React state so the UI reflects the new value.
        setLoading(false);
      }
    // Support the surrounding logic for this step.
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Active (non-completed/cancelled) tasks sorted by workflow status priority.
   */
  const activeTasks = useMemo(() => {
    // Initialize an array used by subsequent logic.
    const order = ["in_progress", "rework", "assigned", "awaiting_inspection"];
    // Return early result or rendered output from this path.
    return [...tasks]
      // Continue a chained call building on the previous expression.
      .filter((task) => task.status !== "completed" && task.status !== "cancelled")
      // Continue a chained call building on the previous expression.
      .sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  // Support the surrounding logic for this step.
  }, [tasks]);

  // Task that currently has a running cleaning session (if any).
  const currentTask = activeTasks.find((task) =>
    // Invoke task.sessions.some to perform this step.
    task.sessions.some((s) => s.status === "running"),
  );

  /**
   * Run a mutation under busyId and refresh outbox queue stats afterward.
   */
  async function runBusy(id: string, fn: () => Promise<void>) {
    // Update React state so the UI reflects the new value.
    setBusyId(id);
    // Update React state so the UI reflects the new value.
    setError(null);
    // Update React state so the UI reflects the new value.
    setMessage(null);
    // Begin guarded block to catch runtime failures.
    try {
      // Wait for an async operation before continuing.
      await fn();
      // Wait for an async operation before continuing.
      await refreshQueueStats();
    // Support the surrounding logic for this step.
    } catch (err) {
      // Update React state so the UI reflects the new value.
      setError(err instanceof Error ? err.message : "Action failed");
    // Support the surrounding logic for this step.
    } finally {
      // Update React state so the UI reflects the new value.
      setBusyId(null);
    }
  }

  // Return the JSX/UI tree for this render path.
  return (
    // Render a <div> element for layout or semantics.
    <div className="page mywork-page">
      <header className="page-header mywork-header">
        <div>
          <h1>{t(locale, "Моите задачи", "My Work")}</h1>
          <p className="muted">
            {user.fullName}
            {/* Live stamp when soft refresh last succeeded. */}
            {liveAt
              // Support the surrounding logic for this step.
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
        // Render a <div> element for layout or semantics.
        <div className="banner warn">
                    {t(locale, "Данните може да са остарели", "Data may be stale")}
        </div>
      )}
      {/* Outbox conflict/failed counts when present. */}
      <OutboxIssuesPanel
        // Pass locale prop/value into the element or config.
        locale={locale}
        // Pass conflictCount prop/value into the element or config.
        conflictCount={queueStats.conflict}
        // Pass failedCount prop/value into the element or config.
        failedCount={queueStats.failed}
      />

      {/* Loading gate vs work sections. */}
      {loading ? (
        // Render LoadingIndicator as part of this view composition.
        <LoadingIndicator label={t(locale, "Зареждане…", "Loading…")} />
      // Support the surrounding logic for this step.
      ) : (
        // Open a React fragment to group children without an extra DOM node.
        <>
          {/* Highlighted current running session, if any. */}
          {currentTask && (
            // Render CurrentTaskSection as part of this view composition.
            <CurrentTaskSection
              // Pass locale prop/value into the element or config.
              locale={locale}
              // Pass currentTask prop/value into the element or config.
              currentTask={currentTask}
              // Pass busy prop/value into the element or config.
              busy={busyId === currentTask.id}
              // Pass pendingSync prop/value into the element or config.
              pendingSync={pendingSyncTaskIds.includes(currentTask.id)}
              // Pass onComplete prop/value into the element or config.
              onComplete={(notes) =>
                // Invoke runBusy to perform this step.
                runBusy(currentTask.id, async () => {
                  // Require a running session to complete.
                  const running = currentTask.sessions.find(
                    // Support the surrounding logic for this step.
                    (s) => s.status === "running",
                  );
                  // Conditional branch for the case described by this guard.
                  if (!running) throw new Error("No running session");
                  // Queue-aware complete (may stay offline).
                  const result = await completeCleaningQueued(
                    // Support the surrounding logic for this step.
                    running.id,
                    // Support the surrounding logic for this step.
                    notes,
                    // Support the surrounding logic for this step.
                    currentTask.version,
                    // Support the surrounding logic for this step.
                    currentTask.id,
                  );
                  // Optimistic local status update.
                  setTasks((prev) =>
                    // Invoke prev.map to perform this step.
                    prev.map((task) =>
                      // Support the surrounding logic for this step.
                      task.id === currentTask.id
                        // Support the surrounding logic for this step.
                        ? {
                            // Spread prior fields/items so overrides can layer cleanly.
                            ...task,
                            // Provide status field used by this structure.
                            status: "completed",
                            // Provide sessions field used by this structure.
                            sessions: task.sessions.map((s) =>
                              // Support the surrounding logic for this step.
                              s.id === running.id
                                // Support the surrounding logic for this step.
                                ? { ...s, status: "completed" as const }
                                // Support the surrounding logic for this step.
                                : s,
                            ),
                          }
                        // Support the surrounding logic for this step.
                        : task,
                    ),
                  );
                  // Conditional branch for the case described by this guard.
                  if (result.queued) {
                    // Update React state so the UI reflects the new value.
                    setPendingSyncTaskIds((ids) =>
                      // Invoke ids.includes to perform this step.
                      ids.includes(currentTask.id)
                        // Support the surrounding logic for this step.
                        ? ids
                        // Support the surrounding logic for this step.
                        : [...ids, currentTask.id],
                    );
                  }
                  // Update React state so the UI reflects the new value.
                  setMessage(
                    // Support the surrounding logic for this step.
                    result.queued
                      // Support the surrounding logic for this step.
                      ? t(locale, "Приключване в опашката", "Complete queued")
                      // Support the surrounding logic for this step.
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
            // Render CleaningTasksSection as part of this view composition.
            <CleaningTasksSection
              // Pass locale prop/value into the element or config.
              locale={locale}
              // Pass activeTasks prop/value into the element or config.
              activeTasks={activeTasks}
              // Pass currentTaskId prop/value into the element or config.
              currentTaskId={currentTask?.id}
              // Pass busyId prop/value into the element or config.
              busyId={busyId}
              // Pass pendingSyncTaskIds prop/value into the element or config.
              pendingSyncTaskIds={pendingSyncTaskIds}
              // Pass onStart prop/value into the element or config.
              onStart={(task) =>
                // Invoke runBusy to perform this step.
                runBusy(task.id, async () => {
                  // Queue-aware start; may only update local state when queued.
                  const result = await startCleaningQueued(
                    // Support the surrounding logic for this step.
                    task.id,
                    // Support the surrounding logic for this step.
                    task.version,
                  );
                  // Conditional branch for the case described by this guard.
                  if (result.queued) {
                    // Track pending sync and mark in_progress locally.
                    setPendingSyncTaskIds((ids) =>
                      // Invoke ids.includes to perform this step.
                      ids.includes(task.id) ? ids : [...ids, task.id],
                    );
                    // Update React state so the UI reflects the new value.
                    setTasks((prev) =>
                      // Invoke prev.map to perform this step.
                      prev.map((row) =>
                        // Support the surrounding logic for this step.
                        row.id === task.id
                          // Support the surrounding logic for this step.
                          ? { ...row, status: "in_progress" }
                          // Support the surrounding logic for this step.
                          : row,
                      ),
                    );
                  }
                  // Update React state so the UI reflects the new value.
                  setMessage(
                    // Support the surrounding logic for this step.
                    result.queued
                      // Support the surrounding logic for this step.
                      ? t(locale, "Старт в опашката", "Start queued")
                      // Support the surrounding logic for this step.
                      : t(locale, "Задачата е стартирана", "Started"),
                  );
                  // Conditional branch for the case described by this guard.
                  if (!result.queued) refreshInBackground();
                })
              }
              // Pass onComplete prop/value into the element or config.
              onComplete={(task, notes) =>
                // Invoke runBusy to perform this step.
                runBusy(task.id, async () => {
                  // Find the first matching item for this lookup.
                  const running = task.sessions.find(
                    // Support the surrounding logic for this step.
                    (s) => s.status === "running",
                  );
                  // Conditional branch for the case described by this guard.
                  if (!running) throw new Error("No running session");
                  // Bind result for use in the following logic.
                  const result = await completeCleaningQueued(
                    // Support the surrounding logic for this step.
                    running.id,
                    // Support the surrounding logic for this step.
                    notes,
                    // Support the surrounding logic for this step.
                    task.version,
                    // Support the surrounding logic for this step.
                    task.id,
                  );
                  // Optimistic complete of the running session locally.
                  setTasks((prev) =>
                    // Invoke prev.map to perform this step.
                    prev.map((row) =>
                      // Support the surrounding logic for this step.
                      row.id === task.id
                        // Support the surrounding logic for this step.
                        ? {
                            // Spread prior fields/items so overrides can layer cleanly.
                            ...row,
                            // Provide status field used by this structure.
                            status: "completed",
                            // Provide sessions field used by this structure.
                            sessions: row.sessions.map((s) =>
                              // Support the surrounding logic for this step.
                              s.id === running.id
                                // Support the surrounding logic for this step.
                                ? {
                                    // Spread prior fields/items so overrides can layer cleanly.
                                    ...s,
                                    // Provide status field used by this structure.
                                    status: "completed" as const,
                                  }
                                // Support the surrounding logic for this step.
                                : s,
                            ),
                          }
                        // Support the surrounding logic for this step.
                        : row,
                    ),
                  );
                  // Conditional branch for the case described by this guard.
                  if (result.queued) {
                    // Update React state so the UI reflects the new value.
                    setPendingSyncTaskIds((ids) =>
                      // Invoke ids.includes to perform this step.
                      ids.includes(task.id) ? ids : [...ids, task.id],
                    );
                  }
                  // Update React state so the UI reflects the new value.
                  setMessage(
                    // Support the surrounding logic for this step.
                    result.queued
                      // Support the surrounding logic for this step.
                      ? t(locale, "Приключване в опашката", "Complete queued")
                      // Support the surrounding logic for this step.
                      : t(locale, "Сесията е приключена", "Session completed"),
                  );
                  // Conditional branch for the case described by this guard.
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
              // Pass locale prop/value into the element or config.
              locale={locale}
              // Pass tickets prop/value into the element or config.
              tickets={tickets}
              // Pass busyId prop/value into the element or config.
              busyId={busyId}
              // Pass canResolve prop/value into the element or config.
              canResolve={canResolve}
              // Pass onBusy prop/value into the element or config.
              onBusy={setBusyId}
              // Pass onDone prop/value into the element or config.
              onDone={(ticket, result) => {
                // Update React state so the UI reflects the new value.
                setMessage(result.message);
                // Drop resolved tickets from the open list; else patch status.
                setTickets((prev) => {
                  // Conditional branch for the case described by this guard.
                  if (result.nextStatus === "resolved") {
                    // Return early result or rendered output from this path.
                    return prev.filter((row) => row.id !== ticket.id);
                  }
                  // Return early result or rendered output from this path.
                  return prev.map((row) =>
                    // Support the surrounding logic for this step.
                    row.id === ticket.id
                      // Support the surrounding logic for this step.
                      ? { ...row, status: result.nextStatus }
                      // Support the surrounding logic for this step.
                      : row,
                  );
                });
                // Conditional branch for the case described by this guard.
                if (!result.queued) refreshInBackground();
              }}
              // Pass onError prop/value into the element or config.
              onError={setError}
            />
                        {ticketCursor && !fromCache && (
              // Render a <button> element for layout or semantics.
              <button type="button" className="btn" disabled={loadingTickets || busyId !== null}
                // Pass onClick prop/value into the element or config.
                onClick={() => void loadMoreTickets()}>
                                {loadingTickets ? (
                  // Render LoadingIndicator as part of this view composition.
                  <LoadingIndicator
                    // Pass variant prop/value into the element or config.
                    variant="inline"
                    // Pass delayMs prop/value into the element or config.
                    delayMs={0}
                    // Pass label prop/value into the element or config.
                    label={t(locale, "Зареждане…", "Loading…")}
                  />
                // Support the surrounding logic for this step.
                ) : (
                  // Invoke t to perform this step.
                  t(locale, "Още ремонти", "Load more repairs")
                )}
              </button>
            )}
            </>
          )}
        </>
      )}
    </div>
  );
}
