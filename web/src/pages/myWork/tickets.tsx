/** My Work repair tickets list; lifecycle actions are permission-gated via `canResolve`. */
import type { MaintenanceTicket } from "../../api/client";
import {
  TicketLifecycleActions,
  type TicketLifecycleDone,
} from "../../components/TicketLifecycleActions";
import { t, statusLabel } from "./labels";

/** Compact building-code + room number for a My Work ticket card. */
function ticketLocationLabel(ticket: MaintenanceTicket): string {
  const b = ticket.location.floor.building.code;
  return `${b} ${ticket.location.number}`;
}

/**
 * My Work repair tickets list.
 * Lifecycle actions are permission-gated via `canResolve`.
 */
export function TicketsSection({
  locale,
  tickets,
  busyId,
  canResolve,
  onBusy,
  onDone,
  onError,
}: {
  locale: "bg" | "en";
  tickets: MaintenanceTicket[];
  busyId: string | null;
  canResolve: boolean;
  onBusy: (id: string | null) => void;
  onDone: (ticket: MaintenanceTicket, result: TicketLifecycleDone) => void;
  onError: (message: string) => void;
}) {
  return (
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
                {/* Call out blocking tickets so housekeepers can see impact. */}
                {ticket.blocksRoom
                  ? ` · ${t(locale, "блокира стая", "blocks room")}`
                  : ""}
              </p>
              {/* Shared lifecycle buttons; busyId scopes disable to one card. */}
              <TicketLifecycleActions
                ticket={ticket}
                busy={busyId === ticket.id}
                canResolve={canResolve}
                onBusy={onBusy}
                onDone={(result) => onDone(ticket, result)}
                onError={onError}
              />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
