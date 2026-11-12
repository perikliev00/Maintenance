/** Shared locale + location label helpers for Repairs. */
import type { MaintenanceTicket } from "../../api/client";
// Import module dependency from ../../i18n.
import { t } from "../../i18n";

// Support the surrounding logic for this step.
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
  // Return early result or rendered output from this path.
  return ticket.location.catalogStatus === "archived";
}
