/**
 * BG/EN labels for the Locations / Rooms operational board.
 * Backend enums stay English; only UI presentation is localized.
 */
export type BoardLocale = "bg" | "en";

// Export function boardT as part of this module's API.
export function boardT(locale: BoardLocale, bg: string, en: string): string {
  // Return early result or rendered output from this path.
  return locale === "en" ? en : bg;
}

// Initialize an object holding related fields.
const READINESS: Record<string, [string, string]> = {
  // Provide ready field used by this structure.
  ready: ["Готова", "Ready"],
  // Provide not_ready field used by this structure.
  not_ready: ["Не е готова", "Not ready"],
  // Provide needs_check field used by this structure.
  needs_check: ["Изисква проверка", "Needs check"],
};

// Initialize an object holding related fields.
const CLEANING: Record<string, [string, string]> = {
  // Provide dirty field used by this structure.
  dirty: ["Мръсна", "Dirty"],
  // Provide in_progress field used by this structure.
  in_progress: ["В процес", "In progress"],
  // Provide pending_inspection field used by this structure.
  pending_inspection: ["Чака проверка", "Pending inspection"],
  // Provide verified_clean field used by this structure.
  verified_clean: ["Проверена и чиста", "Verified clean"],
};

// Initialize an object holding related fields.
const OCCUPANCY: Record<string, [string, string]> = {
  // Provide vacant field used by this structure.
  vacant: ["Свободна", "Vacant"],
  // Provide occupied field used by this structure.
  occupied: ["Заета", "Occupied"],
  // Provide unknown field used by this structure.
  unknown: ["Неизвестна", "Unknown"],
};

// Initialize an object holding related fields.
const SERVICE: Record<string, [string, string]> = {
  // Provide in_service field used by this structure.
  in_service: ["В експлоатация", "In service"],
  // Provide out_of_service field used by this structure.
  out_of_service: ["Извън експлоатация", "Out of service"],
  // Provide unknown field used by this structure.
  unknown: ["Неизвестен", "Unknown"],
};

// Initialize an object holding related fields.
const TASK_STATUS: Record<string, [string, string]> = {
  // Provide assigned field used by this structure.
  assigned: ["Назначена", "Assigned"],
  // Provide in_progress field used by this structure.
  in_progress: ["В процес", "In progress"],
  // Provide awaiting_inspection field used by this structure.
  awaiting_inspection: ["Чака проверка", "Awaiting inspection"],
  // Provide rework field used by this structure.
  rework: ["Преработка", "Rework"],
  // Provide completed field used by this structure.
  completed: ["Завършена", "Completed"],
  // Provide cancelled field used by this structure.
  cancelled: ["Отказана", "Cancelled"],
};

// Initialize an object holding related fields.
const PRIORITY: Record<string, [string, string]> = {
  // Provide low field used by this structure.
  low: ["Нисък", "Low"],
  // Provide normal field used by this structure.
  normal: ["Нормален", "Normal"],
  // Provide high field used by this structure.
  high: ["Висок", "High"],
  // Provide urgent field used by this structure.
  urgent: ["Спешен", "Urgent"],
};

// Initialize an object holding related fields.
const REASON: Record<string, [string, string]> = {
  // Provide archived field used by this structure.
  archived: ["Архивирана", "Archived"],
  // Provide occupancy_unknown field used by this structure.
  occupancy_unknown: ["Неизвестна заетост", "Occupancy unknown"],
  // Provide service_unknown field used by this structure.
  service_unknown: ["Неизвестен сервизен статус", "Service unknown"],
  // Provide blocking_issue field used by this structure.
  blocking_issue: ["Блокиращ ремонт", "Blocking issue"],
  // Provide not_vacant field used by this structure.
  not_vacant: ["Не е свободна", "Not vacant"],
  // Provide out_of_service field used by this structure.
  out_of_service: ["Извън експлоатация", "Out of service"],
  // Provide cleaning_dirty field used by this structure.
  cleaning_dirty: ["Мръсна", "Dirty"],
  // Provide cleaning_in_progress field used by this structure.
  cleaning_in_progress: ["Почистване в процес", "Cleaning in progress"],
  // Provide cleaning_pending_inspection field used by this structure.
  cleaning_pending_inspection: ["Чака проверка", "Pending inspection"],
};

