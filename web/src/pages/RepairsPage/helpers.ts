import type { MaintenanceTicket } from "../../api/client";

export function t(locale: "bg" | "en", bg: string, en: string) {
  return locale === "en" ? en : bg;
}

export function locLabel(ticket: MaintenanceTicket): string {
  return `${ticket.location.floor.building.code} ${ticket.location.number}`;
}
