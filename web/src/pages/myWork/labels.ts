/** Locale helpers shared by My Work UI. */
import { t } from "../../i18n";

// Support the surrounding logic for this step.
export { t };

/** Map cleaning/ticket status codes to BG/EN labels (falls back to raw status). */
export function statusLabel(locale: "bg" | "en", status: string): string {
  // Initialize an object holding related fields.
  const map: Record<string, [string, string]> = {
    // Provide assigned field used by this structure.
    assigned: ["Възложена", "Assigned"],
    // Provide in_progress field used by this structure.
    in_progress: ["В ход", "In progress"],
    // Provide awaiting_inspection field used by this structure.
    awaiting_inspection: ["Чака инспекция", "Awaiting inspection"],
    // Provide rework field used by this structure.
    rework: ["Повторна работа", "Rework"],
    // Provide completed field used by this structure.
    completed: ["Завършена", "Completed"],
    // Provide cancelled field used by this structure.
    cancelled: ["Отказана", "Cancelled"],
    // Provide new field used by this structure.
    new: ["Нова", "New"],
    // Provide waiting field used by this structure.
    waiting: ["Изчакване", "Waiting"],
    // Provide resolved field used by this structure.
    resolved: ["Решена", "Resolved"],
  };
  // Bind pair for use in the following logic.
  const pair = map[status];
  // Unknown statuses render raw so new API codes stay visible.
  if (!pair) return status;
  // Return early result or rendered output from this path.
  return t(locale, pair[0], pair[1]);
}
