/** Labels and sample JSON payload for the daily-plan UI. */
import type { DailyPlanCategory } from "../../api/client";

// Export CATEGORY_LABELS for use by other modules.
export const CATEGORY_LABELS: Record<DailyPlanCategory, string> = {
  departure: "Заминаващи",
  arrival: "Пристигащи",
  priority: "Приоритетни",
};

// Export SOURCE_LABELS for use by other modules.
export const SOURCE_LABELS: Record<string, string> = {
  manual: "ръчен",
  import: "импорт",
};

// Export TASK_STATUS_BG for use by other modules.
export const TASK_STATUS_BG: Record<string, string> = {
  assigned: "възложена",
  in_progress: "в ход",
  awaiting_inspection: "чака инспекция",
  rework: "повторна работа",
  completed: "завършена",
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
