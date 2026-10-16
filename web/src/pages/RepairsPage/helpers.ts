/** Shared locale + location label helpers for Repairs. */
import type { MaintenanceTicket } from "../../api/client";

/** Pick BG vs EN copy for Repairs UI strings. */
export function t(locale: "bg" | "en", bg: string, en: string) {
  // English only when locale is explicitly "en"; default is Bulgarian.
  return locale === "en" ? en : bg;
}

/** Compact building-code + room number for ticket list rows. */
export function locLabel(ticket: MaintenanceTicket): string {
  // Nested floor.building is the stable catalog path on MaintenanceTicket.
  return `${ticket.location.floor.building.code} ${ticket.location.number}`;
}
