/** Labels and sample JSON payload for the daily-plan UI. */
import type { DailyPlanCategory } from "../../api/client";

// Export CATEGORY_LABELS for use by other modules.
export const CATEGORY_LABELS: Record<DailyPlanCategory, string> = {
  // Provide departure field used by this structure.
  departure: "Заминаващи",
  // Provide arrival field used by this structure.
  arrival: "Пристигащи",
  // Provide priority field used by this structure.
  priority: "Приоритетни",
};

// Export SOURCE_LABELS for use by other modules.
export const SOURCE_LABELS: Record<string, string> = {
  // Provide manual field used by this structure.
  manual: "ръчен",
  // Provide import field used by this structure.
  import: "импорт",
};

// Export TASK_STATUS_BG for use by other modules.
export const TASK_STATUS_BG: Record<string, string> = {
  // Provide assigned field used by this structure.
  assigned: "възложена",
  // Provide in_progress field used by this structure.
  in_progress: "в ход",
  // Provide awaiting_inspection field used by this structure.
  awaiting_inspection: "чака инспекция",
  // Provide rework field used by this structure.
  rework: "повторна работа",
  // Provide completed field used by this structure.
  completed: "завършена",
  // Provide cancelled field used by this structure.
  cancelled: "отказана",
};

// Export EXAMPLE_IMPORT for use by other modules.
export const EXAMPLE_IMPORT = `{
  "hotelDate": "YYYY-MM-DD",
  "sourceLabel": "clock",
  "entries": [
    {
      "buildingCode": "A",
      "roomNumber": "102",
      "category": "departure",
      "notes": "Check-out 11:00",
      "externalId": "clock:dep:A:102:YYYY-MM-DD"
    }
  ]
}`;
