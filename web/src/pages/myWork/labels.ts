/** Locale helpers shared by My Work UI. */
export function t(locale: "bg" | "en", bg: string, en: string) {
  // English only when locale is explicitly "en"; default is Bulgarian.
  return locale === "en" ? en : bg;
}

/** Map cleaning/ticket status codes to BG/EN labels (falls back to raw status). */
export function statusLabel(locale: "bg" | "en", status: string): string {
  const map: Record<string, [string, string]> = {
    assigned: ["Възложена", "Assigned"],
    in_progress: ["В ход", "In progress"],
    awaiting_inspection: ["Чака инспекция", "Awaiting inspection"],
    rework: ["Повторна работа", "Rework"],
    completed: ["Завършена", "Completed"],
    cancelled: ["Отказана", "Cancelled"],
    new: ["Нова", "New"],
    waiting: ["Изчакване", "Waiting"],
    resolved: ["Решена", "Resolved"],
  };
  const pair = map[status];
  // Unknown statuses render raw so new API codes stay visible.
  if (!pair) return status;
  return locale === "en" ? pair[1] : pair[0];
}
