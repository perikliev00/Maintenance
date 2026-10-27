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

/** Localized ticket status (API enum values stay English). */
export function statusLabel(locale: "bg" | "en", status: string): string {
  const map: Record<string, [string, string]> = {
    new: ["Нов", "New"],
    assigned: ["Назначен", "Assigned"],
    in_progress: ["В работа", "In progress"],
    waiting: ["Изчакване", "Waiting"],
    resolved: ["Решен", "Resolved"],
    closed: ["Затворен", "Closed"],
  };
  const pair = map[status];
  return pair ? t(locale, pair[0], pair[1]) : status;
}

/** Localized ticket priority (API enum values stay English). */
export function priorityLabel(locale: "bg" | "en", priority: string): string {
  const map: Record<string, [string, string]> = {
    low: ["Нисък", "Low"],
    normal: ["Нормален", "Normal"],
    high: ["Висок", "High"],
    urgent: ["Спешен", "Urgent"],
  };
  const pair = map[priority];
  return pair ? t(locale, pair[0], pair[1]) : priority;
}

/** True when the ticket's location is archived (history-only). */
export function isArchivedLocation(ticket: MaintenanceTicket): boolean {
  return ticket.location.catalogStatus === "archived";
}
