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
} from "../api/client";
import { TicketLifecycleActions } from "../components/TicketLifecycleActions";
import { useLiveRefresh } from "../hooks/useLiveRefresh";
import {
  completeCleaningQueued,
  getQueueStats,
  loadMyWorkCache,
  saveMyWorkCache,
  startCleaningQueued,
  subscribeOffline,
  type ConnMode,
  type QueueStats,
} from "../offline";

type Props = {
  user: AuthUser;
  locale?: "bg" | "en";
};

function t(locale: "bg" | "en", bg: string, en: string) {
  return locale === "en" ? en : bg;
}

function locationLabel(task: CleaningTaskRow): string {
  const b = task.location.floor.building.code;
  return `${b} ${task.location.number}`;
}

function ticketLocationLabel(ticket: MaintenanceTicket): string {
  const b = ticket.location.floor.building.code;
  return `${b} ${ticket.location.number}`;
}

function statusLabel(locale: "bg" | "en", status: string): string {
  const map: Record<string, [string, string]> = {
    assigned: ["Възложена", "Assigned"],
    in_progress: ["В ход", "In progress"],
    awaiting_inspection: ["Чака инспекция", "Awaiting inspection"],
    rework: ["Повторна работа", "Rework"],
    completed: ["Завършена", "Completed"],
    cancelled: ["Отказана", "Cancelled"],
    new: ["Нова", "New"],
    waiting: ["Изчакване", "Waiting"],
    resolved: ["Решена", "Resolved"],
  };
  const pair = map[status];
  if (!pair) return status;
  return locale === "en" ? pair[1] : pair[0];
}

function connLabel(locale: "bg" | "en", conn: ConnMode, pending: number): string {
  if (conn === "offline") return t(locale, "Офлайн", "Offline");
  if (conn === "syncing" || pending > 0) {
    return t(locale, `Синхронизация (${pending})`, `Syncing (${pending})`);
  }
  return t(locale, "Онлайн", "Online");
}

