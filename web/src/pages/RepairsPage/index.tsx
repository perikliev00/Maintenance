/**
 * Maintenance tickets board: filter/list, assign/close/lifecycle, and report.
 * New tickets enqueue via `reportTicketQueued` when offline; live refresh on
 * ticket/location events. Assign/close/report/resolve are separately gated.
 */
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  // Permission / capability gate.
  canPerformAction,
  fetchPeople,
  fetchTicketEvents,
  fetchTickets,
  type AuthUser,
  type Person,
} from "../../api/client";
import { TicketLifecycleActions } from "../../components/TicketLifecycleActions";
import { OutboxIssuesPanel } from "../../components/OutboxIssuesPanel";
import { useLiveRefresh } from "../../hooks/useLiveRefresh";
import { useTicketLifecycleActions } from "../../hooks/useTicketLifecycleActions";
import { useOfflineStatus } from "../../hooks/useOfflineStatus";
import { Detail, type TicketEventRow } from "./detail";
import { Filters } from "./filters";
import {
  isArchivedLocation,
  locLabel,
  priorityLabel,
  statusLabel,
  t,
} from "./helpers";
import { ConnStatusBadge } from "../../components/offline/ConnStatusBadge";
import {
  EMPTY_REPAIRS_BOARD_LIST_STATE,
  REPAIRS_PAGE_SIZE,
  createRepairsBoardListSession,
  runRepairsBoardFullReload,
  runRepairsBoardLoadMore,
  type RepairsBoardListSession,
  type RepairsBoardListViewState,
} from "./listSession";
import { useRepairReportForm } from "./useRepairReportForm";

type Props = {
  user: AuthUser;
  locale?: "bg" | "en";
  focusTicketId?: string | null;
  onFocusConsumed?: () => void;
};

/**
 * RepairsPage React component / page.
 */
