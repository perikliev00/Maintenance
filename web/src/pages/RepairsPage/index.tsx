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
  type AuthUser,
  type IssueOptionRow,
  type MaintenanceCategoryRow,
  type MaintenanceTicket,
  type Person,
  type Room,
} from "../../api/client";
import { TicketLifecycleActions } from "../../components/TicketLifecycleActions";
import { OutboxIssuesPanel } from "../../components/OutboxIssuesPanel";
import { useLiveRefresh } from "../../hooks/useLiveRefresh";
import {
  getQueueStats,
  reportTicketQueued,
  subscribeOffline,
  type ConnMode,
  type QueueStats,
} from "../../offline";
import { Detail, type TicketEventRow } from "./detail";
import { Filters } from "./filters";
import { locLabel, t } from "./helpers";
import { OfflineConnBadge } from "./offlineChrome";

type Props = {
  user: AuthUser;
  locale?: "bg" | "en";
};

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
  const [events, setEvents] = useState<TicketEventRow[]>([]);
  const [conn, setConn] = useState<ConnMode>("online");
  const [queueStats, setQueueStats] = useState<QueueStats>({
    pending: 0,
    sending: 0,
    conflict: 0,
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

  const refreshInBackground = useCallback(() => {
    if (!navigator.onLine) return;
    void refresh().catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    return subscribeOffline((next) => {
      setConn(next.conn);
      setQueueStats(next.stats);
      if (
        next.conn === "online" &&
        next.stats.pending === 0 &&
        next.stats.sending === 0
      ) {
        refreshInBackground();
      }
    });
  }, [refreshInBackground]);

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
          rows as TicketEventRow[],
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
      const room = rooms.find((r) => r.id === locationId);
      const result = await reportTicketQueued({
        locationId,
        issueOptionId,
        title: title.trim() || undefined,
        priority,
        blocksRoom,
      });
      if (result.queued) {
        const optimistic: MaintenanceTicket = {
          id: `local-${crypto.randomUUID()}`,
          title: title.trim() || "Queued report",
          category: "queued",
          priority,
          blocksRoom,
          status: "new",
          openedAt: new Date().toISOString(),
          resolvedAt: null,
          resolutionNotes: null,
          location: {
            id: locationId,
            number: room?.number ?? "?",
            floor: {
              number: room?.floor ?? 0,
              building: {
                code: room?.buildingCode ?? "?",
                name: room?.building ?? room?.buildingCode ?? "?",
              },
            },
          },
          reportedBy: {
            id: user.employeeId,
            fullName: user.fullName,
            employeeNumber: "",
          },
          assignee: null,
          resolvedBy: null,
          slaBreached: false,
        };
        setTickets((prev) => [optimistic, ...prev]);
        setMessage(
          t(locale, "Докладът е в опашката", "Report queued for sync"),
        );
      } else {
        setMessage(t(locale, "Тикетът е докладван", "Ticket reported"));
        refreshInBackground();
      }
      setTitle("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Report failed");
    } finally {
      setSubmitting(false);
    }
  }

  function handleIssueOptionSelect(optionId: string) {
    const opt = options.find((o) => o.id === optionId);
    setIssueOptionId(optionId);
    if (opt) {
      setTitle(opt.nameBg);
      if (opt.defaultPriority) setPriority(opt.defaultPriority);
      if (opt.defaultBlocksRoom != null) {
        setBlocksRoom(opt.defaultBlocksRoom);
      }
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
        <OfflineConnBadge
          locale={locale}
          conn={conn}
          pending={queueStats.pending}
          sending={queueStats.sending}
        />
      </header>

      {error && <div className="banner error">{error}</div>}
      {message && <div className="banner ok">{message}</div>}
      <OutboxIssuesPanel
        locale={locale}
        conflictCount={queueStats.conflict}
        failedCount={queueStats.failed}
      />

      <Filters
        locale={locale}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        assigneeFilter={assigneeFilter}
        onAssigneeFilterChange={setAssigneeFilter}
        slaOnly={slaOnly}
        onSlaOnlyChange={setSlaOnly}
        blocksOnly={blocksOnly}
        onBlocksOnlyChange={setBlocksOnly}
        people={people}
      />

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
                          onDone={(result) => {
                            setMessage(result.message);
                            setTickets((prev) =>
                              prev.map((row) =>
                                row.id === ticket.id
                                  ? { ...row, status: result.nextStatus }
                                  : row,
                              ),
                            );
                            if (!result.queued) refreshInBackground();
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

          <Detail
            locale={locale}
            canReport={canReport}
            locationId={locationId}
            onLocationIdChange={setLocationId}
            issueOptionId={issueOptionId}
            title={title}
            onTitleChange={setTitle}
            priority={priority}
            onPriorityChange={setPriority}
            blocksRoom={blocksRoom}
            onBlocksRoomChange={setBlocksRoom}
            submitting={submitting}
            rooms={rooms}
            options={options}
            categories={categories}
            selected={selected}
            events={events}
            onReport={handleReport}
            onIssueOptionSelect={handleIssueOptionSelect}
          />
        </div>
      )}
    </div>
  );
}
