import type { DailyPlanCategory } from "../../api/client";

export const CATEGORY_LABELS: Record<DailyPlanCategory, string> = {
  departure: "Заминаващи",
  arrival: "Пристигащи",
  priority: "Приоритетни",
};

export const SOURCE_LABELS: Record<string, string> = {
  manual: "ръчен",
  import: "импорт",
};

export const TASK_STATUS_BG: Record<string, string> = {
  assigned: "възложена",
  in_progress: "в ход",
  awaiting_inspection: "чака инспекция",
  rework: "повторна работа",
  completed: "завършена",
  cancelled: "отказана",
};

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
