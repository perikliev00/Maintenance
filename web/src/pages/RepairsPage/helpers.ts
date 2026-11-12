/** Shared locale + location label helpers for Repairs. */
import type { MaintenanceTicket } from "../../api/client";
import { t } from "../../i18n";

export { t };
// Re-export selected symbols for a stable public barrel.
export { priorityLabel, statusLabel } from "../ticketLabels";

/** Compact building-code + room number for ticket list rows. */
export function locLabel(ticket: MaintenanceTicket): string {
  // Nested floor.building is the stable catalog path on MaintenanceTicket.
  return `${ticket.location.floor.building.code} ${ticket.location.number}`;
}

/** True when the ticket's location is archived (history-only). */
export function isArchivedLocation(ticket: MaintenanceTicket): boolean {
  return ticket.location.catalogStatus === "archived";
}
