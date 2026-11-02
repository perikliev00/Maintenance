/**
 * Canonical maintenance-ticket status/priority labels (Home + Repairs).
 * Do not merge with cleaning-task status labels — different domain copy.
 */
import { t } from "../i18n";

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
