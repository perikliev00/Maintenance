import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  assignIssue,
  canAssignIssues,
  canCloseIssues,
  canPerformAction,
  canResolveIssues,
  closeIssue,
  fetchIssueOptions,
  fetchMaintenanceCategories,
  fetchPeople,
  fetchRooms,
  fetchTicketEvents,
  fetchTickets,
  reportIssue,
  type AuthUser,
  type IssueOptionRow,
  type MaintenanceCategoryRow,
  type MaintenanceTicket,
  type Person,
  type Room,
} from "../api/client";
import { TicketLifecycleActions } from "../components/TicketLifecycleActions";
import { useLiveRefresh } from "../hooks/useLiveRefresh";
import {
  getQueueStats,
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

function locLabel(ticket: MaintenanceTicket): string {
  return `${ticket.location.floor.building.code} ${ticket.location.number}`;
}

export function RepairsPage({ user, locale = "bg" }: Props) {
  const [tickets, setTickets] = useState<MaintenanceTicket[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [categories, setCategories] = useState<MaintenanceCategoryRow[]>([]);
  const [options, setOptions] = useState<IssueOptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("open");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [slaOnly, setSlaOnly] = useState(false);
  const [blocksOnly, setBlocksOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<
    Array<{
      id: string;
      toStatus: string;
      fromStatus?: string | null;
      reason?: string | null;
      occurredAt: string;
      actor?: { fullName: string };
    }>
  >([]);
  const [conn, setConn] = useState<ConnMode>("online");
  const [queueStats, setQueueStats] = useState<QueueStats>({
    pending: 0,
    failed: 0,
  });

  // report form
  const [locationId, setLocationId] = useState("");
  const [issueOptionId, setIssueOptionId] = useState("");
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("normal");
  const [blocksRoom, setBlocksRoom] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const canResolve = canResolveIssues(user.role);
  const canAssign = canAssignIssues(user.role);
  const canClose = canCloseIssues(user.role);
  const canReport = canPerformAction(user, "tickets.report");

  const refresh = useCallback(async () => {
    const params: Parameters<typeof fetchTickets>[0] = {
      limit: 100,
      status: statusFilter as "open" | "all" | "resolved",
      slaBreached: slaOnly || undefined,
      blocksRoom: blocksOnly || undefined,
    };
    if (assigneeFilter === "mine") params.mine = true;
    else if (assigneeFilter !== "all") params.assigneeId = assigneeFilter;

    const [ticketData, roomData, catData, optData] = await Promise.all([
      fetchTickets(params),
      fetchRooms(),
      fetchMaintenanceCategories(),
      fetchIssueOptions(),
    ]);
    setTickets(ticketData);
    setRooms(roomData);
    setCategories(catData);
    setOptions(optData);
    if (!locationId && roomData[0]) setLocationId(roomData[0].id);
    if (!issueOptionId && optData[0]) {
      setIssueOptionId(optData[0].id);
      setTitle(optData[0].nameBg);
      if (optData[0].defaultPriority) setPriority(optData[0].defaultPriority);
      if (optData[0].defaultBlocksRoom != null) {
        setBlocksRoom(optData[0].defaultBlocksRoom);
      }
    }
  }, [
    statusFilter,
    assigneeFilter,
    slaOnly,
    blocksOnly,
    locationId,
    issueOptionId,
  ]);

  useEffect(() => {
    return subscribeOffline((next) => {
      setConn(next.conn);
      setQueueStats(next.stats);
    });
  }, []);

  useEffect(() => {
    void getQueueStats().then(setQueueStats);
  }, []);

  useEffect(() => {
    if (!canAssign) return;
    void fetchPeople()
      .then((rows) =>
        setPeople(
          rows.filter(
            (p) =>
              p.role === "technician" ||
              p.role === "supervisor" ||
              p.role === "manager",
          ),
        ),
      )
      .catch(() => undefined);
  }, [canAssign]);

  const liveAt = useLiveRefresh(
    async () => {
      try {
        await refresh();
        setError(null);
      } catch {
        /* ignore */
      }
    },
    {
      enabled: !loading,
      busy: busyId !== null || submitting,
      eventTypes: ["ticket.changed", "location.changed"],
    },
  );

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load repairs");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, assigneeFilter, slaOnly, blocksOnly]);

  useEffect(() => {
    if (!selectedId) {
      setEvents([]);
      return;
    }
    void fetchTicketEvents(selectedId)
      .then((rows) =>
        setEvents(
          rows as Array<{
            id: string;
            toStatus: string;
            fromStatus?: string | null;
            reason?: string | null;
            occurredAt: string;
            actor?: { fullName: string };
          }>,
        ),
      )
      .catch(() => setEvents([]));
  }, [selectedId]);

  const selected = useMemo(
    () => tickets.find((tkt) => tkt.id === selectedId) ?? null,
    [tickets, selectedId],
  );

  async function handleReport(e: FormEvent) {
    e.preventDefault();
    if (!locationId || !issueOptionId) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      await reportIssue({
        locationId,
        issueOptionId,
        title: title.trim() || undefined,
        priority,
        blocksRoom,
      });
      setMessage(t(locale, "Тикетът е докладван", "Ticket reported"));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Report failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page repairs-page">
      <header className="page-header">
        <div>
          <h1>{t(locale, "Повреди", "Repairs")}</h1>
          <p className="muted">
            {t(
              locale,
              "Опашка и lifecycle на технически тикети",
              "Technician ticket queue and lifecycle",
            )}
            {liveAt
              ? ` · ${t(locale, "обновено", "updated")} ${new Date(liveAt).toLocaleTimeString()}`
              : ""}
          </p>
        </div>
        <div
          className={`mywork-conn mywork-conn-${conn === "offline" ? "offline" : queueStats.pending ? "syncing" : "online"}`}
          role="status"
        >
          {conn === "offline"
            ? t(locale, "Офлайн", "Offline")
            : queueStats.pending
              ? t(locale, `Синхронизация (${queueStats.pending})`, `Syncing (${queueStats.pending})`)
              : t(locale, "Онлайн", "Online")}
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}
      {message && <div className="banner ok">{message}</div>}

      <div className="toolbar filters-row">
        <label>
          {t(locale, "Статус", "Status")}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="open">{t(locale, "Отворени", "Open")}</option>
            <option value="all">{t(locale, "Всички", "All")}</option>
            <option value="resolved">{t(locale, "Решени", "Resolved")}</option>
            <option value="assigned">assigned</option>
            <option value="in_progress">in_progress</option>
            <option value="waiting">waiting</option>
          </select>
        </label>
        <label>
          {t(locale, "Изпълнител", "Assignee")}
          <select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
          >
            <option value="all">{t(locale, "Всички", "All")}</option>
            <option value="mine">{t(locale, "Моите", "Mine")}</option>
            {people.map((p) => (
              <option key={p.employeeId} value={p.employeeId}>
                {p.fullName}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={slaOnly}
            onChange={(e) => setSlaOnly(e.target.checked)}
          />
          SLA
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={blocksOnly}
            onChange={(e) => setBlocksOnly(e.target.checked)}
          />
          {t(locale, "Блокиращи", "Blocking")}
        </label>
      </div>

      {loading ? (
        <p className="muted">{t(locale, "Зареждане…", "Loading…")}</p>
      ) : (
        <div className="repairs-grid">
          <section className="panel">
            <div className="panel-header">
              <h2>
                {t(locale, "Тикети", "Tickets")} ({tickets.length})
              </h2>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t(locale, "Стая", "Room")}</th>
                    <th>{t(locale, "Заглавие", "Title")}</th>
                    <th>{t(locale, "Статус", "Status")}</th>
                    <th>{t(locale, "Приоритет", "Priority")}</th>
                    <th>{t(locale, "Изпълнител", "Assignee")}</th>
                    <th>SLA</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((ticket) => (
                    <tr
                      key={ticket.id}
                      className={selectedId === ticket.id ? "selected" : ""}
                      onClick={() => setSelectedId(ticket.id)}
                    >
                      <td>{locLabel(ticket)}</td>
                      <td>
                        {ticket.title}
                        {ticket.blocksRoom ? " ⚠" : ""}
                      </td>
                      <td>
                        <span className={`pill status-${ticket.status}`}>
                          {ticket.status}
                        </span>
                      </td>
                      <td>{ticket.priority}</td>
                      <td>{ticket.assignee?.fullName ?? "—"}</td>
                      <td>
                        {ticket.slaBreached ? (
                          <span className="pill status-rework">breach</span>
                        ) : ticket.dueAt ? (
                          new Date(ticket.dueAt).toLocaleString()
                        ) : (
                          "—"
                        )}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <TicketLifecycleActions
                          ticket={ticket}
                          busy={busyId === ticket.id}
                          canResolve={canResolve}
                          onBusy={setBusyId}
                          onDone={(msg) => {
                            setMessage(msg);
                            void refresh();
                          }}
                          onError={setError}
                        />
                        {canAssign &&
                          (ticket.status === "new" ||
                            ticket.status === "assigned") && (
                            <select
                              defaultValue=""
                              disabled={busyId === ticket.id}
                              onChange={(e) => {
                                const assigneeId = e.target.value;
                                if (!assigneeId) return;
                                setBusyId(ticket.id);
                                void assignIssue(ticket.id, assigneeId)
                                  .then(() => {
                                    setMessage(
                                      t(locale, "Назначен", "Assigned"),
                                    );
                                    return refresh();
                                  })
                                  .catch((err) =>
                                    setError(
                                      err instanceof Error
                                        ? err.message
                                        : "Assign failed",
                                    ),
                                  )
                                  .finally(() => setBusyId(null));
                              }}
                            >
                              <option value="">
                                {t(locale, "Назначи…", "Assign…")}
                              </option>
                              {people.map((p) => (
                                <option key={p.employeeId} value={p.employeeId}>
                                  {p.fullName}
                                </option>
                              ))}
                            </select>
                          )}
                        {canClose && ticket.status === "resolved" && (
                          <button
                            type="button"
                            className="subtle"
                            disabled={busyId === ticket.id}
                            onClick={() => {
                              setBusyId(ticket.id);
                              void closeIssue(ticket.id)
                                .then(() => {
                                  setMessage(t(locale, "Затворен", "Closed"));
                                  return refresh();
                                })
                                .catch((err) =>
                                  setError(
                                    err instanceof Error
                                      ? err.message
                                      : "Close failed",
                                  ),
                                )
                                .finally(() => setBusyId(null));
                            }}
                          >
                            Close
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <aside className="panel repairs-side">
            {canReport && (
              <form className="stack" onSubmit={handleReport}>
                <h2>{t(locale, "Докладвай", "Report")}</h2>
                <label>
                  {t(locale, "Стая", "Room")}
                  <select
                    value={locationId}
                    onChange={(e) => setLocationId(e.target.value)}
                  >
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.buildingCode} {r.number}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t(locale, "Опция", "Option")}
                  <select
                    value={issueOptionId}
                    onChange={(e) => {
                      const opt = options.find((o) => o.id === e.target.value);
                      setIssueOptionId(e.target.value);
                      if (opt) {
                        setTitle(opt.nameBg);
                        if (opt.defaultPriority) setPriority(opt.defaultPriority);
                        if (opt.defaultBlocksRoom != null) {
                          setBlocksRoom(opt.defaultBlocksRoom);
                        }
                      }
                    }}
                  >
                    {options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.nameBg}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t(locale, "Заглавие", "Title")}
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
                <label>
                  {t(locale, "Приоритет", "Priority")}
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                  >
                    <option value="low">low</option>
                    <option value="normal">normal</option>
                    <option value="high">high</option>
                    <option value="urgent">urgent</option>
                  </select>
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={blocksRoom}
                    onChange={(e) => setBlocksRoom(e.target.checked)}
                  />
                  {t(locale, "Блокира стая", "Blocks room")}
                </label>
                <button type="submit" disabled={submitting}>
                  {t(locale, "Докладвай", "Report")}
                </button>
                {categories.length === 0 && (
                  <p className="muted">
                    {t(locale, "Няма категории", "No categories")}
                  </p>
                )}
              </form>
            )}

            {selected && (
              <div className="stack" style={{ marginTop: "1.5rem" }}>
                <h2>{t(locale, "Хронология", "Timeline")}</h2>
                <p className="muted">
                  {locLabel(selected)} · {selected.title}
                </p>
                <ul className="event-list">
                  {events.map((ev) => (
                    <li key={ev.id}>
                      <strong>
                        {ev.fromStatus ? `${ev.fromStatus} → ` : ""}
                        {ev.toStatus}
                      </strong>
                      <span className="muted">
                        {" "}
                        · {ev.actor?.fullName ?? "—"} ·{" "}
                        {new Date(ev.occurredAt).toLocaleString()}
                      </span>
                      {ev.reason && <div>{ev.reason}</div>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
