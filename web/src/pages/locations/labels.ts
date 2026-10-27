/**
 * BG/EN labels for the Locations / Rooms operational board.
 * Backend enums stay English; only UI presentation is localized.
 */
export type BoardLocale = "bg" | "en";

export function boardT(locale: BoardLocale, bg: string, en: string): string {
  return locale === "en" ? en : bg;
}

const READINESS: Record<string, [string, string]> = {
  ready: ["Готова", "Ready"],
  not_ready: ["Не е готова", "Not ready"],
  needs_check: ["Изисква проверка", "Needs check"],
};

const CLEANING: Record<string, [string, string]> = {
  dirty: ["Мръсна", "Dirty"],
  in_progress: ["В процес", "In progress"],
  pending_inspection: ["Чака проверка", "Pending inspection"],
  verified_clean: ["Проверена и чиста", "Verified clean"],
};

const OCCUPANCY: Record<string, [string, string]> = {
  vacant: ["Свободна", "Vacant"],
  occupied: ["Заета", "Occupied"],
  unknown: ["Неизвестна", "Unknown"],
};

const SERVICE: Record<string, [string, string]> = {
  in_service: ["В експлоатация", "In service"],
  out_of_service: ["Извън експлоатация", "Out of service"],
  unknown: ["Неизвестен", "Unknown"],
};

const TASK_STATUS: Record<string, [string, string]> = {
  assigned: ["Назначена", "Assigned"],
  in_progress: ["В процес", "In progress"],
  awaiting_inspection: ["Чака проверка", "Awaiting inspection"],
  rework: ["Преработка", "Rework"],
  completed: ["Завършена", "Completed"],
  cancelled: ["Отказана", "Cancelled"],
};

const REASON: Record<string, [string, string]> = {
  archived: ["Архивирана", "Archived"],
  occupancy_unknown: ["Неизвестна заетост", "Occupancy unknown"],
  service_unknown: ["Неизвестен сервизен статус", "Service unknown"],
  blocking_issue: ["Блокиращ ремонт", "Blocking issue"],
  not_vacant: ["Не е свободна", "Not vacant"],
  out_of_service: ["Извън експлоатация", "Out of service"],
  cleaning_dirty: ["Мръсна", "Dirty"],
  cleaning_in_progress: ["Почистване в процес", "Cleaning in progress"],
  cleaning_pending_inspection: ["Чака проверка", "Pending inspection"],
};

function mapLabel(
  locale: BoardLocale,
  table: Record<string, [string, string]>,
  value: string,
): string {
  const pair = table[value];
  if (!pair) return value;
  return boardT(locale, pair[0], pair[1]);
}

export function readinessLabel(locale: BoardLocale, value: string): string {
  return mapLabel(locale, READINESS, value);
}

export function cleaningLabel(locale: BoardLocale, value: string): string {
  return mapLabel(locale, CLEANING, value);
}

export function occupancyLabel(locale: BoardLocale, value: string): string {
  return mapLabel(locale, OCCUPANCY, value);
}

export function serviceLabel(locale: BoardLocale, value: string): string {
  return mapLabel(locale, SERVICE, value);
}

export function taskStatusLabel(locale: BoardLocale, value: string): string {
  return mapLabel(locale, TASK_STATUS, value);
}

export function reasonLabel(locale: BoardLocale, value: string): string {
  return mapLabel(locale, REASON, value);
}

/** Derive the next operational action hint for a room row. */
export function nextActionLabel(
  locale: BoardLocale,
  location: {
    cleaningStatus: string;
    readiness: string;
    activeTask: {
      status: string;
      runningSession: unknown;
      assignee: { fullName: string } | null;
    } | null;
  },
): string {
  const task = location.activeTask;
  if (task?.runningSession) {
    return boardT(locale, "Завърши почистването", "Complete cleaning");
  }
  if (task?.status === "awaiting_inspection") {
    return boardT(locale, "Направи проверка", "Inspect");
  }
  if (task?.status === "rework" || task?.status === "assigned") {
    return boardT(locale, "Започни почистване", "Start cleaning");
  }
  if (location.cleaningStatus === "dirty" && !task) {
    return boardT(locale, "Създай задача", "Create task");
  }
  if (location.readiness === "ready") {
    return boardT(locale, "Готова", "Ready");
  }
  return boardT(locale, "Прегледай стаята", "Review room");
}