// Define function mapLabel and its behavior.
function mapLabel(
  // Provide locale field used by this structure.
  locale: BoardLocale,
  // Provide table field used by this structure.
  table: Record<string, [string, string]>,
  // Provide value field used by this structure.
  value: string,
// Support the surrounding logic for this step.
): string {
  // Bind pair for use in the following logic.
  const pair = table[value];
  // Conditional branch for the case described by this guard.
  if (!pair) return value;
  // Return early result or rendered output from this path.
  return boardT(locale, pair[0], pair[1]);
}

// Export function readinessLabel as part of this module's API.
export function readinessLabel(locale: BoardLocale, value: string): string {
  // Return early result or rendered output from this path.
  return mapLabel(locale, READINESS, value);
}

// Export function cleaningLabel as part of this module's API.
export function cleaningLabel(locale: BoardLocale, value: string): string {
  // Return early result or rendered output from this path.
  return mapLabel(locale, CLEANING, value);
}

// Export function occupancyLabel as part of this module's API.
export function occupancyLabel(locale: BoardLocale, value: string): string {
  // Return early result or rendered output from this path.
  return mapLabel(locale, OCCUPANCY, value);
}

// Export function serviceLabel as part of this module's API.
export function serviceLabel(locale: BoardLocale, value: string): string {
  // Return early result or rendered output from this path.
  return mapLabel(locale, SERVICE, value);
}

// Export function taskStatusLabel as part of this module's API.
export function taskStatusLabel(locale: BoardLocale, value: string): string {
  // Return early result or rendered output from this path.
  return mapLabel(locale, TASK_STATUS, value);
}

// Export function priorityLabel as part of this module's API.
export function priorityLabel(locale: BoardLocale, value: string): string {
  // Return early result or rendered output from this path.
  return mapLabel(locale, PRIORITY, value);
}

// Export function reasonLabel as part of this module's API.
export function reasonLabel(locale: BoardLocale, value: string): string {
  // Return early result or rendered output from this path.
  return mapLabel(locale, REASON, value);
}

/** Derive the next operational action hint for a room/zone row. */
export function nextActionLabel(
  // Provide locale field used by this structure.
  locale: BoardLocale,
  // Provide location field used by this structure.
  location: {
    // Provide cleaningStatus field used by this structure.
    cleaningStatus: string;
    // Provide readiness field used by this structure.
    readiness: string;
    // Provide activeTask field used by this structure.
    activeTask: {
      // Provide status field used by this structure.
      status: string;
      // Provide runningSession field used by this structure.
      runningSession: unknown;
      // Provide assignee field used by this structure.
      assignee: { fullName: string } | null;
    // Support the surrounding logic for this step.
    } | null;
  },
  // Support the surrounding logic for this step.
  opts?: { isCommon?: boolean },
// Support the surrounding logic for this step.
): string {
  // Bind task for use in the following logic.
  const task = location.activeTask;
  // Conditional branch for the case described by this guard.
  if (task?.runningSession) {
    // Return early result or rendered output from this path.
    return boardT(locale, "Завърши почистването", "Complete cleaning");
  }
  // Conditional branch for the case described by this guard.
  if (task?.status === "awaiting_inspection") {
    // Return early result or rendered output from this path.
    return boardT(locale, "Направи проверка", "Inspect");
  }
  // Conditional branch for the case described by this guard.
  if (task?.status === "rework" || task?.status === "assigned") {
    // Return early result or rendered output from this path.
    return boardT(locale, "Започни почистване", "Start cleaning");
  }
  // Conditional branch for the case described by this guard.
  if (location.cleaningStatus === "dirty" && !task) {
    // Return early result or rendered output from this path.
    return boardT(locale, "Създай задача", "Create task");
  }
  // Conditional branch for the case described by this guard.
  if (location.readiness === "ready") {
    // Return early result or rendered output from this path.
    return boardT(locale, "Готова", "Ready");
  }
  // Return early result or rendered output from this path.
  return opts?.isCommon
    // Support the surrounding logic for this step.
    ? boardT(locale, "Прегледай зоната", "Review zone")
    // Support the surrounding logic for this step.
    : boardT(locale, "Прегледай стаята", "Review room");
}
