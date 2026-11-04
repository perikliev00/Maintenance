import { useMemo } from "react";
import { TicketLifecycleActions } from "../../components/TicketLifecycleActions";
import { useTicketLifecycleActions } from "../../hooks/useTicketLifecycleActions";
import type { ControlBoard } from "./useControlBoard";

type Props = Pick<
  ControlBoard,
  | "canAssign"
  | "canClose"
  | "canResolve"
  | "tickets"
  | "resolvedTickets"
  | "ticketsError"
  | "recentError"
  | "technicians"
  | "assignDrafts"
  | "setAssignDrafts"
  | "busyIds"
  | "beginBusy"
  | "endBusy"
  | "refreshTickets"
  | "setError"
  | "setMessage"
  | "setRefreshWarning"
  | "liveAt"
  | "onManualRefresh"
>;

export function ControlTicketsSection(props: Props) {
  const {
    canAssign,
    canClose,
    canResolve,
    tickets,
    resolvedTickets,
    ticketsError,
    recentError,
    technicians,
    assignDrafts,
    setAssignDrafts,
    busyIds,
    beginBusy,
    endBusy,
    refreshTickets,
    setError,
    setMessage,
    setRefreshWarning,
    liveAt,
    onManualRefresh,
  } = props;

  const ticketActions = useTicketLifecycleActions(
    useMemo(
      () => ({
        beginBusy,
        endBusy,
        refresh: refreshTickets,
        setError,
        setMessage,
        setRefreshWarning,
        locale: "bg" as const,
      }),
      [
        beginBusy,
        endBusy,
        refreshTickets,
        setError,
        setMessage,
        setRefreshWarning,
      ],
    ),
  );

  return (
    <>
      <section className="panel control-issues">
        <div className="panel-header">
          <h2>Отворени проблеми</h2>
          <button
            type="button"
            className="ghost"
            onClick={() => void onManualRefresh()}
          >
            Refresh
          </button>
          {liveAt && (
            <span className="muted live-stamp" title={liveAt}>
              live
            </span>
          )}
        </div>
        {ticketsError && <p className="error">{ticketsError}</p>}
        {tickets.length === 0 ? (
          <p className="muted">Няма отворени проблеми.</p>
        ) : (
          <ul className="issue-feed">
            {tickets.map((ticket) => {
              const ticketBusy = busyIds.has(ticket.id);
              return (
                <li
                  key={ticket.id}
                  className={`issue-card priority-${ticket.priority}`}
                >
                  <div className="issue-card-top">
                    <strong>
                      {ticket.location.floor.building.code}{" "}
                      {ticket.location.number}
                    </strong>
                    <span className={`pill priority-${ticket.priority}`}>
                      {ticket.priority}
                    </span>
                    <span className="pill">{ticket.status}</span>
                  </div>
                  <p className="issue-title">{ticket.title}</p>
                  <div className="issue-meta muted">
                    <span>{ticket.reportedBy.fullName}</span>
                    <span>
                      {new Date(ticket.openedAt).toLocaleString()}
                    </span>
                    {ticket.assignee && (
                      <span>→ {ticket.assignee.fullName}</span>
                    )}
                  </div>
                  {canAssign &&
                    (ticket.status === "new" ||
                      ticket.status === "assigned") && (
                      <div
                        className="actions"
                        style={{ marginTop: "0.5rem", gap: "0.35rem" }}
                      >
                        <select
                          value={
                            assignDrafts[ticket.id] ??
                            ticket.assignee?.id ??
                            technicians[0]?.id ??
                            ""
                          }
                          onChange={(e) =>
                            setAssignDrafts((prev) => ({
                              ...prev,
                              [ticket.id]: e.target.value,
                            }))
                          }
                        >
                          {technicians.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.fullName}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="subtle"
                          disabled={
                            ticketBusy ||
                            !(
                              assignDrafts[ticket.id] ??
                              ticket.assignee?.id ??
                              technicians[0]?.id
                            )
                          }
                          onClick={() => {
                            const assigneeId =
                              assignDrafts[ticket.id] ??
                              ticket.assignee?.id ??
                              technicians[0]?.id;
                            if (!assigneeId) return;
                            void ticketActions.assign(ticket.id, assigneeId);
                          }}
                        >
                          Assign
                        </button>
                      </div>
                    )}
                  <TicketLifecycleActions
                    ticket={ticket}
                    busy={ticketBusy}
                    canResolve={canResolve}
                    onBusy={(id) => {
                      if (id) return beginBusy(ticket.id);
                      endBusy(ticket.id);
                      return true;
                    }}
                    onDone={(result) => {
                      setMessage(result.message);
                      setError(null);
                      void refreshTickets().catch((err) => {
                        setRefreshWarning(
                          err instanceof Error
                            ? err.message
                            : "Failed to refresh",
                        );
                      });
                    }}
                    onError={(msg) => setError(msg)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="panel control-issues">
        <div className="panel-header">
          <h2>Наскоро резолвнати</h2>
        </div>
        {recentError && <p className="error">{recentError}</p>}
        {resolvedTickets.length === 0 ? (
          <p className="muted">Няма резолвнати проблеми.</p>
        ) : (
          <ul className="issue-feed">
            {resolvedTickets.map((ticket) => {
              const ticketBusy = busyIds.has(ticket.id);
              return (
                <li
                  key={ticket.id}
                  className={`issue-card priority-${ticket.priority}`}
                >
                  <div className="issue-card-top">
                    <strong>
                      {ticket.location.floor.building.code}{" "}
                      {ticket.location.number}
                    </strong>
                    <span className="pill ready-ready">{ticket.status}</span>
                  </div>
                  <p className="issue-title">{ticket.title}</p>
                  <div className="issue-meta muted">
                    <span>
                      {ticket.resolvedBy
                        ? ticket.resolvedBy.fullName
                        : "—"}
                    </span>
                    <span>
                      {ticket.resolvedAt
                        ? new Date(ticket.resolvedAt).toLocaleString()
                        : "—"}
                    </span>
                  </div>
                  {ticket.resolutionNotes && (
                    <p className="muted">{ticket.resolutionNotes}</p>
                  )}
                  <div
                    className="actions"
                    style={{ marginTop: "0.5rem", gap: "0.35rem" }}
                  >
                    {canClose && ticket.status === "resolved" && (
                      <button
                        type="button"
                        className="subtle"
                        disabled={ticketBusy}
                        onClick={() => void ticketActions.close(ticket.id)}
                      >
                        Close
                      </button>
                    )}
                    {canResolve && (
                      <button
                        type="button"
                        className="subtle"
                        disabled={ticketBusy}
                        onClick={() => {
                          const reason = window.prompt(
                            "Причина за повторно отваряне (опционално)",
                          );
                          if (reason === null) return;
                          void ticketActions.reopen(ticket.id, reason);
                        }}
                      >
                        Reopen
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
