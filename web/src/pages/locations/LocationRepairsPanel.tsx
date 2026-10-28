/**
 * Side panel listing open repairs for one location on the Locations board.
 * Includes blocking and non-blocking tickets for the selected room/zone.
 * Reloads after confirmed (non-queued) lifecycle actions; paginates past 50.
 * Full reloads bump a request generation so stale responses cannot overwrite.
 */
import { useEffect, useRef, useState } from "react";
import {
  fetchTickets,
  type MaintenanceTicket,
} from "../../api/client";
import { TicketLifecycleActions } from "../../components/TicketLifecycleActions";
import {
  priorityLabel as repairPriorityLabel,
  statusLabel as repairStatusLabel,
} from "../RepairsPage/helpers";
import { boardT, type BoardLocale } from "./labels";
import { shouldReloadRepairsAfterDone } from "./repairsPanelActions";
import {
  EMPTY_REPAIRS_LIST_STATE,
  REPAIRS_PAGE_SIZE,
  createRepairsListSession,
  runFullReload,
  runLoadMore,
  type RepairsListSession,
  type RepairsListViewState,
} from "./repairsPanelState";

type LocationRepairsPanelProps = {
  locationId: string;
  locationLabel: string;
  locale: BoardLocale;
  canResolve: boolean;
  busyIds: ReadonlySet<string>;
  beginBusy: (id: string) => boolean;
  endBusy: (id: string) => void;
  setMessage: (message: string | null) => void;
  setError: (error: string | null) => void;
  onClose: () => void;
  onChanged: () => Promise<void>;
};

export function LocationRepairsPanel({
  locationId,
  locationLabel,
  locale,
  canResolve,
  busyIds,
  beginBusy,
  endBusy,
  setMessage,
  setError,
  onClose,
  onChanged,
}: LocationRepairsPanelProps) {
  const [view, setView] = useState<RepairsListViewState>({
    ...EMPTY_REPAIRS_LIST_STATE,
    loading: true,
  });
  const sessionRef = useRef<RepairsListSession | null>(null);
  const locationIdRef = useRef(locationId);
  const mountedRef = useRef(true);
  locationIdRef.current = locationId;

  if (!sessionRef.current) {
    sessionRef.current = createRepairsListSession((next) => setView(next));
  }
  const session = sessionRef.current;

  function mapError(err: unknown): string {
    return err instanceof Error
      ? err.message
      : boardT(locale, "Неуспешно зареждане", "Failed to load");
  }

  function fetchPage(args: {
    cursor?: string | null;
    signal: AbortSignal;
  }) {
    return fetchTickets({
      locationId,
      status: "open",
      limit: REPAIRS_PAGE_SIZE,
      paginated: true,
      cursor: args.cursor ?? undefined,
      signal: args.signal,
    });
  }

  function reload() {
    if (!mountedRef.current) return Promise.resolve();
    return runFullReload(session, fetchPage, mapError);
  }

  useEffect(() => {
    mountedRef.current = true;
    void reload();
    return () => {
      mountedRef.current = false;
      session.dispose();
    };
    // Recreate binding when location/locale changes — dispose invalidates in-flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional location/locale gate
  }, [locationId, locale]);

  async function loadMore() {
    await runLoadMore(session, view.nextCursor, fetchPage, mapError);
  }

  const {
    tickets,
    nextCursor,
    totalCount,
    loadError,
    loading,
    loadingMore,
  } = view;

  return (
    <aside
      className="panel location-repairs-panel"
      onClick={(e) => e.stopPropagation()}
    >
      <header className="panel-header">
        <h2>
          {boardT(locale, "Активни ремонти", "Active repairs")} — {locationLabel}
        </h2>
        <button type="button" className="ghost" onClick={onClose}>
          {boardT(locale, "Затвори", "Close")}
        </button>
      </header>
      {loading && (
        <p className="muted">{boardT(locale, "Зареждане…", "Loading…")}</p>
      )}
      {loadError && (
        <div className="error banner" role="alert">
          <span>{loadError}</span>
          <button
            type="button"
            className="ghost"
            onClick={() => void reload()}
          >
            {boardT(locale, "Опитай отново", "Retry")}
          </button>
        </div>
      )}
      {!loading && !loadError && tickets.length === 0 && (
        <p className="muted">
          {boardT(locale, "Няма активни ремонти.", "No active repairs.")}
        </p>
      )}
      {!loading && tickets.length > 0 && (
        <>
          {totalCount != null && (
            <p className="muted small">
              {tickets.length}
              {totalCount > tickets.length ? ` / ${totalCount}` : ""}{" "}
              {boardT(locale, "показани", "shown")}
            </p>
          )}
          <ul className="location-repairs-list">
            {tickets.map((ticket: MaintenanceTicket) => (
              <li key={ticket.id} className="issue-row">
                <div>
                  <strong>{ticket.title}</strong>
                  <div className="muted small">
                    {ticket.blocksRoom
                      ? boardT(locale, "блокиращ", "blocking")
                      : boardT(locale, "неблокиращ", "non-blocking")}
                    {" · "}
                    {repairStatusLabel(locale, ticket.status)}
                    {" · "}
                    {repairPriorityLabel(locale, ticket.priority)}
                  </div>
                </div>
                <TicketLifecycleActions
                  ticket={ticket}
                  busy={busyIds.has(ticket.id)}
                  canResolve={canResolve}
                  locale={locale}
                  onBusy={(id) => {
                    if (id) return beginBusy(ticket.id);
                    endBusy(ticket.id);
                    return true;
                  }}
                  onDone={(result) => {
                    setMessage(result.message);
                    void onChanged();
                    // Skip reload after close or location switch (ref vs render id).
                    if (
                      mountedRef.current &&
                      locationIdRef.current === locationId &&
                      shouldReloadRepairsAfterDone(result)
                    ) {
                      void reload();
                    }
                  }}
                  onError={(msg) => setError(msg)}
                />
              </li>
            ))}
          </ul>
          {nextCursor && (
            <div className="repairs-load-more">
              <button
                type="button"
                className="ghost"
                disabled={loadingMore || loading}
                onClick={() => void loadMore()}
              >
                {loadingMore
                  ? boardT(locale, "Зареждане…", "Loading…")
                  : boardT(locale, "Зареди още", "Load more")}
              </button>
            </div>
          )}
        </>
      )}
    </aside>
  );
}
