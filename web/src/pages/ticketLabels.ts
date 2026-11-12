/**
 * Canonical maintenance-ticket status/priority labels (Home + Repairs).
 * Do not merge with cleaning-task status labels — different domain copy.
 */
import { t } from "../i18n";

/** Localized ticket status (API enum values stay English). */
export function statusLabel(locale: "bg" | "en", status: string): string {
  // Initialize an object holding related fields.
  const map: Record<string, [string, string]> = {
    // Provide new field used by this structure.
    new: ["Нов", "New"],
    // Provide assigned field used by this structure.
    assigned: ["Назначен", "Assigned"],
    // Provide in_progress field used by this structure.
    in_progress: ["В работа", "In progress"],
    // Provide waiting field used by this structure.
    waiting: ["Изчакване", "Waiting"],
    // Provide resolved field used by this structure.
    resolved: ["Решен", "Resolved"],
    // Provide closed field used by this structure.
    closed: ["Затворен", "Closed"],
  };
  // Bind pair for use in the following logic.
  const pair = map[status];
  // Return early result or rendered output from this path.
  return pair ? t(locale, pair[0], pair[1]) : status;
}

/** Localized ticket priority (API enum values stay English). */
export function priorityLabel(locale: "bg" | "en", priority: string): string {
  // Initialize an object holding related fields.
  const map: Record<string, [string, string]> = {
    // Provide low field used by this structure.
    low: ["Нисък", "Low"],
    // Provide normal field used by this structure.
    normal: ["Нормален", "Normal"],
    // Provide high field used by this structure.
    high: ["Висок", "High"],
    // Provide urgent field used by this structure.
    urgent: ["Спешен", "Urgent"],
  };
  // Bind pair for use in the following logic.
  const pair = map[priority];
  // Return early result or rendered output from this path.
  return pair ? t(locale, pair[0], pair[1]) : priority;
}