export function RepairsPage({
  user,
  locale = "bg",
  focusTicketId = null,
  onFocusConsumed,
}: Props) {
  const [listView, setListView] = useState<RepairsBoardListViewState>({
    ...EMPTY_REPAIRS_BOARD_LIST_STATE,
    loading: true,
  });
  const [people, setPeople] = useState<Person[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("open");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [slaOnly, setSlaOnly] = useState(false);
  const [blocksOnly, setBlocksOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<TicketEventRow[]>([]);
  const focusAppliedRef = useRef<string | null>(null);
  const sessionRef = useRef<RepairsBoardListSession | null>(null);
  if (!sessionRef.current) {
    sessionRef.current = createRepairsBoardListSession((next) => setListView(next));
  }
  const listSession = sessionRef.current;

  const report = useRepairReportForm({ user, locale, setError, setMessage });

  const {
    tickets,
    nextCursor,
    totalCount,
    loadError,
    loading,
    loadingMore,
  } = listView;
  const totalCountDisplay = totalCount ?? 0;

  // Permission / capability gate.
  const canResolve = canPerformAction(user, "tickets.resolve");
  // Permission / capability gate.
  const canAssign = canPerformAction(user, "tickets.assign");
  // Permission / capability gate.
  const canClose = canPerformAction(user, "tickets.close");
  // Permission / capability gate.
  const canReport = canPerformAction(user, "tickets.report");

  const buildTicketParams = useCallback(
    (cursor?: string | null) => {
      const params: Parameters<typeof fetchTickets>[0] & {
        paginated: true;
        cursor?: string;
      } = {
        limit: REPAIRS_PAGE_SIZE,
        paginated: true,
        status: statusFilter as "open" | "all" | "resolved",
        slaBreached: slaOnly || undefined,
        blocksRoom: blocksOnly || undefined,
      };
      if (cursor) params.cursor = cursor;
      // Branch: conditional gate.
      if (assigneeFilter === "mine") params.mine = true;
      // Else-if branch.
      else if (assigneeFilter !== "all") params.assigneeId = assigneeFilter;
      return params;
    },
    [statusFilter, assigneeFilter, slaOnly, blocksOnly],
  );

  const mapListError = useCallback(
    (err: unknown) =>
      err instanceof Error ? err.message : "Failed to load repairs",
    [],
  );

  const fetchTicketPage = useCallback(
    (args: { cursor?: string | null; signal: AbortSignal }) =>
      fetchTickets({
        ...buildTicketParams(args.cursor),
        signal: args.signal,
      }),
    [buildTicketParams],
  );

  const { loadCatalog } = report;

  /** Ticket list via paged session + report-form catalog side load. */
  const refresh = useCallback(async () => {
    setError(null);
    const catalogPromise = loadCatalog().catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to load repairs");
    });
    await runRepairsBoardFullReload(listSession, fetchTicketPage, mapListError);
    await catalogPromise;
  }, [fetchTicketPage, listSession, loadCatalog, mapListError]);

  const loadMore = useCallback(async () => {
    setError(null);
    await runRepairsBoardLoadMore(
      listSession,
      nextCursor,
      fetchTicketPage,
      mapListError,
    );
  }, [fetchTicketPage, listSession, mapListError, nextCursor]);

  const refreshInBackground = useCallback(() => {
    // Branch: conditional gate.
    if (!navigator.onLine) return;
    // Fire-and-forget async call.
    void refresh().catch(() => undefined);
  }, [refresh]);

  const { conn, queueStats } = useOfflineStatus({
    onOnlineEmptyOutbox: refreshInBackground,
  });

  // Prefer blocking filter when deep-linking a live-board blocking ticket.
  useEffect(() => {
    if (focusTicketId) setBlocksOnly(true);
  }, [focusTicketId]);

  // Deep-link from live board: select the concrete ticket by id (page until found).
  useEffect(() => {
    if (!focusTicketId || loading) return;
    if (focusAppliedRef.current === focusTicketId) return;
    const found = tickets.some((row) => row.id === focusTicketId);
    if (found) {
      focusAppliedRef.current = focusTicketId;
      setSelectedId(focusTicketId);
      setBlocksOnly(true);
      onFocusConsumed?.();
      return;
    }
    if (nextCursor && !loadingMore) {
      void loadMore();
      return;
    }
    focusAppliedRef.current = focusTicketId;
    setError(
      locale === "bg"
        ? "Повредата не е достъпна или липсва в текущия списък."
        : "Issue is unavailable or missing from the current list.",
    );
    onFocusConsumed?.();
  }, [
    focusTicketId,
    loading,
    loadingMore,
    tickets,
    nextCursor,
    loadMore,
    locale,
    onFocusConsumed,
  ]);

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

  const liveAt = useLiveRefresh(refresh, {
    enabled: true,
    busy: busyId !== null || report.submitting || loadingMore,
    eventTypes: ["ticket.changed", "location.changed"],
  });

  const ticketActions = useTicketLifecycleActions(
    useMemo(
      () => ({
        beginBusy: (id: string) => {
          setBusyId(id);
          return true;
        },
        endBusy: () => setBusyId(null),
        refresh: async () => {
          await refresh();
        },
        setError,
        setMessage,
        locale,
      }),
      [refresh, locale],
    ),
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    return () => {
      listSession.dispose();
    };
  }, [listSession]);

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
      .then(
        (rows) =>
          !cancelled &&
          // State transition.
          setEvents(rows as TicketEventRow[]),
      )
      // Promise catch handler.
      .catch(() => {
        if (!cancelled) setEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const selected = useMemo(
    () => tickets.find((tkt) => tkt.id === selectedId) ?? null,
    [tickets, selectedId],
  );

  /** Submit the report form, then apply the list effect it asks for. */
  async function handleReport(e: FormEvent) {
    const result = await report.submit(e);
    if (result.status === "queued") {
      setListView((prev) => ({
        ...prev,
        tickets: [result.ticket, ...prev.tickets],
        totalCount: (prev.totalCount ?? 0) + 1,
      }));
    } else if (result.status === "submitted") {
      refreshInBackground();
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
        <ConnStatusBadge
          locale={locale}
          conn={conn}
          pending={queueStats.pending}
          sending={queueStats.sending}
        />
      </header>

      {/* Render branch: error && <div className="banner error">error</div> */}
      {(error || loadError) && (
        <div className="banner error">{error ?? loadError}</div>
      )}
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
                {t(locale, "Тикети", "Tickets")}{" "}
                <span className="muted repairs-count">
                  {t(
                    locale,
                    `(${tickets.length} от ${totalCountDisplay})`,
                    `(${tickets.length} of ${totalCountDisplay})`,
                  )}
                </span>
              </h2>
            </div>
            <div className="table-wrap">
              <table className="data-table repairs-table">
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
                      <td>
                        {locLabel(ticket)}
                        {isArchivedLocation(ticket) ? (
                          <span className="pill repairs-archived">
                            {t(locale, "архив", "archived")}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        {ticket.title}
                        {ticket.blocksRoom ? (
                          <span
                            className="pill repairs-blocking"
                            title={t(locale, "Блокира стая", "Blocks room")}
                          >
                            {t(locale, "блокира", "blocking")}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <span className={`pill status-${ticket.status}`}>
                          {statusLabel(locale, ticket.status)}
                        </span>
                      </td>
                      <td>
                        <span className={`pill priority-${ticket.priority}`}>
                          {priorityLabel(locale, ticket.priority)}
                        </span>
                      </td>
                      <td>
                        {ticket.assignee?.fullName ?? (
                          <span className="muted">
                            {t(locale, "Неназначен", "Unassigned")}
                          </span>
                        )}
                      </td>
                      <td>
                        {ticket.slaBreached ? (
                          <span className="pill status-rework">
                            {t(locale, "просрочен", "breached")}
                          </span>
                        ) : ticket.dueAt ? (
                          <span
                            title={new Date(ticket.dueAt).toLocaleString()}
                            className="repairs-sla-due"
                          >
                            {new Date(ticket.dueAt).toLocaleString()}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <TicketLifecycleActions
                          ticket={ticket}
                          busy={busyId === ticket.id}
                          locale={locale}
                          // Permission / capability gate.
                          canResolve={canResolve}
                          onBusy={setBusyId}
                          onDone={(result) => {
                            // State transition.
                            setMessage(result.message);
                            // State transition.
                            setListView((prev) => ({
                              ...prev,
                              tickets: prev.tickets.map((row) =>
                                row.id === ticket.id
                                  ? { ...row, status: result.nextStatus }
                                  : row,
                              ),
                            }));
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
                              aria-label={t(locale, "Назначи", "Assign")}
                              disabled={busyId === ticket.id}
                              onChange={(e) => {
                                const assigneeId = e.target.value;
                                if (!assigneeId) return;
                                void ticketActions.assign(ticket.id, assigneeId);
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
                              void ticketActions.close(ticket.id);
                            }}
                          >
                            {t(locale, "Затвори", "Close")}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {nextCursor ? (
              <div className="repairs-load-more">
                <button
                  type="button"
                  className="subtle"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                >
                  {loadingMore
                    ? t(locale, "Зареждане…", "Loading…")
                    : t(locale, "Зареди още", "Load more")}
                </button>
              </div>
            ) : null}
          </section>

          <Detail
            locale={locale}
            // Permission / capability gate.
            canReport={canReport}
            locationId={report.locationId}
            onLocationIdChange={report.setLocationId}
            issueOptionId={report.issueOptionId}
            title={report.title}
            description={report.description}
            onDescriptionChange={report.setDescription}
            priority={report.priority}
            onPriorityChange={report.setPriority}
            blocksRoom={report.blocksRoom}
            onBlocksRoomChange={report.setBlocksRoom}
            submitting={report.submitting}
            rooms={report.rooms}
            options={report.options}
            categories={report.categories}
            selected={selected}
            events={events}
            onReport={handleReport}
            onIssueOptionSelect={report.selectIssueOption}
          />
        </div>
      )}
    </div>
  );
}
