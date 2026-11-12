/**
 * Human-readable audit / job labels (BG + EN) for filters and detail panels.
 * Falls back to a light humanize of unknown keys so new server actions still render.
 */
import type { AuditEventRow } from "../api/client";

export type AuditLocale = "bg" | "en";

type Labeled = { bg: string; en: string };

/** Pick BG or EN from a bilingual label pair. */
export function pick(locale: AuditLocale, pair: Labeled): string {
  return locale === "en" ? pair.en : pair.bg;
}

/** Fallback display for unknown action keys (dots → spaces, capitalize). */
export function humanizeKey(key: string): string {
  return key
    .replace(/[._]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
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
    bg: "Създадена задача за почистване",
    en: "Cleaning task created",
  },
  // Map key cleaning.task.start to its bilingual / structured value.
  "cleaning.task.start": {
    bg: "Започнато почистване",
    en: "Cleaning started",
  },
  // Map key cleaning.task.reassign to its bilingual / structured value.
  "cleaning.task.reassign": {
    bg: "Преназначена задача за почистване",
    en: "Cleaning task reassigned",
  },
  // Map key cleaning.session.complete to its bilingual / structured value.
  "cleaning.session.complete": {
    bg: "Почистването е приключено",
    en: "Cleaning completed",
  },
  // Map key cleaning.session.cancel to its bilingual / structured value.
  "cleaning.session.cancel": {
    bg: "Почистването е отменено",
    en: "Cleaning cancelled",
  },
  // Map key cleaning.inspect to its bilingual / structured value.
  "cleaning.inspect": {
    bg: "Проверка на почистване",
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
    bg: "Променена заетост",
    en: "Occupancy updated",
  },
  // Map key location.set_service_status to its bilingual / structured value.
  "location.set_service_status": {
    bg: "Променен сервизен статус",
    en: "Service status updated",
  },
  // Map key location.mark_dirty to its bilingual / structured value.
  "location.mark_dirty": {
    bg: "Помещението е маркирано като мръсно",
    en: "Location marked dirty",
  },
  // Map key location.mark_clean to its bilingual / structured value.
  "location.mark_clean": {
    bg: "Помещението е маркирано като чисто",
    en: "Location marked clean",
  },
  // Map key location.reconcile_cleaning_status to its bilingual / structured value.
  "location.reconcile_cleaning_status": {
    bg: "Синхронизиран статус на почистване",
    en: "Cleaning status reconciled",
  },
  // Map key ticket.duplicate_override to its bilingual / structured value.
  "ticket.duplicate_override": {
    bg: "Дублирана повреда (отмяна)",
    en: "Duplicate ticket override",
  },

  // Map key sector.create to its bilingual / structured value.
  "sector.create": { bg: "Създаден сектор", en: "Sector created" },
  // Map key sector.update to its bilingual / structured value.
  "sector.update": { bg: "Обновен сектор", en: "Sector updated" },
  // Map key sector.save to its bilingual / structured value.
  "sector.save": {
    bg: "Запазен сектор с помещения",
    en: "Sector saved with locations",
  },
  // Map key sector.locations.set to its bilingual / structured value.
  "sector.locations.set": {
    bg: "Обновени помещения в сектор",
    en: "Sector locations updated",
  },
  // Map key shift.roster.upsert to its bilingual / structured value.
  "shift.roster.upsert": {
    bg: "Обновен график на смени",
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
    bg: "Заявка за корекция на присъствие",
    en: "Attendance adjustment requested",
  },
  // Map key adjustment.review to its bilingual / structured value.
  "adjustment.review": {
    bg: "Преглед на корекция на присъствие",
    en: "Attendance adjustment reviewed",
  },
  // Map key attendance.review to its bilingual / structured value.
  "attendance.review": {
    bg: "Преглед на присъствие",
    en: "Attendance reviewed",
  },

  // Map key sla_policy.upsert to its bilingual / structured value.
  "sla_policy.upsert": {
    bg: "Обновена SLA политика",
    en: "SLA policy updated",
  },
  // Map key user.lock_inactive to its bilingual / structured value.
  "user.lock_inactive": {
    bg: "Заключен неактивен потребител",
    en: "Inactive user locked",
  },
  // Map key people.block to its bilingual / structured value.
  "people.block": { bg: "Блокиран служител", en: "Employee blocked" },
  // Map key people.unblock to its bilingual / structured value.
  "people.unblock": { bg: "Отблокиран служител", en: "Employee unblocked" },
  // Map key people.archive to its bilingual / structured value.
  "people.archive": {
    bg: "Архивиран служител",
    en: "Employee archived",
  },
  // Map key people.restore to its bilingual / structured value.
  "people.restore": {
    bg: "Възстановен служител",
    en: "Employee restored",
  },
  // Map key session.overdue_detected to its bilingual / structured value.
  "session.overdue_detected": {
    bg: "Открита просрочена сесия",
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
    bg: "Импорт на дневен план",
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
  ticket: { bg: "Повреда", en: "Ticket" },
  maintenance_ticket: { bg: "Повреда", en: "Ticket" },
  cleaning_task: { bg: "Задача за почистване", en: "Cleaning task" },
  cleaning_session: { bg: "Сесия за почистване", en: "Cleaning session" },
  inspection: { bg: "Проверка", en: "Inspection" },
  location: { bg: "Помещение", en: "Location" },
  sector: { bg: "Сектор", en: "Sector" },
  shift_roster: { bg: "График на смени", en: "Shift roster" },
  card: { bg: "Карта", en: "Card" },
  access_card: { bg: "Карта за достъп", en: "Access card" },
  setting: { bg: "Настройка", en: "Setting" },
  role_grant: { bg: "Право", en: "Permission" },
  attendance_adjustment: {
    bg: "Корекция на присъствие",
    en: "Attendance adjustment",
  },
  user: { bg: "Потребител", en: "User" },
  sla_policy: { bg: "SLA политика", en: "SLA policy" },
  sync_run: { bg: "Синхронизация", en: "Sync run" },
  daily_plan_import_batch: {
    bg: "Импорт на дневен план",
    en: "Daily plan import",
  },
  device: { bg: "Устройство", en: "Device" },
  invitation: { bg: "Покана", en: "Invitation" },
  employee: { bg: "Служител", en: "Employee" },
};

/** Bilingual / lookup table `JOB_KEY_LABELS` (data only). */
const JOB_KEY_LABELS: Record<string, Labeled> = {
  lock_inactive_users: {
    bg: "Заключване на неактивни потребители",
    en: "Lock inactive users",
  },
  overdue_sessions: {
    bg: "Проверка за просрочени сесии",
    en: "Overdue sessions check",
  },
  ticket_sla_breach: {
    bg: "Проверка за SLA нарушения",
    en: "Ticket SLA breach check",
  },
  // Map key daily_plan.import to its bilingual / structured value.
  "daily_plan.import": {
    bg: "Импорт на дневен план",
    en: "Daily plan import",
  },
  // Map key attendance.normalize to its bilingual / structured value.
  "attendance.normalize": {
    bg: "Нормализация на присъствие",
    en: "Attendance normalize",
  },
  // Map key analytics.rebuild to its bilingual / structured value.
  "analytics.rebuild": {
    bg: "Преизчисляване на аналитика",
    en: "Analytics rebuild",
  },
  // Map key sessions.anomaly_scan to its bilingual / structured value.
  "sessions.anomaly_scan": {
    bg: "Сканиране за аномалии в сесии",
    en: "Session anomaly scan",
  },
  stale_open_attendance: {
    bg: "Просрочени отворени присъствия",
    en: "Stale open attendance",
  },
};

/** Bilingual / lookup table `STATUS_LABELS` (data only). */
const STATUS_LABELS: Record<string, Labeled> = {
  new: { bg: "нова", en: "new" },
  assigned: { bg: "назначена", en: "assigned" },
  in_progress: { bg: "в работа", en: "in progress" },
  waiting: { bg: "изчакване", en: "waiting" },
  resolved: { bg: "отстранена", en: "resolved" },
  closed: { bg: "затворена", en: "closed" },
  running: { bg: "тече", en: "running" },
  completed: { bg: "приключена", en: "completed" },
  cancelled: { bg: "отменена", en: "cancelled" },
  dirty: { bg: "мръсно", en: "dirty" },
  clean: { bg: "чисто", en: "clean" },
  ok: { bg: "успешно", en: "ok" },
  error: { bg: "грешка", en: "error" },
  failed: { bg: "неуспешно", en: "failed" },
  succeeded: { bg: "успешно", en: "succeeded" },
};

/** Build filter options from a bilingual label map (keeps filters in sync). */
function filtersFromLabels(
  labels: Record<string, Labeled>,
  order: string[],
): { value: string; bg: string; en: string }[] {
  return order
    .filter((value) => labels[value])
    .map((value) => ({ value, ...labels[value]! }));
}

/**
 * Live producer actions that must remain filterable (sync with
 * api/src/services/audit.producers.ts).
 */
export const REQUIRED_AUDIT_PRODUCER_ACTIONS = [
  "ticket.create",
  "ticket.assign",
  "ticket.start",
  "ticket.wait",
  "ticket.resume",
  "ticket.resolve",
  "ticket.close",
  "ticket.reopen",
  "ticket.sla_breach",
  "ticket.duplicate_override",
  "cleaning.task.create",
  "cleaning.task.start",
  "cleaning.task.reassign",
  "cleaning.session.complete",
  "cleaning.session.cancel",
  "cleaning.inspect",
  "session.overdue_detected",
  "location.create",
  "location.update",
  "location.archive",
  "location.restore",
  "location.set_occupancy",
  "location.set_service_status",
  "location.mark_dirty",
  "location.reconcile_cleaning_status",
  "sector.create",
  "sector.update",
  "sector.save",
  "shift.roster.upsert",
  "card.issue",
  "card.revoke",
  "setting.update",
  "permission.grant",
  "permission.revoke",
  "adjustment.request",
  "adjustment.review",
  "sla_policy.upsert",
  "user.lock_inactive",
  "people.block",
  "people.unblock",
  "people.archive",
  "people.restore",
  "device.revoke",
  "sync.push",
] as const;

/** Actions shown in the audit filter dropdown (friendly order). */
export const AUDIT_ACTION_FILTERS: { value: string; bg: string; en: string }[] =
  filtersFromLabels(ACTION_LABELS, [
    "ticket.create",
    "ticket.assign",
    "ticket.start",
    "ticket.wait",
    "ticket.resume",
    "ticket.resolve",
    "ticket.close",
    "ticket.reopen",
    "ticket.sla_breach",
    "ticket.duplicate_override",
    "cleaning.task.create",
    "cleaning.task.start",
    "cleaning.task.reassign",
    "cleaning.session.complete",
    "cleaning.session.cancel",
    "cleaning.inspect",
    "session.start",
    "session.complete",
    "session.overdue_detected",
    "task.rework",
    "location.create",
    "location.update",
    "location.archive",
    "location.restore",
    "location.set_occupancy",
    "location.set_service_status",
    "location.mark_dirty",
    "location.mark_clean",
    "location.reconcile_cleaning_status",
    "sector.create",
    "sector.update",
    "sector.save",
    "sector.locations.set",
    "shift.roster.upsert",
    "card.issue",
    "card.revoke",
    "setting.update",
    "permission.grant",
    "permission.revoke",
    "adjustment.request",
    "adjustment.review",
    "attendance.review",
    "sla_policy.upsert",
    "user.lock_inactive",
    "people.block",
    "people.unblock",
    "people.archive",
    "people.restore",
    "device.revoke",
    "invitation.revoke",
    "daily_plan.import",
    "sync.push",
  ]);

/** Entity types shown in the audit filter dropdown. */
export const AUDIT_ENTITY_FILTERS: { value: string; bg: string; en: string }[] =
  filtersFromLabels(ENTITY_TYPE_LABELS, [
    "ticket",
    "maintenance_ticket",
    "cleaning_task",
    "cleaning_session",
    "inspection",
    "location",
    "sector",
    "shift_roster",
    "card",
    "access_card",
    "setting",
    "role_grant",
    "attendance_adjustment",
    "user",
    "employee",
    "device",
    "invitation",
    "sla_policy",
    "sync_run",
    "daily_plan_import_batch",
  ]);

/** Localized action name for list rows and filters. */
export function actionLabel(action: string, locale: AuditLocale): string {
  const known = ACTION_LABELS[action];
  if (known) return pick(locale, known);
  return humanizeKey(action);
}

/** Localized entity type for filters and chips. */
export function entityTypeLabel(
  entityType: string,
  locale: AuditLocale,
): string {
  const known = ENTITY_TYPE_LABELS[entityType];
  if (known) return pick(locale, known);
  return humanizeKey(entityType);
}

/** Localized status chip (ticket / cleaning / etc.). */
export function statusLabel(status: string, locale: AuditLocale): string {
  const known = STATUS_LABELS[status];
  if (known) return pick(locale, known);
  return humanizeKey(status);
}

/** Known catalog status label, or null when the key is not in STATUS_LABELS. */
export function knownStatusLabel(
  status: string,
  locale: AuditLocale,
): string | null {
  const known = STATUS_LABELS[status];
  return known ? pick(locale, known) : null;
}

/** Prefer server `summary` when present; else action label. */
export function auditHeadline(
  row: Pick<AuditEventRow, "summary" | "action" | "entityType">,
  locale: AuditLocale,
): string {
  // Server-authored summaries win when non-empty.
  const summary = row.summary?.trim();
  if (summary) return summary;
  return actionLabel(row.action, locale);
}

/** Localized background job key for Control / audit job lists. */
export function jobKeyLabel(jobKey: string, locale: AuditLocale): string {
  const known = JOB_KEY_LABELS[jobKey];
  if (known) return pick(locale, known);
  return humanizeKey(jobKey);
}

/** Normalize job run status variants (ok/succeeded, error/failed). */
export function jobStatusLabel(status: string, locale: AuditLocale): string {
  const normalized = status.toLowerCase();
  if (normalized === "ok" || normalized === "succeeded") {
    return pick(locale, { bg: "Успешно", en: "Succeeded" });
  }
  if (normalized === "error" || normalized === "failed") {
    return pick(locale, { bg: "Грешка", en: "Failed" });
  }
  if (normalized === "running") {
    return pick(locale, { bg: "Работи", en: "Running" });
  }
  return statusLabel(status, locale);
}

export {
  formatAuditDetails,
  formatJobSummary,
} from "./formatAuditDetails";
