/**
 * Maintenance tickets board: filter/list, assign/close/lifecycle, and report.
 * New tickets enqueue via `reportTicketQueued` when offline; live refresh on
 * ticket/location events. Assign/close/report/resolve are separately gated.
 */
import { WorkspaceIntro, EmptyState } from "../../ui";
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
import { LoadingIndicator } from "../../components/LoadingIndicator";
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
    if (!canAssign) return;
    // Fire-and-forget async call.
    void fetchPeople()
      // Promise then handler.
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
    if (!selectedId) {
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

  return (
    <main className="ui-workspace repairs-page">
      <WorkspaceIntro eyebrow={t(locale, "ОПЕРАЦИИ / ТЕХНИЧЕСКА ПОДДРЪЖКА", "OPERATIONS / MAINTENANCE")}
        title={t(locale, "Повреди", "Repairs")}
        description={<>{t(locale, "От сигнал до решение. Следете работата и освободете блокираните стаи.", "From report to resolution. Keep work moving and clear blocked rooms.")}{liveAt ? ` · ${t(locale, "обновено", "updated")} ${new Date(liveAt).toLocaleTimeString()}` : ""}</>}
        actions={<ConnStatusBadge locale={locale} conn={conn} pending={queueStats.pending} sending={queueStats.sending} />} />
      {(error || loadError) && <div className="banner error" role="alert">{error ?? loadError}</div>}
      {message && <div className="banner ok" role="status">{message}</div>}
      <OutboxIssuesPanel locale={locale} conflictCount={queueStats.conflict} failedCount={queueStats.failed} />
                <Detail mode="report"
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
      <div className="ui-repair-workspace">
        <aside className="ui-repair-criteria">
          <p className="ui-eyebrow">{t(locale, "ВАШИЯТ ИЗГЛЕД", "YOUR VIEW")}</p>
          <h2>{t(locale, "Работна опашка", "Work queue")}</h2>
          <Filters locale={locale} statusFilter={statusFilter} onStatusFilterChange={setStatusFilter}
            assigneeFilter={assigneeFilter} onAssigneeFilterChange={setAssigneeFilter}
            slaOnly={slaOnly} onSlaOnlyChange={setSlaOnly} blocksOnly={blocksOnly} onBlocksOnlyChange={setBlocksOnly} people={people} />
        </aside>
        <section className="ui-repair-results">
          <div className="ui-section-heading"><h2>{t(locale, "Тикети", "Tickets")}</h2>
            <span className="muted repairs-count">{t(locale, `(${tickets.length} от ${totalCountDisplay})`, `(${tickets.length} of ${totalCountDisplay})`)}</span></div>
          {loading ? <LoadingIndicator label={t(locale, "Зареждане…", "Loading…")} /> : <>
            {tickets.length === 0 && <EmptyState title={t(locale, "Няма тикети в този изглед", "No tickets in this view")} description={t(locale, "Променете филтрите или създайте нов сигнал.", "Adjust the filters or report a new issue.")} />}
            <div className="ui-queue">
              {tickets.map(ticket => <article key={ticket.id} data-ticket-id={ticket.id} className={`ui-work-item ui-ticket-item${selectedId === ticket.id ? " selected" : ""}`}>
                <div className="ui-work-item-location">{locLabel(ticket)}{isArchivedLocation(ticket) && <span className="pill repairs-archived">{t(locale, "архив", "archived")}</span>}</div>
                <div className="ui-work-item-body">
                  <button type="button" className="ui-ticket-title" onClick={() => setSelectedId(ticket.id)} aria-expanded={selectedId === ticket.id}>{ticket.title}</button>
                  <div className="ui-work-item-meta">
                    <span className={`pill status-${ticket.status}`}>{statusLabel(locale,ticket.status)}</span>
                    <span className={`pill priority-${ticket.priority}`}>{priorityLabel(locale,ticket.priority)}</span>
                    {ticket.blocksRoom && <span className="pill repairs-blocking" title={t(locale, "Блокира стая", "Blocks room")}>{t(locale, "блокира", "blocking")}</span>}
                  </div>
                  <span className="muted">{ticket.assignee?.fullName ?? t(locale, "Неназначен", "Unassigned")}</span>
                  <span className="muted repairs-sla-due">SLA · {ticket.slaBreached ? <span className="pill status-rework">{t(locale,"просрочен","breached")}</span> : ticket.dueAt ? <time dateTime={ticket.dueAt}>{new Date(ticket.dueAt).toLocaleString()}</time> : "—"}</span>
                </div>
                <div className="ui-work-item-actions">                        <TicketLifecycleActions
                          ticket={ticket}
                          busy={busyId === ticket.id}
                          locale={locale}
                          // Permission / capability gate.
                          canResolve={canResolve}
                          onBusy={setBusyId}
                          onDone={(result) => {
                            setMessage(result.message);
                            setListView((prev) => ({
                              ...prev,
                              tickets: prev.tickets.map((row) =>
                                row.id === ticket.id
                                  ? { ...row, status: result.nextStatus }
                                  : row,
                              ),
                            }));
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
                        )}</div>
              </article>)}
            </div>
          </>}
          {nextCursor && <div className="repairs-load-more"><button type="button" className="subtle" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? <LoadingIndicator variant="inline" delayMs={0} label={t(locale,"Зареждане…","Loading…")} /> : t(locale,"Зареди още","Load more")}</button></div>}
                    <Detail mode="timeline"
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
        </section>
      </div>
    </main>
  );
}
