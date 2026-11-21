import type { Panel } from "../api/client";
export const WORKSPACES = [
  { id: "operations", en: "Operations", bg: "Операции", panels: ["home", "live", "rooms", "common", "plan", "repairs"] },
  { id: "people", en: "People & work", bg: "Екип и задачи", panels: ["mywork", "cleaning", "team", "attendance", "cards"] },
  { id: "insights", en: "Insights", bg: "Анализи", panels: ["analytics", "results", "audit"] },
  { id: "administration", en: "Administration", bg: "Управление", panels: ["control", "permissions", "settings", "notifications"] },
] as const;
export const PANEL_NAMES: Record<Panel, { en: string; bg: string }> = {
  home: { en: "Home", bg: "Начало" }, live: { en: "Live", bg: "На живо" }, rooms: { en: "Rooms", bg: "Стаи" }, common: { en: "Common", bg: "Общи части" },
  plan: { en: "Plan", bg: "План" }, repairs: { en: "Repairs", bg: "Повреди" }, mywork: { en: "My Work", bg: "Моите задачи" }, cleaning: { en: "Housekeeping", bg: "Почистване" },
  team: { en: "Team", bg: "Екип" }, attendance: { en: "Attendance", bg: "Присъствие" }, cards: { en: "Cards", bg: "Карти" }, analytics: { en: "Analytics", bg: "Аналитика" },
  results: { en: "Results", bg: "Резултати" }, audit: { en: "Audit", bg: "Одит" }, control: { en: "Control", bg: "Контрол" }, permissions: { en: "Permissions", bg: "Права" },
  settings: { en: "Settings", bg: "Настройки" }, notifications: { en: "Notifications", bg: "Известия" },
};
export function workspaceFor(panel: Panel) {
  return WORKSPACES.find(group => (group.panels as readonly string[]).includes(panel)) ?? WORKSPACES[0];
}
