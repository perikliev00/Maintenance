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
    <section className="ui-surface" id="repair-queue">
      <div className="ui-section-heading ui-action-strip"><h2>{t(locale, "Повреди", "Repairs")}</h2><span className="muted">{tickets.length} {t(locale, "заредени", "loaded")}</span></div>
      {tickets.length === 0 ? (
        <p className="muted">
          {t(locale, "Няма назначени тикети", "No assigned tickets")}
        </p>
      ) : (
        <div className="ui-queue">
          {tickets.map((ticket) => (
            <article key={ticket.id} className="mywork-card ui-work-item">
              <div className="ui-work-item-location"><strong>{ticketLocationLabel(ticket)}</strong><small>{t(locale, "Повреда", "Repair")}</small></div>
              <div className="ui-work-item-body">
                <div className="ui-work-item-heading"><h3>{ticket.title}</h3><span className={`pill status-${ticket.status}`}>{statusLabel(locale, ticket.status)}</span></div>
                <p className="muted">{ticket.priority}{ticket.blocksRoom ? ` · ${t(locale, "блокира стая", "blocks room")}` : ""}</p>
              </div>
              <div className="ui-work-item-actions">
                <TicketLifecycleActions ticket={ticket} busy={busyId === ticket.id} canResolve={canResolve} locale={locale} onBusy={onBusy} onDone={(result) => onDone(ticket, result)} onError={onError} />
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
