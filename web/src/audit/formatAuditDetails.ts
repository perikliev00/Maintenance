/**
 * Audit detail / job-summary formatters (split from labels.ts).
 */
import {
  type AuditLocale,
  humanizeKey,
  knownStatusLabel,
  pick,
} from "./labels";

/** Narrow unknown JSON to a plain object (null for arrays / primitives). */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

/** Format a single before/after field value for detail lines. */
function formatScalar(value: unknown, locale: AuditLocale): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") {
    return value
      ? pick(locale, { bg: "да", en: "yes" })
      : pick(locale, { bg: "не", en: "no" });
  }
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    // Reuse status labels when the string is a known status key.
    const known = knownStatusLabel(value, locale);
    if (known) return known;
    return value;
  }
  // Arrays / objects must never fall through to String(value) → [object Object].
  try {
    return JSON.stringify(value);
  } catch {
    return pick(locale, { bg: "(нечетима стойност)", en: "(unreadable value)" });
  }
}

/** True when both sides are plain objects (eligible for nested path diff). */
function bothRecords(
  a: unknown,
  b: unknown,
): a is Record<string, unknown> {
  return asRecord(a) != null && asRecord(b) != null;
}

/**
 * Flatten nested before/after into path-prefixed lines so settings-style
 * nested JSON (e.g. notifications.email.enabled) stays human-readable.
 */
function appendDiffLines(
  lines: string[],
  path: string,
  fromVal: unknown,
  toVal: unknown,
  locale: AuditLocale,
  depth: number,
): void {
  if (fromVal === undefined && toVal === undefined) return;
  if (JSON.stringify(fromVal) === JSON.stringify(toVal)) return;

  // Recurse into matching object shapes (bounded depth).
  if (
    depth < 6 &&
    ((bothRecords(fromVal, toVal)) ||
      (fromVal === undefined && asRecord(toVal)) ||
      (toVal === undefined && asRecord(fromVal)))
  ) {
    const fromObj = asRecord(fromVal) ?? {};
    const toObj = asRecord(toVal) ?? {};
    const keys = new Set([...Object.keys(fromObj), ...Object.keys(toObj)]);
    for (const key of keys) {
      const childPath = path ? `${path}.${key}` : key;
      appendDiffLines(lines, childPath, fromObj[key], toObj[key], locale, depth + 1);
    }
    return;
  }

  const label = path
    .split(".")
    .map((part) => humanizeKey(part))
    .join(" › ");

  if (fromVal !== undefined && toVal !== undefined) {
    lines.push(
      `${label}: ${formatScalar(fromVal, locale)} → ${formatScalar(toVal, locale)}`,
    );
  } else if (toVal !== undefined) {
    lines.push(`${label}: ${formatScalar(toVal, locale)}`);
  } else {
    lines.push(
      pick(locale, {
        bg: `${label}: премахнато (${formatScalar(fromVal, locale)})`,
        en: `${label}: removed (${formatScalar(fromVal, locale)})`,
      }),
    );
  }
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

  // Prefer a bilingual Status line when either side carries status.
  if (beforeObj?.status !== undefined || afterObj?.status !== undefined) {
    const from =
      beforeObj?.status !== undefined
        ? formatScalar(beforeObj.status, locale)
        : "—";
    const to =
      afterObj?.status !== undefined
        ? formatScalar(afterObj.status, locale)
        : "—";
    lines.push(
      pick(locale, {
        bg: `Статус: ${from} → ${to}`,
        en: `Status: ${from} → ${to}`,
      }),
    );
  }

  const keys = new Set([
    ...Object.keys(beforeObj ?? {}),
    ...Object.keys(afterObj ?? {}),
  ]);
  keys.delete("status");

  for (const key of keys) {
    appendDiffLines(lines, key, beforeObj?.[key], afterObj?.[key], locale, 0);
  }

  if (lines.length === 0 && (before != null || after != null)) {
    if (before != null && after == null) {
      lines.push(
        pick(locale, {
          bg: "Има записана предишна стойност",
          en: "Previous value recorded",
        }),
      );
    } else if (before == null && after != null) {
      // Non-object payload (array / primitive) — show compact JSON.
      if (!afterObj) {
        lines.push(
          pick(locale, {
            bg: `Нова стойност: ${formatScalar(after, locale)}`,
            en: `New value: ${formatScalar(after, locale)}`,
          }),
        );
      } else {
        lines.push(
          pick(locale, {
            bg: "Има записана нова стойност",
            en: "New value recorded",
          }),
        );
      }
    } else {
      lines.push(
        pick(locale, {
          bg: "Промяната е записана",
          en: "Change recorded",
        }),
      );
    }
  }

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
  if (error?.trim()) return error.trim();

  // Normalize unknown to record.
  const obj = asRecord(summary);
  if (!obj) {
    if (summary == null) return "—";
    if (typeof summary === "string") return summary;
    return String(summary);
  }

  if (obj.skipped === true) {
    const reason =
      typeof obj.reason === "string" ? obj.reason : humanizeKey(String(obj.reason ?? ""));
    return pick(locale, {
      bg: `Пропуснато${reason ? ` (${reason === "disabled" ? "изключено" : reason})` : ""}`,
      // Provide en field/parameter used by this structure.
      en: `Skipped${reason ? ` (${reason})` : ""}`,
    });
  }

  if (jobKey === "ticket_sla_breach") {
    // Count breached tickets from the job summary payload.
    const breached = Number(obj.breached ?? 0);
    // Count notified tickets from the job summary payload.
    const notified = Number(obj.notified ?? 0);
    return pick(locale, {
      bg: `SLA нарушение: ${breached} тикета, уведомени ${notified}`,
      en: `SLA breach: ${breached} tickets, notified ${notified}`,
    });
  }

  if (
    // Support overdue session scan job keys.
    jobKey === "overdue_sessions" ||
    // Support anomaly scan job key.
    jobKey === "sessions.anomaly_scan" ||
    // Support stale attendance scan job key.
    jobKey === "stale_open_attendance"
  ) {
    // Optional scanned count when present on the summary.
    const scanned = obj.scanned != null ? Number(obj.scanned) : null;
    // Optional flagged count when present on the summary.
    const flagged = obj.flagged != null ? Number(obj.flagged) : null;
    // Accumulate localized summary fragments.
    const parts: string[] = [];
    if (scanned != null) {
      // Accumulate part.
      parts.push(
        pick(locale, {
          bg: `проверени ${scanned}`,
          en: `scanned ${scanned}`,
        }),
      );
    }
    if (flagged != null) {
      // Accumulate part.
      parts.push(
        pick(locale, {
          bg: `маркирани ${flagged}`,
          en: `flagged ${flagged}`,
        }),
      );
    }
    if (parts.length) return parts.join(", ");
  }

  if (jobKey === "lock_inactive_users") {
    // Count users locked by this job run.
    const locked = Number(obj.locked ?? 0);
    return pick(locale, {
      bg: `Заключени потребители: ${locked}`,
      en: `Users locked: ${locked}`,
    });
  }

  // Fallback: render remaining summary keys as humanized bits.
  const bits: string[] = [];
  // Loop over collection.
  for (const [key, value] of Object.entries(obj)) {
    if (key === "cutoff") continue;
    // Accumulate summary bit.
    bits.push(`${humanizeKey(key)}: ${formatScalar(value, locale)}`);
  }
  return bits.length ? bits.join(", ") : "—";
}
