/**
 * Maintenance tickets board: filter/list, assign/close/lifecycle, and report.
 * New tickets enqueue via `reportTicketQueued` when offline; live refresh on
 * ticket/location events. Assign/close/report/resolve are separately gated.
 */
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  // Permission / capability gate.
  canPerformAction,
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
  assignTicketQueued,
  closeTicketQueued,
  getQueueStats,
  reportTicketQueued,
  subscribeOffline,
  type ConnMode,
  type QueueStats,
// Offline / online path.
} from "../../offline";
import { Detail, type TicketEventRow } from "./detail";
import { Filters } from "./filters";
import { locLabel, t } from "./helpers";
import { OfflineConnBadge } from "./offlineChrome";

type Props = {
  user: AuthUser;
  locale?: "bg" | "en";
};

/**
 * RepairsPage React component / page.
 */
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
  const reportInFlight = useRef(false);
  const locationRef = useRef(locationId);
  const optionRef = useRef(issueOptionId);
  locationRef.current = locationId;
  optionRef.current = issueOptionId;

  // Permission / capability gate.
  const canResolve = canPerformAction(user, "tickets.resolve");
  // Permission / capability gate.
  const canAssign = canPerformAction(user, "tickets.assign");
  // Permission / capability gate.
  const canClose = canPerformAction(user, "tickets.close");
  // Permission / capability gate.
  const canReport = canPerformAction(user, "tickets.report");

  const requestRevision = useRef(0);

  /** Ticket list + catalog; people for assign are loaded separately when allowed. */
  const refresh = useCallback(async () => {
    const revision = ++requestRevision.current;
    setLoading(true);
    setError(null);
    try {
      const params: Parameters<typeof fetchTickets>[0] = {
        limit: 100,
        status: statusFilter as "open" | "all" | "resolved",
        slaBreached: slaOnly || undefined,
        blocksRoom: blocksOnly || undefined,
      };
      // Branch: conditional gate.
      if (assigneeFilter === "mine") params.mine = true;
      // Else-if branch.
      else if (assigneeFilter !== "all") params.assigneeId = assigneeFilter;

      const [ticketData, roomData, catData, optData] = await Promise.all([
        fetchTickets(params),
        fetchRooms(),
        fetchMaintenanceCategories(),
        fetchIssueOptions(),
      ]);
      if (revision !== requestRevision.current) return;
      // State transition.
      setTickets(ticketData);
      // State transition.
      setRooms(roomData);
      // State transition.
      setCategories(catData);
      // State transition.
      setOptions(optData);
      // Branch: conditional gate.
      if (!locationRef.current && roomData[0]) {
        locationRef.current = roomData[0].id;
        setLocationId(roomData[0].id);
      }
      // Branch: conditional gate.
      if (!optionRef.current && optData[0]) {
        optionRef.current = optData[0].id;
        // State transition.
        setIssueOptionId(optData[0].id);
        // State transition.
        setTitle(optData[0].nameBg);
        // Branch: conditional gate.
        if (optData[0].defaultPriority) setPriority(optData[0].defaultPriority);
        // Branch: conditional gate.
        if (optData[0].defaultBlocksRoom != null) {
          // State transition.
          setBlocksRoom(optData[0].defaultBlocksRoom);
        }
      }
    } catch (err) {
      if (revision === requestRevision.current) {
        setError(err instanceof Error ? err.message : "Failed to load repairs");
      }
    } finally {
      if (revision === requestRevision.current) setLoading(false);
    }
  }, [statusFilter, assigneeFilter, slaOnly, blocksOnly]);

  const refreshInBackground = useCallback(() => {
    // Branch: conditional gate.
    if (!navigator.onLine) return;
    // Fire-and-forget async call.
    void refresh().catch(() => undefined);
  }, [refresh]);

  // Effect: sync props/state to side effects.
  useEffect(() => {
    // Early / value return.
    return subscribeOffline((next) => {
      // State transition.
      setConn(next.conn);
      // State transition.
      setQueueStats(next.stats);
      // Branch: conditional gate.
      if (
        next.conn === "online" &&
        next.stats.pending === 0 &&
        next.stats.sending === 0
      ) {
        refreshInBackground();
      }
    });
  }, [refreshInBackground]);

  // Effect: sync props/state to side effects.
  useEffect(() => {
    // Fire-and-forget async call.
    void getQueueStats().then(setQueueStats);
  }, []);

  // Effect: sync props/state to side effects.
  useEffect(() => {
    // Branch: conditional gate.
    if (!canAssign) return;
    // Fire-and-forget async call.
    void fetchPeople()
      // Promise then handler.
      .then((rows) =>
        // State transition.
        setPeople(
          rows.filter(
            (p) =>
              p.role === "technician" ||
              p.role === "supervisor" ||
              p.role === "manager",
          ),
        ),
      )
      // Promise catch handler.
      .catch(() => undefined);
  }, [canAssign]);

  const liveAt = useLiveRefresh(
    refresh,
    {
      enabled: true,
      busy: busyId !== null || submitting,
      eventTypes: ["ticket.changed", "location.changed"],
    },
  );

  useEffect(() => {
    void refresh();
    return () => { requestRevision.current++; };
  }, [refresh]);

  // Effect: sync props/state to side effects.
  useEffect(() => {
    // Branch: conditional gate.
    if (!selectedId) {
      // State transition.
      setEvents([]);
      return;
    }
    let cancelled = false;
    setEvents([]);
    // Fire-and-forget async call.
    void fetchTicketEvents(selectedId)
      // Promise then handler.
      .then((rows) => !cancelled &&
        // State transition.
        setEvents(
          rows as TicketEventRow[],
        ),
      )
      // Promise catch handler.
      .catch(() => { if (!cancelled) setEvents([]); });
    return () => { cancelled = true; };
  }, [selectedId]);

  const selected = useMemo(
    () => tickets.find((tkt) => tkt.id === selectedId) ?? null,
    [tickets, selectedId],
  );

  /**
   * Handler `handleReport` for user or form events.
   */
  async function handleReport(e: FormEvent) {
    e.preventDefault();
    // Branch: conditional gate.
    if (!locationId || !issueOptionId || reportInFlight.current) return;
    reportInFlight.current = true;
    // State transition.
    setSubmitting(true);
    // State transition.
    setError(null);
    // State transition.
    setMessage(null);
    // Try block for fallible work.
    try {
      const room = rooms.find((r) => r.id === locationId);
      const result = await reportTicketQueued({
        locationId,
        issueOptionId,
        title: title.trim() || undefined,
        priority,
        blocksRoom,
      });
      // Branch: conditional gate.
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
        // State transition.
        setTickets((prev) => [optimistic, ...prev]);
        // State transition.
        setMessage(
          t(locale, "Докладът е в опашката", "Report queued for sync"),
        );
      } else {
        // State transition.
        setMessage(t(locale, "Тикетът е докладван", "Ticket reported"));
        refreshInBackground();
      }
      // State transition.
      setTitle("");
    } catch (err) {
      // State transition.
      setError(err instanceof Error ? err.message : "Report failed");
    } finally {
      // State transition.
      setSubmitting(false);
      reportInFlight.current = false;
    }
  }

  /**
   * Handler `handleIssueOptionSelect` for user or form events.
   */
  function handleIssueOptionSelect(optionId: string) {
    const opt = options.find((o) => o.id === optionId);
    // State transition.
    setIssueOptionId(optionId);
    // Branch: conditional gate.
    if (opt) {
      // State transition.
      setTitle(opt.nameBg);
      // Branch: conditional gate.
      if (opt.defaultPriority) setPriority(opt.defaultPriority);
      // Branch: conditional gate.
      if (opt.defaultBlocksRoom != null) {
        // State transition.
        setBlocksRoom(opt.defaultBlocksRoom);
      }
    }
  }

  // Early / value return.
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

      {/* Render branch: error && <div className="banner error">error</div> */}
      {error && <div className="banner error">{error}</div>}
      {/* Render branch: message && <div className="banner ok">message</div> */}
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
                        {/* Render branch: ticket.blocksRoom ? " ⚠" : "" */}
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
                          // Permission / capability gate.
                          canResolve={canResolve}
                          onBusy={setBusyId}
                          onDone={(result) => {
                            // State transition.
                            setMessage(result.message);
                            // State transition.
                            setTickets((prev) =>
                              prev.map((row) =>
                                row.id === ticket.id
                                  ? { ...row, status: result.nextStatus }
                                  : row,
                              ),
                            );
                            // Branch: conditional gate.
                            if (!result.queued) refreshInBackground();
                          }}
                          onError={setError}
                        />
                        {/* Render branch: canAssign && */}
                        {canAssign &&
                          (ticket.status === "new" ||
                            ticket.status === "assigned") && (
                            <select
                              defaultValue=""
                              disabled={busyId === ticket.id}
                              onChange={(e) => {
                                const assigneeId = e.target.value;
                                // Branch: conditional gate.
                                if (!assigneeId) return;
                                // State transition.
                                setBusyId(ticket.id);
                                // Fire-and-forget async call (online or outbox).
                                void assignTicketQueued(ticket.id, assigneeId)
                                  .then((result) => {
                                    setMessage(
                                      result.queued
                                        ? t(
                                            locale,
                                            "Назначаване в опашката",
                                            "Assign queued",
                                          )
                                        : t(locale, "Назначен", "Assigned"),
                                    );
                                    if (!result.queued) return refresh();
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
                        {/* Render branch: canClose && ticket.status === "resolved" && ( */}
                        {canClose && ticket.status === "resolved" && (
                          <button
                            type="button"
                            className="subtle"
                            disabled={busyId === ticket.id}
                            onClick={() => {
                              setBusyId(ticket.id);
                              void closeTicketQueued(ticket.id)
                                .then((result) => {
                                  setMessage(
                                    result.queued
                                      ? t(
                                          locale,
                                          "Затваряне в опашката",
                                          "Close queued",
                                        )
                                      : t(locale, "Затворен", "Closed"),
                                  );
                                  if (!result.queued) return refresh();
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
            // Permission / capability gate.
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