export function MyWorkPage({ user, locale = "bg" }: Props) {
  const [tasks, setTasks] = useState<CleaningTaskRow[]>([]);
  const [tickets, setTickets] = useState<MaintenanceTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [conn, setConn] = useState<ConnMode>("online");
  const [queueStats, setQueueStats] = useState<QueueStats>({
    pending: 0,
    failed: 0,
  });

  const canClean = canPerformAction(user, "cleaning.start");
  const canResolve = canResolveIssues(user.role);
  const showCleaning = canClean || user.role === "housekeeper" || user.role === "supervisor";
  const showTickets =
    canResolve || user.role === "technician" || user.role === "supervisor";

  const refresh = useCallback(async () => {
    const hotelDate = todayHotelDate();
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
    setFromCache(false);
    await saveMyWorkCache({
      tasks: taskData,
      tickets: ticketData,
      savedAt: Date.now(),
      hotelDate,
    });
  }, [showCleaning, showTickets]);

  useEffect(() => {
    return subscribeOffline((next) => {
      setConn(next.conn);
      setQueueStats(next.stats);
    });
  }, []);

  useEffect(() => {
    void getQueueStats().then(setQueueStats);
  }, []);

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

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);
        await refresh();
      } catch (err) {
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
          setError(err instanceof Error ? err.message : "Failed to load My Work");
        }
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeTasks = useMemo(() => {
    const order = ["in_progress", "rework", "assigned", "awaiting_inspection"];
    return [...tasks].sort(
      (a, b) => order.indexOf(a.status) - order.indexOf(b.status),
    );
  }, [tasks]);

  const currentTask = activeTasks.find((task) =>
    task.sessions.some((s) => s.status === "running"),
  );

  async function runBusy(id: string, fn: () => Promise<void>) {
    setBusyId(id);
    setError(null);
    setMessage(null);
    try {
      await fn();
      setQueueStats(await getQueueStats());
      try {
        await refresh();
      } catch {
        /* offline ok */
      }
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
            {liveAt
              ? ` · ${t(locale, "обновено", "updated")} ${new Date(liveAt).toLocaleTimeString()}`
              : ""}
          </p>
        </div>
        <div
          className={`mywork-conn mywork-conn-${conn === "offline" ? "offline" : queueStats.pending ? "syncing" : "online"}`}
          role="status"
        >
          {connLabel(locale, conn, queueStats.pending)}
        </div>
      </header>

      {message && <div className="banner ok">{message}</div>}
      {error && <div className="banner error">{error}</div>}
      {fromCache && (
        <div className="banner warn">
          {t(locale, "Данните може да са остарели", "Data may be stale")}
        </div>
      )}
      {queueStats.failed > 0 && (
        <div className="banner error">
          {t(
            locale,
            `${queueStats.failed} действия в опашката са неуспешни`,
            `${queueStats.failed} queued actions failed`,
          )}
        </div>
      )}

      {loading ? (
        <p className="muted">{t(locale, "Зареждане…", "Loading…")}</p>
      ) : (
        <>
          {currentTask && (
            <section className="mywork-section">
              <h2>{t(locale, "Текущо", "Current")}</h2>
              <TaskCard
                task={currentTask}
                locale={locale}
                busy={busyId === currentTask.id}
                onStart={() => undefined}
                onComplete={(notes) =>
                  runBusy(currentTask.id, async () => {
                    const running = currentTask.sessions.find(
                      (s) => s.status === "running",
                    );
                    if (!running) throw new Error("No running session");
                    const result = await completeCleaningQueued(
                      running.id,
                      notes,
                    );
                    setMessage(
                      result.queued
                        ? t(locale, "Приключване в опашката", "Complete queued")
                        : t(locale, "Сесията е приключена", "Session completed"),
                    );
                  })
                }
              />
            </section>
          )}

          {showCleaning && (
            <section className="mywork-section">
              <h2>{t(locale, "Почистване", "Cleaning")}</h2>
              {activeTasks.length === 0 ? (
                <p className="muted">
                  {t(locale, "Няма възложени задачи", "No assigned tasks")}
                </p>
              ) : (
                <div className="mywork-cards">
                  {activeTasks
                    .filter((task) => task.id !== currentTask?.id)
                    .map((task) => {
                      const running = task.sessions.find(
                        (s) => s.status === "running",
                      );
                      return (
                        <TaskCard
                          key={task.id}
                          task={task}
                          locale={locale}
                          busy={busyId === task.id}
                          onStart={() =>
                            runBusy(task.id, async () => {
                              const result = await startCleaningQueued(
                                task.id,
                                task.version,
                              );
                              setMessage(
                                result.queued
                                  ? t(
                                      locale,
                                      "Старт в опашката",
                                      "Start queued",
                                    )
                                  : t(locale, "Задачата е стартирана", "Started"),
                              );
                            })
                          }
                          onComplete={(notes) =>
                            runBusy(task.id, async () => {
                              if (!running) throw new Error("No running session");
                              const result = await completeCleaningQueued(
                                running.id,
                                notes,
                              );
                              setMessage(
                                result.queued
                                  ? t(
                                      locale,
                                      "Приключване в опашката",
                                      "Complete queued",
                                    )
                                  : t(
                                      locale,
                                      "Сесията е приключена",
                                      "Session completed",
                                    ),
                              );
                            })
                          }
                        />
                      );
                    })}
                </div>
              )}
            </section>
          )}

          {showTickets && (
            <section className="mywork-section">
              <h2>{t(locale, "Повреди", "Repairs")}</h2>
              {tickets.length === 0 ? (
                <p className="muted">
                  {t(locale, "Няма назначени тикети", "No assigned tickets")}
                </p>
              ) : (
                <div className="mywork-cards">
                  {tickets.map((ticket) => (
                    <article key={ticket.id} className="mywork-card">
                      <div className="mywork-card-top">
                        <strong>{ticketLocationLabel(ticket)}</strong>
                        <span className={`pill status-${ticket.status}`}>
                          {statusLabel(locale, ticket.status)}
                        </span>
                      </div>
                      <p>{ticket.title}</p>
                      <p className="muted">
                        {ticket.priority}
                        {ticket.blocksRoom
                          ? ` · ${t(locale, "блокира стая", "blocks room")}`
                          : ""}
                      </p>
                      <TicketLifecycleActions
                        ticket={ticket}
                        busy={busyId === ticket.id}
                        canResolve={canResolve}
                        onBusy={setBusyId}
                        onDone={(msg) => {
                          setMessage(msg);
                          void refresh().catch(() => undefined);
                        }}
                        onError={setError}
                      />
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function TaskCard({
  task,
  locale,
  busy,
  onStart,
  onComplete,
}: {
  task: CleaningTaskRow;
  locale: "bg" | "en";
  busy: boolean;
  onStart: () => void;
  onComplete: (notes?: string) => void;
}) {
  const running = task.sessions.find((s) => s.status === "running");
  const lastReject = task.inspections.find((i) => i.result === "rejected");
  const canStart =
    (task.status === "assigned" || task.status === "rework") && !running;
  const canComplete = Boolean(running);

  return (
    <article
      className={`mywork-card${task.status === "rework" ? " mywork-card-rework" : ""}${running ? " mywork-card-current" : ""}`}
    >
      <div className="mywork-card-top">
        <strong>{locationLabel(task)}</strong>
        <span className={`pill status-${task.status}`}>
          {statusLabel(locale, task.status)}
        </span>
      </div>
      <p className="muted">
        {task.priority}
        {task.location.kind === "common_area"
          ? ` · ${t(locale, "обща част", "common area")}`
          : ""}
      </p>
      {task.status === "rework" && lastReject?.findings && (
        <p className="mywork-findings">
          {t(locale, "Забележки", "Findings")}: {lastReject.findings}
        </p>
      )}
      <div className="mywork-actions">
        {canStart && (
          <button
            type="button"
            className="mywork-btn primary"
            disabled={busy}
            onClick={onStart}
          >
            {t(locale, "Начало", "Start")}
          </button>
        )}
        {canComplete && (
          <button
            type="button"
            className="mywork-btn primary"
            disabled={busy}
            onClick={() => {
              const notes = window.prompt(
                t(locale, "Бележки (опционално)", "Notes (optional)"),
              );
              if (notes === null) return;
              onComplete(notes.trim() || undefined);
            }}
          >
            {t(locale, "Приключи", "Complete")}
          </button>
        )}
        {task.status === "awaiting_inspection" && (
          <span className="muted">
            {t(locale, "Чака проверка", "Waiting for inspection")}
          </span>
        )}
      </div>
    </article>
  );
}
