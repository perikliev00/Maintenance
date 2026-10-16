/**
 * Human-readable audit / job labels (BG + EN) for filters and detail panels.
 * Falls back to a light humanize of unknown keys so new server actions still render.
 */
import type { AuditEventRow } from "../api/client";

export type AuditLocale = "bg" | "en";

type Labeled = { bg: string; en: string };

/** Pick BG or EN from a bilingual label pair. */
function pick(locale: AuditLocale, pair: Labeled): string {
  // Return value / early exit.
  return locale === "en" ? pair.en : pair.bg;
}

/** Fallback display for unknown action keys (dots → spaces, capitalize). */
function humanizeKey(key: string): string {
  // Return value / early exit.
  return key
    .replace(/[._]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** Bilingual / lookup table `ACTION_LABELS` (data only). */
const ACTION_LABELS: Record<string, Labeled> = {
  "ticket.create": { bg: "Създадена повреда", en: "Ticket created" },
  "ticket.assign": { bg: "Назначена повреда", en: "Ticket assigned" },
  "ticket.start": { bg: "Започната работа по повреда", en: "Ticket started" },
  "ticket.wait": { bg: "Повреда на изчакване", en: "Ticket waiting" },
  "ticket.resume": { bg: "Повредата е подновена", en: "Ticket resumed" },
  "ticket.resolve": { bg: "Повредата е отстранена", en: "Ticket resolved" },
  "ticket.close": { bg: "Повредата е затворена", en: "Ticket closed" },
  "ticket.reopen": { bg: "Повредата е отворена отново", en: "Ticket reopened" },
  "ticket.sla_breach": { bg: "Нарушен SLA за повреда", en: "Ticket SLA breached" },

  "cleaning.task.create": {
    bg: "Създадена задача за почистване",
    en: "Cleaning task created",
  },
  "cleaning.task.start": {
    bg: "Започнато почистване",
    en: "Cleaning started",
  },
  "cleaning.task.reassign": {
    bg: "Преназначена задача за почистване",
    en: "Cleaning task reassigned",
  },
  "cleaning.session.complete": {
    bg: "Почистването е приключено",
    en: "Cleaning completed",
  },
  "cleaning.session.cancel": {
    bg: "Почистването е отменено",
    en: "Cleaning cancelled",
  },
  "cleaning.inspect": {
    bg: "Проверка на почистване",
    en: "Cleaning inspected",
  },

  "location.create": { bg: "Създадено помещение", en: "Location created" },
  "location.update": { bg: "Обновено помещение", en: "Location updated" },
  "location.archive": { bg: "Архивирано помещение", en: "Location archived" },
  "location.restore": { bg: "Възстановено помещение", en: "Location restored" },
  "location.set_occupancy": {
    bg: "Променена заетост",
    en: "Occupancy updated",
  },
  "location.set_service_status": {
    bg: "Променен сервизен статус",
    en: "Service status updated",
  },
  "location.mark_dirty": {
    bg: "Помещението е маркирано като мръсно",
    en: "Location marked dirty",
  },
  "location.mark_clean": {
    bg: "Помещението е маркирано като чисто",
    en: "Location marked clean",
  },

  "sector.create": { bg: "Създаден сектор", en: "Sector created" },
  "sector.update": { bg: "Обновен сектор", en: "Sector updated" },
  "sector.locations.set": {
    bg: "Обновени помещения в сектор",
    en: "Sector locations updated",
  },
  "shift.roster.upsert": {
    bg: "Обновен график на смени",
    en: "Shift roster updated",
  },

  "card.issue": { bg: "Издадена карта", en: "Card issued" },
  "card.revoke": { bg: "Отнета карта", en: "Card revoked" },

  "setting.update": { bg: "Обновена настройка", en: "Setting updated" },
  "permission.grant": { bg: "Дадено право", en: "Permission granted" },
  "permission.revoke": { bg: "Отнето право", en: "Permission revoked" },

  "adjustment.request": {
    bg: "Заявка за корекция на присъствие",
    en: "Attendance adjustment requested",
  },
  "adjustment.review": {
    bg: "Преглед на корекция на присъствие",
    en: "Attendance adjustment reviewed",
  },
  "attendance.review": {
    bg: "Преглед на присъствие",
    en: "Attendance reviewed",
  },

  "sla_policy.upsert": {
    bg: "Обновена SLA политика",
    en: "SLA policy updated",
  },
  "user.lock_inactive": {
    bg: "Заключен неактивен потребител",
    en: "Inactive user locked",
  },
  "session.overdue_detected": {
    bg: "Открита просрочена сесия",
    en: "Overdue session detected",
  },
  "session.start": { bg: "Започната сесия", en: "Session started" },
  "session.complete": { bg: "Приключена сесия", en: "Session completed" },
  "sync.push": { bg: "Синхронизация", en: "Sync push" },
  "daily_plan.import": {
    bg: "Импорт на дневен план",
    en: "Daily plan imported",
  },
  "task.rework": { bg: "Задача за преработка", en: "Task sent for rework" },
  "device.revoke": { bg: "Отнето устройство", en: "Device revoked" },
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
  "daily_plan.import": {
    bg: "Импорт на дневен план",
    en: "Daily plan import",
  },
  "attendance.normalize": {
    bg: "Нормализация на присъствие",
    en: "Attendance normalize",
  },
  "analytics.rebuild": {
    bg: "Преизчисляване на аналитика",
    en: "Analytics rebuild",
  },
  "sessions.anomaly_scan": {
    bg: "Сканиране за аномалии в сесии",
    en: "Session anomaly scan",
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

/** Actions shown in the audit filter dropdown (friendly order). */
export const AUDIT_ACTION_FILTERS: { value: string; bg: string; en: string }[] =
  [
    { value: "ticket.create", ...ACTION_LABELS["ticket.create"] },
    { value: "ticket.assign", ...ACTION_LABELS["ticket.assign"] },
    { value: "ticket.start", ...ACTION_LABELS["ticket.start"] },
    { value: "ticket.wait", ...ACTION_LABELS["ticket.wait"] },
    { value: "ticket.resume", ...ACTION_LABELS["ticket.resume"] },
    { value: "ticket.resolve", ...ACTION_LABELS["ticket.resolve"] },
    { value: "ticket.close", ...ACTION_LABELS["ticket.close"] },
    { value: "ticket.reopen", ...ACTION_LABELS["ticket.reopen"] },
    { value: "ticket.sla_breach", ...ACTION_LABELS["ticket.sla_breach"] },
    { value: "cleaning.task.create", ...ACTION_LABELS["cleaning.task.create"] },
    { value: "cleaning.task.start", ...ACTION_LABELS["cleaning.task.start"] },
    {
      value: "cleaning.task.reassign",
      ...ACTION_LABELS["cleaning.task.reassign"],
    },
    {
      value: "cleaning.session.complete",
      ...ACTION_LABELS["cleaning.session.complete"],
    },
    {
      value: "cleaning.session.cancel",
      ...ACTION_LABELS["cleaning.session.cancel"],
    },
    { value: "cleaning.inspect", ...ACTION_LABELS["cleaning.inspect"] },
    { value: "location.create", ...ACTION_LABELS["location.create"] },
    { value: "location.update", ...ACTION_LABELS["location.update"] },
    { value: "location.archive", ...ACTION_LABELS["location.archive"] },
    { value: "location.restore", ...ACTION_LABELS["location.restore"] },
    {
      value: "location.set_occupancy",
      ...ACTION_LABELS["location.set_occupancy"],
    },
    {
      value: "location.set_service_status",
      ...ACTION_LABELS["location.set_service_status"],
    },
    { value: "location.mark_dirty", ...ACTION_LABELS["location.mark_dirty"] },
    { value: "sector.create", ...ACTION_LABELS["sector.create"] },
    { value: "sector.update", ...ACTION_LABELS["sector.update"] },
    { value: "sector.locations.set", ...ACTION_LABELS["sector.locations.set"] },
    { value: "shift.roster.upsert", ...ACTION_LABELS["shift.roster.upsert"] },
    { value: "card.issue", ...ACTION_LABELS["card.issue"] },
    { value: "card.revoke", ...ACTION_LABELS["card.revoke"] },
    { value: "setting.update", ...ACTION_LABELS["setting.update"] },
    { value: "permission.grant", ...ACTION_LABELS["permission.grant"] },
    { value: "permission.revoke", ...ACTION_LABELS["permission.revoke"] },
    { value: "adjustment.request", ...ACTION_LABELS["adjustment.request"] },
    { value: "adjustment.review", ...ACTION_LABELS["adjustment.review"] },
    { value: "sla_policy.upsert", ...ACTION_LABELS["sla_policy.upsert"] },
    { value: "user.lock_inactive", ...ACTION_LABELS["user.lock_inactive"] },
    {
      value: "session.overdue_detected",
      ...ACTION_LABELS["session.overdue_detected"],
    },
    { value: "sync.push", ...ACTION_LABELS["sync.push"] },
  ];

/** Entity types shown in the audit filter dropdown. */
export const AUDIT_ENTITY_FILTERS: { value: string; bg: string; en: string }[] =
  [
    { value: "ticket", ...ENTITY_TYPE_LABELS.ticket },
    { value: "maintenance_ticket", ...ENTITY_TYPE_LABELS.maintenance_ticket },
    { value: "cleaning_task", ...ENTITY_TYPE_LABELS.cleaning_task },
    { value: "cleaning_session", ...ENTITY_TYPE_LABELS.cleaning_session },
    { value: "inspection", ...ENTITY_TYPE_LABELS.inspection },
    { value: "location", ...ENTITY_TYPE_LABELS.location },
    { value: "sector", ...ENTITY_TYPE_LABELS.sector },
    { value: "shift_roster", ...ENTITY_TYPE_LABELS.shift_roster },
    { value: "card", ...ENTITY_TYPE_LABELS.card },
    { value: "access_card", ...ENTITY_TYPE_LABELS.access_card },
    { value: "setting", ...ENTITY_TYPE_LABELS.setting },
    { value: "role_grant", ...ENTITY_TYPE_LABELS.role_grant },
    {
      value: "attendance_adjustment",
      ...ENTITY_TYPE_LABELS.attendance_adjustment,
    },
    { value: "user", ...ENTITY_TYPE_LABELS.user },
    { value: "sla_policy", ...ENTITY_TYPE_LABELS.sla_policy },
    { value: "sync_run", ...ENTITY_TYPE_LABELS.sync_run },
  ];

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
  // Branch: conditional gate.
  if (known) return pick(locale, known);
  // Return value / early exit.
  return humanizeKey(entityType);
}

/** Localized status chip (ticket / cleaning / etc.). */
export function statusLabel(status: string, locale: AuditLocale): string {
  const known = STATUS_LABELS[status];
  // Branch: conditional gate.
  if (known) return pick(locale, known);
  // Return value / early exit.
  return humanizeKey(status);
}

/** Prefer server `summary` when present; else action label. */
export function auditHeadline(
  row: Pick<AuditEventRow, "summary" | "action" | "entityType">,
  locale: AuditLocale,
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
  const known = JOB_KEY_LABELS[jobKey];
  // Branch: conditional gate.
  if (known) return pick(locale, known);
  // Return value / early exit.
  return humanizeKey(jobKey);
}

/** Normalize job run status variants (ok/succeeded, error/failed). */
export function jobStatusLabel(status: string, locale: AuditLocale): string {
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

/** Narrow unknown JSON to a plain object (null for arrays / primitives). */
function asRecord(value: unknown): Record<string, unknown> | null {
  // Branch: conditional gate.
  if (value && typeof value === "object" && !Array.isArray(value)) {
    // Return value / early exit.
    return value as Record<string, unknown>;
  }
  // Return value / early exit.
  return null;
}

/** Format a single before/after field value for detail lines. */
function formatScalar(value: unknown, locale: AuditLocale): string {
  // Branch: conditional gate.
  if (value === null || value === undefined) return "—";
  // Branch: conditional gate.
  if (typeof value === "boolean") {
    // Return value / early exit.
    return value
      ? pick(locale, { bg: "да", en: "yes" })
      : pick(locale, { bg: "не", en: "no" });
  }
  // Branch: conditional gate.
  if (typeof value === "number") return String(value);
  // Branch: conditional gate.
  if (typeof value === "string") {
    // Reuse status labels when the string is a known status key.
    if (STATUS_LABELS[value]) return statusLabel(value, locale);
    // Return value / early exit.
    return value;
  }
  // Return value / early exit.
  return String(value);
}

/** Readable before/after lines for the details panel. */
export function formatAuditDetails(
  before: unknown,
  after: unknown,
  locale: AuditLocale,
): string[] {
  const beforeObj = asRecord(before);
  const afterObj = asRecord(after);
  const lines: string[] = [];

  // Branch: conditional gate.
  if (beforeObj?.status !== undefined || afterObj?.status !== undefined) {
    const from =
      beforeObj?.status !== undefined
        ? formatScalar(beforeObj.status, locale)
        : "—";
    const to =
      afterObj?.status !== undefined
        ? formatScalar(afterObj.status, locale)
        : "—";
    // Accumulate display line.
    lines.push(
      pick(locale, {
        bg: `Статус: ${from} → ${to}`,
        en: `Status: ${from} → ${to}`,
      }),
    );
  }

  // Build unique-key set.
  const keys = new Set([
    // Enumerate object keys/entries.
    ...Object.keys(beforeObj ?? {}),
    // Enumerate object keys/entries.
    ...Object.keys(afterObj ?? {}),
  ]);
  keys.delete("status");

  // Loop over collection.
  for (const key of keys) {
    const fromVal = beforeObj?.[key];
    const toVal = afterObj?.[key];
    // Branch: conditional gate.
    if (fromVal === undefined && toVal === undefined) continue;
    // Branch: conditional gate.
    if (JSON.stringify(fromVal) === JSON.stringify(toVal)) continue;

    const label = humanizeKey(key);
    // Branch: conditional gate.
    if (fromVal !== undefined && toVal !== undefined) {
      // Accumulate display line.
      lines.push(
        `${label}: ${formatScalar(fromVal, locale)} → ${formatScalar(toVal, locale)}`,
      );
    } else if (toVal !== undefined) {
      // Accumulate display line.
      lines.push(`${label}: ${formatScalar(toVal, locale)}`);
    } else {
      // Accumulate display line.
      lines.push(
        pick(locale, {
          bg: `${label}: премахнато (${formatScalar(fromVal, locale)})`,
          en: `${label}: removed (${formatScalar(fromVal, locale)})`,
        }),
      );
    }
  }

  // Branch: conditional gate.
  if (lines.length === 0 && (before != null || after != null)) {
    // Branch: conditional gate.
    if (before != null && after == null) {
      // Accumulate display line.
      lines.push(
        pick(locale, {
          bg: "Има записана предишна стойност",
          en: "Previous value recorded",
        }),
      );
    } else if (before == null && after != null) {
      // Accumulate display line.
      lines.push(
        pick(locale, {
          bg: "Има записана нова стойност",
          en: "New value recorded",
        }),
      );
    } else {
      // Accumulate display line.
      lines.push(
        pick(locale, {
          bg: "Промяната е записана",
          en: "Change recorded",
        }),
      );
    }
  }

  // Return value / early exit.
  return lines;
}

/**
 * One-line job result for the runs table. Prefers `error`; otherwise formats
 * known summary shapes (SLA, overdue scan, lock inactive) or key/value bits.
 */
export function formatJobSummary(
  jobKey: string,
  summary: unknown,
  error: string | null,
  locale: AuditLocale,
): string {
  // Branch: conditional gate.
  if (error?.trim()) return error.trim();

  // Normalize unknown to record.
  const obj = asRecord(summary);
  // Branch: conditional gate.
  if (!obj) {
    // Branch: conditional gate.
    if (summary == null) return "—";
    // Branch: conditional gate.
    if (typeof summary === "string") return summary;
    // Return value / early exit.
    return String(summary);
  }

  // Branch: conditional gate.
  if (obj.skipped === true) {
    const reason =
      typeof obj.reason === "string" ? obj.reason : humanizeKey(String(obj.reason ?? ""));
    // Return value / early exit.
    return pick(locale, {
      bg: `Пропуснато${reason ? ` (${reason === "disabled" ? "изключено" : reason})` : ""}`,
      en: `Skipped${reason ? ` (${reason})` : ""}`,
    });
  }

  // Branch: conditional gate.
  if (jobKey === "ticket_sla_breach") {
    const breached = Number(obj.breached ?? 0);
    const notified = Number(obj.notified ?? 0);
    // Return value / early exit.
    return pick(locale, {
      bg: `SLA нарушение: ${breached} тикета, уведомени ${notified}`,
      en: `SLA breach: ${breached} tickets, notified ${notified}`,
    });
  }

  // Branch: conditional gate.
  if (jobKey === "overdue_sessions" || jobKey === "sessions.anomaly_scan") {
    const scanned = obj.scanned != null ? Number(obj.scanned) : null;
    const flagged = obj.flagged != null ? Number(obj.flagged) : null;
    const parts: string[] = [];
    // Branch: conditional gate.
    if (scanned != null) {
      // Accumulate part.
      parts.push(
        pick(locale, {
          bg: `проверени ${scanned}`,
          en: `scanned ${scanned}`,
        }),
      );
    }
    // Branch: conditional gate.
    if (flagged != null) {
      // Accumulate part.
      parts.push(
        pick(locale, {
          bg: `маркирани ${flagged}`,
          en: `flagged ${flagged}`,
        }),
      );
    }
    // Branch: conditional gate.
    if (parts.length) return parts.join(", ");
  }

  // Branch: conditional gate.
  if (jobKey === "lock_inactive_users") {
    const locked = Number(obj.locked ?? 0);
    // Return value / early exit.
    return pick(locale, {
      bg: `Заключени потребители: ${locked}`,
      en: `Users locked: ${locked}`,
    });
  }

  const bits: string[] = [];
  // Loop over collection.
  for (const [key, value] of Object.entries(obj)) {
    // Branch: conditional gate.
    if (key === "cutoff") continue;
    // Accumulate summary bit.
    bits.push(`${humanizeKey(key)}: ${formatScalar(value, locale)}`);
  }
  // Return value / early exit.
  return bits.length ? bits.join(", ") : "—";
}
