/** Tab ids, nav labels, and human labels for module/flag keys. */
export type Tab =
  // Support the surrounding logic for this step.
  | "modules"
  // Support the surrounding logic for this step.
  | "flags"
  // Support the surrounding logic for this step.
  | "interface"
  // Support the surrounding logic for this step.
  | "operations"
  // Support the surrounding logic for this step.
  | "access"
  // Support the surrounding logic for this step.
  | "notifications"
  // Support the surrounding logic for this step.
  | "history"
  // Support the surrounding logic for this step.
  | "issues";

// Export TABS for use by other modules.
export const TABS: Array<{ id: Tab; bg: string; en: string }> = [
  // Support the surrounding logic for this step.
  { id: "modules", bg: "Модули", en: "Modules" },
  // Support the surrounding logic for this step.
  { id: "flags", bg: "Флагове", en: "Flags" },
  // Support the surrounding logic for this step.
  { id: "interface", bg: "Интерфейс", en: "Interface" },
  // Support the surrounding logic for this step.
  { id: "operations", bg: "Операции", en: "Operations" },
  // Support the surrounding logic for this step.
  { id: "access", bg: "Достъп", en: "Access" },
  // Support the surrounding logic for this step.
  { id: "notifications", bg: "Известия", en: "Notifications" },
  // Support the surrounding logic for this step.
  { id: "history", bg: "Хронология", en: "Timeline" },
];

// Export MODULE_LABELS for use by other modules.
export const MODULE_LABELS: Record<string, string> = {
  // Provide rooms field used by this structure.
  rooms: "Стаи",
  // Provide common field used by this structure.
  common: "Общи части",
  // Provide cleaning field used by this structure.
  cleaning: "Почистване",
  // Provide maintenance field used by this structure.
  maintenance: "Поддръжка",
  // Provide my_work field used by this structure.
  my_work: "Моите задачи",
  // Provide repairs field used by this structure.
  repairs: "Повреди",
  // Provide team field used by this structure.
  team: "Екип",
  // Provide live field used by this structure.
  live: "На живо",
  // Provide control field used by this structure.
  control: "Контрол",
  // Provide daily_plan field used by this structure.
  daily_plan: "Дневен план (Clock)",
  // Provide attendance field used by this structure.
  attendance: "Присъствие",
  // Provide access_cards field used by this structure.
  access_cards: "Карти",
  // Provide analytics field used by this structure.
  analytics: "Аналитика",
  // Provide audit field used by this structure.
  audit: "Одит",
};

// Export FLAG_LABELS for use by other modules.
export const FLAG_LABELS: Record<string, string> = {
  // Provide require_inspection field used by this structure.
  require_inspection: "Изисквай инспекция след почистване",
  // Provide one_active_session_per_employee field used by this structure.
  one_active_session_per_employee: "Една активна сесия на служител",
  // Provide allow_reception_reassign field used by this structure.
  allow_reception_reassign: "Рецепция може да преназначава",
  // Provide block_room_on_urgent_ticket field used by this structure.
  block_room_on_urgent_ticket: "Авто-блок при спешен тикет (резерв)",
  // Provide show_overdue_banner field used by this structure.
  show_overdue_banner: "Показвай overdue банер",
};

// Export type definition for consumers of this module.
export type { LabelFn } from "../../i18n";
