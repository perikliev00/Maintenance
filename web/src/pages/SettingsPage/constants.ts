export type Tab =
  | "modules"
  | "flags"
  | "interface"
  | "operations"
  | "access"
  | "notifications"
  | "history"
  | "issues";

export const TABS: Array<{ id: Tab; bg: string; en: string }> = [
  { id: "modules", bg: "Модули", en: "Modules" },
  { id: "flags", bg: "Флагове", en: "Flags" },
  { id: "interface", bg: "Интерфейс", en: "Interface" },
  { id: "operations", bg: "Операции", en: "Operations" },
  { id: "access", bg: "Достъп", en: "Access" },
  { id: "notifications", bg: "Известия", en: "Notifications" },
  { id: "history", bg: "Хронология", en: "Timeline" },
];

export const MODULE_LABELS: Record<string, string> = {
  rooms: "Стаи",
  common: "Общи части",
  cleaning: "Почистване",
  maintenance: "Поддръжка",
  my_work: "Моите задачи",
  repairs: "Повреди",
  team: "Екип",
  live: "На живо",
  control: "Контрол",
  daily_plan: "Дневен план (Clock)",
  attendance: "Присъствие",
  access_cards: "Карти",
  analytics: "Аналитика",
  audit: "Одит",
};

export const FLAG_LABELS: Record<string, string> = {
  require_inspection: "Изисквай инспекция след почистване",
  one_active_session_per_employee: "Една активна сесия на служител",
  allow_reception_reassign: "Рецепция може да преназначава",
  block_room_on_urgent_ticket: "Авто-блок при спешен тикет (резерв)",
  show_overdue_banner: "Показвай overdue банер",
};

export type LabelFn = (bg: string, en: string) => string;
