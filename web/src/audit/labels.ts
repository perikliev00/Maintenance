/**
 * Human-readable audit / job labels (BG + EN) for filters and detail panels.
 * Falls back to a light humanize of unknown keys so new server actions still render.
 */
import type { AuditEventRow } from "../api/client";

// Export type definition for consumers of this module.
export type AuditLocale = "bg" | "en";

// Declare type alias Labeled.
type Labeled = { bg: string; en: string };

/** Pick BG or EN from a bilingual label pair. */
export function pick(locale: AuditLocale, pair: Labeled): string {
  // Return value / early exit.
  return locale === "en" ? pair.en : pair.bg;
}

/** Fallback display for unknown action keys (dots → spaces, capitalize). */
export function humanizeKey(key: string): string {
  // Return value / early exit.
  return key
    // Continue a chained call building on the previous expression.
    .replace(/[._]/g, " ")
    // Continue a chained call building on the previous expression.
    .replace(/\s+/g, " ")
    // Continue a chained call building on the previous expression.
    .trim()
    // Continue a chained call building on the previous expression.
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** Bilingual / lookup table `ACTION_LABELS` (data only). */
const ACTION_LABELS: Record<string, Labeled> = {
  // Map key ticket.create to its bilingual / structured value.
  "ticket.create": { bg: "Създадена повреда", en: "Ticket created" },
  // Map key ticket.assign to its bilingual / structured value.
  "ticket.assign": { bg: "Назначена повреда", en: "Ticket assigned" },
  // Map key ticket.start to its bilingual / structured value.
  "ticket.start": { bg: "Започната работа по повреда", en: "Ticket started" },
  // Map key ticket.wait to its bilingual / structured value.
  "ticket.wait": { bg: "Повреда на изчакване", en: "Ticket waiting" },
  // Map key ticket.resume to its bilingual / structured value.
  "ticket.resume": { bg: "Повредата е подновена", en: "Ticket resumed" },
  // Map key ticket.resolve to its bilingual / structured value.
  "ticket.resolve": { bg: "Повредата е отстранена", en: "Ticket resolved" },
  // Map key ticket.close to its bilingual / structured value.
  "ticket.close": { bg: "Повредата е затворена", en: "Ticket closed" },
  // Map key ticket.reopen to its bilingual / structured value.
  "ticket.reopen": { bg: "Повредата е отворена отново", en: "Ticket reopened" },
  // Map key ticket.sla_breach to its bilingual / structured value.
  "ticket.sla_breach": { bg: "Нарушен SLA за повреда", en: "Ticket SLA breached" },

  // Map key cleaning.task.create to its bilingual / structured value.
  "cleaning.task.create": {
    // Bilingual label for action/entity key bg.
    bg: "Създадена задача за почистване",
    // Bilingual label for action/entity key en.
    en: "Cleaning task created",
  },
  // Map key cleaning.task.start to its bilingual / structured value.
  "cleaning.task.start": {
    // Bilingual label for action/entity key bg.
    bg: "Започнато почистване",
    // Bilingual label for action/entity key en.
    en: "Cleaning started",
  },
  // Map key cleaning.task.reassign to its bilingual / structured value.
  "cleaning.task.reassign": {
    // Bilingual label for action/entity key bg.
    bg: "Преназначена задача за почистване",
    // Bilingual label for action/entity key en.
    en: "Cleaning task reassigned",
  },
  // Map key cleaning.session.complete to its bilingual / structured value.
  "cleaning.session.complete": {
    // Bilingual label for action/entity key bg.
    bg: "Почистването е приключено",
    // Bilingual label for action/entity key en.
    en: "Cleaning completed",
  },
  // Map key cleaning.session.cancel to its bilingual / structured value.
  "cleaning.session.cancel": {
    // Bilingual label for action/entity key bg.
    bg: "Почистването е отменено",
    // Bilingual label for action/entity key en.
    en: "Cleaning cancelled",
  },
  // Map key cleaning.inspect to its bilingual / structured value.
  "cleaning.inspect": {
    // Bilingual label for action/entity key bg.
    bg: "Проверка на почистване",
    // Bilingual label for action/entity key en.
    en: "Cleaning inspected",
  },

  // Map key location.create to its bilingual / structured value.
  "location.create": { bg: "Създадено помещение", en: "Location created" },
  // Map key location.update to its bilingual / structured value.
  "location.update": { bg: "Обновено помещение", en: "Location updated" },
  // Map key location.archive to its bilingual / structured value.
  "location.archive": { bg: "Архивирано помещение", en: "Location archived" },
  // Map key location.restore to its bilingual / structured value.
  "location.restore": { bg: "Възстановено помещение", en: "Location restored" },
  // Map key location.set_occupancy to its bilingual / structured value.
  "location.set_occupancy": {
    // Bilingual label for action/entity key bg.
    bg: "Променена заетост",
    // Bilingual label for action/entity key en.
    en: "Occupancy updated",
  },
  // Map key location.set_service_status to its bilingual / structured value.
  "location.set_service_status": {
    // Bilingual label for action/entity key bg.
    bg: "Променен сервизен статус",
    // Bilingual label for action/entity key en.
    en: "Service status updated",
  },
  // Map key location.mark_dirty to its bilingual / structured value.
  "location.mark_dirty": {
    // Bilingual label for action/entity key bg.
    bg: "Помещението е маркирано като мръсно",
    // Bilingual label for action/entity key en.
    en: "Location marked dirty",
  },
  // Map key location.mark_clean to its bilingual / structured value.
  "location.mark_clean": {
    // Bilingual label for action/entity key bg.
    bg: "Помещението е маркирано като чисто",
    // Bilingual label for action/entity key en.
    en: "Location marked clean",
  },
  // Map key location.reconcile_cleaning_status to its bilingual / structured value.
  "location.reconcile_cleaning_status": {
    // Bilingual label for action/entity key bg.
    bg: "Синхронизиран статус на почистване",
    // Bilingual label for action/entity key en.
    en: "Cleaning status reconciled",
  },
  // Map key ticket.duplicate_override to its bilingual / structured value.
  "ticket.duplicate_override": {
    // Bilingual label for action/entity key bg.
    bg: "Дублирана повреда (отмяна)",
    // Bilingual label for action/entity key en.
    en: "Duplicate ticket override",
  },

  // Map key sector.create to its bilingual / structured value.
  "sector.create": { bg: "Създаден сектор", en: "Sector created" },
  // Map key sector.update to its bilingual / structured value.
  "sector.update": { bg: "Обновен сектор", en: "Sector updated" },
  // Map key sector.save to its bilingual / structured value.
  "sector.save": {
    // Bilingual label for action/entity key bg.
    bg: "Запазен сектор с помещения",
    // Bilingual label for action/entity key en.
    en: "Sector saved with locations",
  },
  // Map key sector.locations.set to its bilingual / structured value.
  "sector.locations.set": {
    // Bilingual label for action/entity key bg.
    bg: "Обновени помещения в сектор",
    // Bilingual label for action/entity key en.
    en: "Sector locations updated",
  },
  // Map key shift.roster.upsert to its bilingual / structured value.
  "shift.roster.upsert": {
    // Bilingual label for action/entity key bg.
    bg: "Обновен график на смени",
    // Bilingual label for action/entity key en.
    en: "Shift roster updated",
  },

  // Map key card.issue to its bilingual / structured value.
  "card.issue": { bg: "Издадена карта", en: "Card issued" },
  // Map key card.revoke to its bilingual / structured value.
  "card.revoke": { bg: "Отнета карта", en: "Card revoked" },

  // Map key setting.update to its bilingual / structured value.
  "setting.update": { bg: "Обновена настройка", en: "Setting updated" },
  // Map key permission.grant to its bilingual / structured value.
  "permission.grant": { bg: "Дадено право", en: "Permission granted" },
  // Map key permission.revoke to its bilingual / structured value.
  "permission.revoke": { bg: "Отнето право", en: "Permission revoked" },

  // Map key adjustment.request to its bilingual / structured value.
  "adjustment.request": {
    // Bilingual label for action/entity key bg.
    bg: "Заявка за корекция на присъствие",
    // Bilingual label for action/entity key en.
    en: "Attendance adjustment requested",
  },
  // Map key adjustment.review to its bilingual / structured value.
  "adjustment.review": {
    // Bilingual label for action/entity key bg.
    bg: "Преглед на корекция на присъствие",
    // Bilingual label for action/entity key en.
    en: "Attendance adjustment reviewed",
  },
  // Map key attendance.review to its bilingual / structured value.
  "attendance.review": {
    // Bilingual label for action/entity key bg.
    bg: "Преглед на присъствие",
    // Bilingual label for action/entity key en.
    en: "Attendance reviewed",
  },

  // Map key sla_policy.upsert to its bilingual / structured value.
  "sla_policy.upsert": {
    // Bilingual label for action/entity key bg.
    bg: "Обновена SLA политика",
    // Bilingual label for action/entity key en.
    en: "SLA policy updated",
  },
  // Map key user.lock_inactive to its bilingual / structured value.
  "user.lock_inactive": {
    // Bilingual label for action/entity key bg.
    bg: "Заключен неактивен потребител",
    // Bilingual label for action/entity key en.
    en: "Inactive user locked",
  },
  // Map key people.block to its bilingual / structured value.
  "people.block": { bg: "Блокиран служител", en: "Employee blocked" },
  // Map key people.unblock to its bilingual / structured value.
  "people.unblock": { bg: "Отблокиран служител", en: "Employee unblocked" },
  // Map key people.archive to its bilingual / structured value.
  "people.archive": {
    // Bilingual label for action/entity key bg.
    bg: "Архивиран служител",
    // Bilingual label for action/entity key en.
    en: "Employee archived",
  },
  // Map key people.restore to its bilingual / structured value.
  "people.restore": {
    // Bilingual label for action/entity key bg.
    bg: "Възстановен служител",
    // Bilingual label for action/entity key en.
    en: "Employee restored",
  },
  // Map key session.overdue_detected to its bilingual / structured value.
  "session.overdue_detected": {
    // Bilingual label for action/entity key bg.
    bg: "Открита просрочена сесия",
    // Bilingual label for action/entity key en.
    en: "Overdue session detected",
  },
  // Map key session.start to its bilingual / structured value.
  "session.start": { bg: "Започната сесия", en: "Session started" },
  // Map key session.complete to its bilingual / structured value.
  "session.complete": { bg: "Приключена сесия", en: "Session completed" },
  // Map key sync.push to its bilingual / structured value.
  "sync.push": { bg: "Синхронизация", en: "Sync push" },
  // Map key daily_plan.import to its bilingual / structured value.
  "daily_plan.import": {
    // Bilingual label for action/entity key bg.
    bg: "Импорт на дневен план",
    // Bilingual label for action/entity key en.
    en: "Daily plan imported",
  },
  // Map key task.rework to its bilingual / structured value.
  "task.rework": { bg: "Задача за преработка", en: "Task sent for rework" },
  // Map key device.revoke to its bilingual / structured value.
  "device.revoke": { bg: "Отнето устройство", en: "Device revoked" },
  // Map key invitation.revoke to its bilingual / structured value.
  "invitation.revoke": { bg: "Отменена покана", en: "Invitation revoked" },
};

/** Bilingual / lookup table `ENTITY_TYPE_LABELS` (data only). */
const ENTITY_TYPE_LABELS: Record<string, Labeled> = {
  // Bilingual label for action/entity key ticket.
  ticket: { bg: "Повреда", en: "Ticket" },
  // Bilingual label for action/entity key maintenance_ticket.
  maintenance_ticket: { bg: "Повреда", en: "Ticket" },
  // Bilingual label for action/entity key cleaning_task.
  cleaning_task: { bg: "Задача за почистване", en: "Cleaning task" },
  // Bilingual label for action/entity key cleaning_session.
  cleaning_session: { bg: "Сесия за почистване", en: "Cleaning session" },
  // Bilingual label for action/entity key inspection.
  inspection: { bg: "Проверка", en: "Inspection" },
  // Bilingual label for action/entity key location.
  location: { bg: "Помещение", en: "Location" },
  // Bilingual label for action/entity key sector.
  sector: { bg: "Сектор", en: "Sector" },
  // Bilingual label for action/entity key shift_roster.
  shift_roster: { bg: "График на смени", en: "Shift roster" },
  // Bilingual label for action/entity key card.
  card: { bg: "Карта", en: "Card" },
  // Bilingual label for action/entity key access_card.
  access_card: { bg: "Карта за достъп", en: "Access card" },
  // Bilingual label for action/entity key setting.
  setting: { bg: "Настройка", en: "Setting" },
  // Bilingual label for action/entity key role_grant.
  role_grant: { bg: "Право", en: "Permission" },
  // Provide attendance_adjustment field used by this structure.
  attendance_adjustment: {
    // Bilingual label for action/entity key bg.
    bg: "Корекция на присъствие",
    // Bilingual label for action/entity key en.
    en: "Attendance adjustment",
  },
  // Bilingual label for action/entity key user.
  user: { bg: "Потребител", en: "User" },
  // Bilingual label for action/entity key sla_policy.
  sla_policy: { bg: "SLA политика", en: "SLA policy" },
  // Bilingual label for action/entity key sync_run.
  sync_run: { bg: "Синхронизация", en: "Sync run" },
  // Provide daily_plan_import_batch field used by this structure.
  daily_plan_import_batch: {
    // Bilingual label for action/entity key bg.
    bg: "Импорт на дневен план",
    // Bilingual label for action/entity key en.
    en: "Daily plan import",
  },
  // Bilingual label for action/entity key device.
  device: { bg: "Устройство", en: "Device" },
  // Bilingual label for action/entity key invitation.
  invitation: { bg: "Покана", en: "Invitation" },
  // Bilingual label for action/entity key employee.
  employee: { bg: "Служител", en: "Employee" },
};

/** Bilingual / lookup table `JOB_KEY_LABELS` (data only). */
const JOB_KEY_LABELS: Record<string, Labeled> = {
  // Provide lock_inactive_users field used by this structure.
  lock_inactive_users: {
    // Bilingual label for action/entity key bg.
    bg: "Заключване на неактивни потребители",
    // Bilingual label for action/entity key en.
    en: "Lock inactive users",
  },
  // Provide overdue_sessions field used by this structure.
  overdue_sessions: {
    // Bilingual label for action/entity key bg.
    bg: "Проверка за просрочени сесии",
    // Bilingual label for action/entity key en.
    en: "Overdue sessions check",
  },
  // Provide ticket_sla_breach field used by this structure.
  ticket_sla_breach: {
    // Bilingual label for action/entity key bg.
    bg: "Проверка за SLA нарушения",
    // Bilingual label for action/entity key en.
    en: "Ticket SLA breach check",
  },
  // Map key daily_plan.import to its bilingual / structured value.
  "daily_plan.import": {
    // Bilingual label for action/entity key bg.
    bg: "Импорт на дневен план",
    // Bilingual label for action/entity key en.
    en: "Daily plan import",
  },
  // Map key attendance.normalize to its bilingual / structured value.
  "attendance.normalize": {
    // Bilingual label for action/entity key bg.
    bg: "Нормализация на присъствие",
    // Bilingual label for action/entity key en.
    en: "Attendance normalize",
  },
  // Map key analytics.rebuild to its bilingual / structured value.
  "analytics.rebuild": {
    // Bilingual label for action/entity key bg.
    bg: "Преизчисляване на аналитика",
    // Bilingual label for action/entity key en.
    en: "Analytics rebuild",
  },
  // Map key sessions.anomaly_scan to its bilingual / structured value.
  "sessions.anomaly_scan": {
    // Bilingual label for action/entity key bg.
    bg: "Сканиране за аномалии в сесии",
    // Bilingual label for action/entity key en.
    en: "Session anomaly scan",
  },
  // Provide stale_open_attendance field used by this structure.
  stale_open_attendance: {
    // Bilingual label for action/entity key bg.
    bg: "Просрочени отворени присъствия",
    // Bilingual label for action/entity key en.
    en: "Stale open attendance",
  },
};

/** Bilingual / lookup table `STATUS_LABELS` (data only). */
const STATUS_LABELS: Record<string, Labeled> = {
  // Bilingual label for action/entity key new.
  new: { bg: "нова", en: "new" },
  // Bilingual label for action/entity key assigned.
  assigned: { bg: "назначена", en: "assigned" },
  // Bilingual label for action/entity key in_progress.
  in_progress: { bg: "в работа", en: "in progress" },
  // Bilingual label for action/entity key waiting.
  waiting: { bg: "изчакване", en: "waiting" },
  // Bilingual label for action/entity key resolved.
  resolved: { bg: "отстранена", en: "resolved" },
  // Bilingual label for action/entity key closed.
  closed: { bg: "затворена", en: "closed" },
  // Bilingual label for action/entity key running.
  running: { bg: "тече", en: "running" },
  // Bilingual label for action/entity key completed.
  completed: { bg: "приключена", en: "completed" },
  // Bilingual label for action/entity key cancelled.
  cancelled: { bg: "отменена", en: "cancelled" },
  // Bilingual label for action/entity key dirty.
  dirty: { bg: "мръсно", en: "dirty" },
  // Bilingual label for action/entity key clean.
  clean: { bg: "чисто", en: "clean" },
  // Bilingual label for action/entity key ok.
  ok: { bg: "успешно", en: "ok" },
  // Bilingual label for action/entity key error.
  error: { bg: "грешка", en: "error" },
  // Bilingual label for action/entity key failed.
  failed: { bg: "неуспешно", en: "failed" },
  // Bilingual label for action/entity key succeeded.
  succeeded: { bg: "успешно", en: "succeeded" },
};

/** Build filter options from a bilingual label map (keeps filters in sync). */
function filtersFromLabels(
  // Provide labels field used by this structure.
  labels: Record<string, Labeled>,
  // Provide order field used by this structure.
  order: string[],
// Support the surrounding logic for this step.
): { value: string; bg: string; en: string }[] {
  // Return early result or rendered output from this path.
  return order
    // Continue a chained call building on the previous expression.
    .filter((value) => labels[value])
    // Continue a chained call building on the previous expression.
    .map((value) => ({ value, ...labels[value]! }));
}

/**
 * Live producer actions that must remain filterable (sync with
 * api/src/services/audit.producers.ts).
 */
export const REQUIRED_AUDIT_PRODUCER_ACTIONS = [
  // Support the surrounding logic for this step.
  "ticket.create",
  // Support the surrounding logic for this step.
  "ticket.assign",
  // Support the surrounding logic for this step.
  "ticket.start",
  // Support the surrounding logic for this step.
  "ticket.wait",
  // Support the surrounding logic for this step.
  "ticket.resume",
  // Support the surrounding logic for this step.
  "ticket.resolve",
  // Support the surrounding logic for this step.
  "ticket.close",
  // Support the surrounding logic for this step.
  "ticket.reopen",
  // Support the surrounding logic for this step.
  "ticket.sla_breach",
  // Support the surrounding logic for this step.
  "ticket.duplicate_override",
  // Support the surrounding logic for this step.
  "cleaning.task.create",
  // Support the surrounding logic for this step.
  "cleaning.task.start",
  // Support the surrounding logic for this step.
  "cleaning.task.reassign",
  // Support the surrounding logic for this step.
  "cleaning.session.complete",
  // Support the surrounding logic for this step.
  "cleaning.session.cancel",
  // Support the surrounding logic for this step.
  "cleaning.inspect",
  // Support the surrounding logic for this step.
  "session.overdue_detected",
  // Support the surrounding logic for this step.
  "location.create",
  // Support the surrounding logic for this step.
  "location.update",
  // Support the surrounding logic for this step.
  "location.archive",
  // Support the surrounding logic for this step.
  "location.restore",
  // Support the surrounding logic for this step.
  "location.set_occupancy",
  // Support the surrounding logic for this step.
  "location.set_service_status",
  // Support the surrounding logic for this step.
  "location.mark_dirty",
  // Support the surrounding logic for this step.
  "location.reconcile_cleaning_status",
  // Support the surrounding logic for this step.
  "sector.create",
  // Support the surrounding logic for this step.
  "sector.update",
  // Support the surrounding logic for this step.
  "sector.save",
  // Support the surrounding logic for this step.
  "shift.roster.upsert",
  // Support the surrounding logic for this step.
  "card.issue",
  // Support the surrounding logic for this step.
  "card.revoke",
  // Support the surrounding logic for this step.
  "setting.update",
  // Support the surrounding logic for this step.
  "permission.grant",
  // Support the surrounding logic for this step.
  "permission.revoke",
  // Support the surrounding logic for this step.
  "adjustment.request",
  // Support the surrounding logic for this step.
  "adjustment.review",
  // Support the surrounding logic for this step.
  "sla_policy.upsert",
  // Support the surrounding logic for this step.
  "user.lock_inactive",
  // Support the surrounding logic for this step.
  "people.block",
  // Support the surrounding logic for this step.
  "people.unblock",
  // Support the surrounding logic for this step.
  "people.archive",
  // Support the surrounding logic for this step.
  "people.restore",
  // Support the surrounding logic for this step.
  "device.revoke",
  // Support the surrounding logic for this step.
  "sync.push",
// Support the surrounding logic for this step.
] as const;

/** Actions shown in the audit filter dropdown (friendly order). */
export const AUDIT_ACTION_FILTERS: { value: string; bg: string; en: string }[] =
  // Invoke filtersFromLabels to perform this step.
  filtersFromLabels(ACTION_LABELS, [
    // Support the surrounding logic for this step.
    "ticket.create",
    // Support the surrounding logic for this step.
    "ticket.assign",
    // Support the surrounding logic for this step.
    "ticket.start",
    // Support the surrounding logic for this step.
    "ticket.wait",
    // Support the surrounding logic for this step.
    "ticket.resume",
    // Support the surrounding logic for this step.
    "ticket.resolve",
    // Support the surrounding logic for this step.
    "ticket.close",
    // Support the surrounding logic for this step.
    "ticket.reopen",
    // Support the surrounding logic for this step.
    "ticket.sla_breach",
    // Support the surrounding logic for this step.
    "ticket.duplicate_override",
    // Support the surrounding logic for this step.
    "cleaning.task.create",
    // Support the surrounding logic for this step.
    "cleaning.task.start",
    // Support the surrounding logic for this step.
    "cleaning.task.reassign",
    // Support the surrounding logic for this step.
    "cleaning.session.complete",
    // Support the surrounding logic for this step.
    "cleaning.session.cancel",
    // Support the surrounding logic for this step.
    "cleaning.inspect",
    // Support the surrounding logic for this step.
    "session.start",
    // Support the surrounding logic for this step.
    "session.complete",
    // Support the surrounding logic for this step.
    "session.overdue_detected",
    // Support the surrounding logic for this step.
    "task.rework",
    // Support the surrounding logic for this step.
    "location.create",
    // Support the surrounding logic for this step.
    "location.update",
    // Support the surrounding logic for this step.
    "location.archive",
    // Support the surrounding logic for this step.
    "location.restore",
    // Support the surrounding logic for this step.
    "location.set_occupancy",
    // Support the surrounding logic for this step.
    "location.set_service_status",
    // Support the surrounding logic for this step.
    "location.mark_dirty",
    // Support the surrounding logic for this step.
    "location.mark_clean",
    // Support the surrounding logic for this step.
    "location.reconcile_cleaning_status",
    // Support the surrounding logic for this step.
    "sector.create",
    // Support the surrounding logic for this step.
    "sector.update",
    // Support the surrounding logic for this step.
    "sector.save",
    // Support the surrounding logic for this step.
    "sector.locations.set",
    // Support the surrounding logic for this step.
    "shift.roster.upsert",
    // Support the surrounding logic for this step.
    "card.issue",
    // Support the surrounding logic for this step.
    "card.revoke",
    // Support the surrounding logic for this step.
    "setting.update",
    // Support the surrounding logic for this step.
    "permission.grant",
    // Support the surrounding logic for this step.
    "permission.revoke",
    // Support the surrounding logic for this step.
    "adjustment.request",
    // Support the surrounding logic for this step.
    "adjustment.review",
    // Support the surrounding logic for this step.
    "attendance.review",
    // Support the surrounding logic for this step.
    "sla_policy.upsert",
    // Support the surrounding logic for this step.
    "user.lock_inactive",
    // Support the surrounding logic for this step.
    "people.block",
    // Support the surrounding logic for this step.
    "people.unblock",
    // Support the surrounding logic for this step.
    "people.archive",
    // Support the surrounding logic for this step.
    "people.restore",
    // Support the surrounding logic for this step.
    "device.revoke",
    // Support the surrounding logic for this step.
    "invitation.revoke",
    // Support the surrounding logic for this step.
    "daily_plan.import",
    // Support the surrounding logic for this step.
    "sync.push",
  // Support the surrounding logic for this step.
  ]);

/** Entity types shown in the audit filter dropdown. */
export const AUDIT_ENTITY_FILTERS: { value: string; bg: string; en: string }[] =
  // Invoke filtersFromLabels to perform this step.
  filtersFromLabels(ENTITY_TYPE_LABELS, [
    // Support the surrounding logic for this step.
    "ticket",
    // Support the surrounding logic for this step.
    "maintenance_ticket",
    // Support the surrounding logic for this step.
    "cleaning_task",
    // Support the surrounding logic for this step.
    "cleaning_session",
    // Support the surrounding logic for this step.
    "inspection",
    // Support the surrounding logic for this step.
    "location",
    // Support the surrounding logic for this step.
    "sector",
    // Support the surrounding logic for this step.
    "shift_roster",
    // Support the surrounding logic for this step.
    "card",
    // Support the surrounding logic for this step.
    "access_card",
    // Support the surrounding logic for this step.
    "setting",
    // Support the surrounding logic for this step.
    "role_grant",
    // Support the surrounding logic for this step.
    "attendance_adjustment",
    // Support the surrounding logic for this step.
    "user",
    // Support the surrounding logic for this step.
    "employee",
    // Support the surrounding logic for this step.
    "device",
    // Support the surrounding logic for this step.
    "invitation",
    // Support the surrounding logic for this step.
    "sla_policy",
    // Support the surrounding logic for this step.
    "sync_run",
    // Support the surrounding logic for this step.
    "daily_plan_import_batch",
  // Support the surrounding logic for this step.
  ]);

/** Localized action name for list rows and filters. */
export function actionLabel(action: string, locale: AuditLocale): string {
  // Bind known for use in the following logic.
  const known = ACTION_LABELS[action];
  // Conditional branch for the case described by this guard.
  if (known) return pick(locale, known);
  // Return early result or rendered output from this path.
  return humanizeKey(action);
}

/** Localized entity type for filters and chips. */
export function entityTypeLabel(
  // Provide entityType field used by this structure.
  entityType: string,
  // Provide locale field used by this structure.
  locale: AuditLocale,
// Support the surrounding logic for this step.
): string {
  // Bind known for use in the following logic.
  const known = ENTITY_TYPE_LABELS[entityType];
  // Branch: conditional gate.
  if (known) return pick(locale, known);
  // Return value / early exit.
  return humanizeKey(entityType);
}

/** Localized status chip (ticket / cleaning / etc.). */
export function statusLabel(status: string, locale: AuditLocale): string {
  // Bind known for use in the following logic.
  const known = STATUS_LABELS[status];
  // Branch: conditional gate.
  if (known) return pick(locale, known);
  // Return value / early exit.
  return humanizeKey(status);
}

/** Known catalog status label, or null when the key is not in STATUS_LABELS. */
export function knownStatusLabel(
  // Provide status field used by this structure.
  status: string,
  // Provide locale field used by this structure.
  locale: AuditLocale,
// Support the surrounding logic for this step.
): string | null {
  // Bind known for use in the following logic.
  const known = STATUS_LABELS[status];
  // Return early result or rendered output from this path.
  return known ? pick(locale, known) : null;
}

/** Prefer server `summary` when present; else action label. */
export function auditHeadline(
  // Provide row field used by this structure.
  row: Pick<AuditEventRow, "summary" | "action" | "entityType">,
  // Provide locale field used by this structure.
  locale: AuditLocale,
// Support the surrounding logic for this step.
): string {
  // Server-authored summaries win when non-empty.
  const summary = row.summary?.trim();
  // Branch: conditional gate.
  if (summary) return summary;
  // Return value / early exit.
  return actionLabel(row.action, locale);
}

/** Localized background job key for Control / audit job lists. */
export function jobKeyLabel(jobKey: string, locale: AuditLocale): string {
  // Bind known for use in the following logic.
  const known = JOB_KEY_LABELS[jobKey];
  // Branch: conditional gate.
  if (known) return pick(locale, known);
  // Return value / early exit.
  return humanizeKey(jobKey);
}

/** Normalize job run status variants (ok/succeeded, error/failed). */
export function jobStatusLabel(status: string, locale: AuditLocale): string {
  // Bind normalized for use in the following logic.
  const normalized = status.toLowerCase();
  // Branch: conditional gate.
  if (normalized === "ok" || normalized === "succeeded") {
    // Return value / early exit.
    return pick(locale, { bg: "Успешно", en: "Succeeded" });
  }
  // Branch: conditional gate.
  if (normalized === "error" || normalized === "failed") {
    // Return value / early exit.
    return pick(locale, { bg: "Грешка", en: "Failed" });
  }
  // Branch: conditional gate.
  if (normalized === "running") {
    // Return value / early exit.
    return pick(locale, { bg: "Работи", en: "Running" });
  }
  // Return value / early exit.
  return statusLabel(status, locale);
}

// Support the surrounding logic for this step.
export {
  // List item in import/export/params.
  formatAuditDetails,
  // List item in import/export/params.
  formatJobSummary,
// Support the surrounding logic for this step.
} from "./formatAuditDetails";
