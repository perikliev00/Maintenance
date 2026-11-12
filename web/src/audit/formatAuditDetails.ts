/**
 * Audit detail / job-summary formatters (split from labels.ts).
 */
import {
  // Declare type alias AuditLocale.
  type AuditLocale,
  // List item in import/export/params.
  humanizeKey,
  // List item in import/export/params.
  knownStatusLabel,
  // List item in import/export/params.
  pick,
// Support the surrounding logic for this step.
} from "./labels";

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
      // Support the surrounding logic for this step.
      ? pick(locale, { bg: "да", en: "yes" })
      // Support the surrounding logic for this step.
      : pick(locale, { bg: "не", en: "no" });
  }
  // Branch: conditional gate.
  if (typeof value === "number") return String(value);
  // Branch: conditional gate.
  if (typeof value === "string") {
    // Reuse status labels when the string is a known status key.
    const known = knownStatusLabel(value, locale);
    // Conditional branch for the case described by this guard.
    if (known) return known;
    // Return value / early exit.
    return value;
  }
  // Arrays / objects must never fall through to String(value) → [object Object].
  try {
    // Return early result or rendered output from this path.
    return JSON.stringify(value);
  // Support the surrounding logic for this step.
  } catch {
    // Return early result or rendered output from this path.
    return pick(locale, { bg: "(нечетима стойност)", en: "(unreadable value)" });
  }
}

/** True when both sides are plain objects (eligible for nested path diff). */
function bothRecords(
  // Provide a field used by this structure.
  a: unknown,
  // Provide b field used by this structure.
  b: unknown,
// Support the surrounding logic for this step.
): a is Record<string, unknown> {
  // Return early result or rendered output from this path.
  return asRecord(a) != null && asRecord(b) != null;
}

/**
 * Flatten nested before/after into path-prefixed lines so settings-style
 * nested JSON (e.g. notifications.email.enabled) stays human-readable.
 */
function appendDiffLines(
  // Provide lines field used by this structure.
  lines: string[],
  // Provide path field used by this structure.
  path: string,
  // Provide fromVal field used by this structure.
  fromVal: unknown,
  // Provide toVal field used by this structure.
  toVal: unknown,
  // Provide locale field used by this structure.
  locale: AuditLocale,
  // Provide depth field used by this structure.
  depth: number,
// Support the surrounding logic for this step.
): void {
  // Conditional branch for the case described by this guard.
  if (fromVal === undefined && toVal === undefined) return;
  // Conditional branch for the case described by this guard.
  if (JSON.stringify(fromVal) === JSON.stringify(toVal)) return;

  // Recurse into matching object shapes (bounded depth).
  if (
    // Support the surrounding logic for this step.
    depth < 6 &&
    // Support the surrounding logic for this step.
    ((bothRecords(fromVal, toVal)) ||
      // Support the surrounding logic for this step.
      (fromVal === undefined && asRecord(toVal)) ||
      // Support the surrounding logic for this step.
      (toVal === undefined && asRecord(fromVal)))
  // Support the surrounding logic for this step.
  ) {
    // Bind fromObj for use in the following logic.
    const fromObj = asRecord(fromVal) ?? {};
    // Bind toObj for use in the following logic.
    const toObj = asRecord(toVal) ?? {};
    // Create a Set/Map for efficient membership or keyed lookup.
    const keys = new Set([...Object.keys(fromObj), ...Object.keys(toObj)]);
    // Iterate a collection or counted range.
    for (const key of keys) {
      // Bind childPath for use in the following logic.
      const childPath = path ? `${path}.${key}` : key;
      // Invoke appendDiffLines to perform this step.
      appendDiffLines(lines, childPath, fromObj[key], toObj[key], locale, depth + 1);
    }
    // Return early result or rendered output from this path.
    return;
  }

  // Bind label for use in the following logic.
  const label = path
    // Continue a chained call building on the previous expression.
    .split(".")
    // Continue a chained call building on the previous expression.
    .map((part) => humanizeKey(part))
    // Continue a chained call building on the previous expression.
    .join(" › ");

  // Conditional branch for the case described by this guard.
  if (fromVal !== undefined && toVal !== undefined) {
    // Invoke lines.push to perform this step.
    lines.push(
      // Support the surrounding logic for this step.
      `${label}: ${formatScalar(fromVal, locale)} → ${formatScalar(toVal, locale)}`,
    );
  // Support the surrounding logic for this step.
  } else if (toVal !== undefined) {
    // Invoke lines.push to perform this step.
    lines.push(`${label}: ${formatScalar(toVal, locale)}`);
  // Support the surrounding logic for this step.
  } else {
    // Invoke lines.push to perform this step.
    lines.push(
      // Invoke pick to perform this step.
      pick(locale, {
        // Provide bg field used by this structure.
        bg: `${label}: премахнато (${formatScalar(fromVal, locale)})`,
        // Provide en field used by this structure.
        en: `${label}: removed (${formatScalar(fromVal, locale)})`,
      }),
    );
  }
}

/** Readable before/after lines for the details panel. */
export function formatAuditDetails(
  // Provide before field used by this structure.
  before: unknown,
  // Provide after field used by this structure.
  after: unknown,
  // Provide locale field used by this structure.
  locale: AuditLocale,
// Support the surrounding logic for this step.
): string[] {
  // Bind beforeObj for use in the following logic.
  const beforeObj = asRecord(before);
  // Bind afterObj for use in the following logic.
  const afterObj = asRecord(after);
  // Initialize an array used by subsequent logic.
  const lines: string[] = [];

  // Prefer a bilingual Status line when either side carries status.
  if (beforeObj?.status !== undefined || afterObj?.status !== undefined) {
    // Bind from for use in the following logic.
    const from =
      // Support the surrounding logic for this step.
      beforeObj?.status !== undefined
        // Support the surrounding logic for this step.
        ? formatScalar(beforeObj.status, locale)
        // Support the surrounding logic for this step.
        : "—";
    // Bind to for use in the following logic.
    const to =
      // Support the surrounding logic for this step.
      afterObj?.status !== undefined
        // Support the surrounding logic for this step.
        ? formatScalar(afterObj.status, locale)
        // Support the surrounding logic for this step.
        : "—";
    // Invoke lines.push to perform this step.
    lines.push(
      // Invoke pick to perform this step.
      pick(locale, {
        // Provide bg field used by this structure.
        bg: `Статус: ${from} → ${to}`,
        // Provide en field used by this structure.
        en: `Status: ${from} → ${to}`,
      }),
    );
  }

  // Create a Set/Map for efficient membership or keyed lookup.
  const keys = new Set([
    // Spread prior fields/items so overrides can layer cleanly.
    ...Object.keys(beforeObj ?? {}),
    // Spread prior fields/items so overrides can layer cleanly.
    ...Object.keys(afterObj ?? {}),
  // Support the surrounding logic for this step.
  ]);
  // Invoke keys.delete to perform this step.
  keys.delete("status");

  // Iterate a collection or counted range.
  for (const key of keys) {
    // Invoke appendDiffLines to perform this step.
    appendDiffLines(lines, key, beforeObj?.[key], afterObj?.[key], locale, 0);
  }

  // Conditional branch for the case described by this guard.
  if (lines.length === 0 && (before != null || after != null)) {
    // Conditional branch for the case described by this guard.
    if (before != null && after == null) {
      // Invoke lines.push to perform this step.
      lines.push(
        // Invoke pick to perform this step.
        pick(locale, {
          // Bilingual label for action/entity key bg.
          bg: "Има записана предишна стойност",
          // Bilingual label for action/entity key en.
          en: "Previous value recorded",
        }),
      );
    // Support the surrounding logic for this step.
    } else if (before == null && after != null) {
      // Non-object payload (array / primitive) — show compact JSON.
      if (!afterObj) {
        // Invoke lines.push to perform this step.
        lines.push(
          // Invoke pick to perform this step.
          pick(locale, {
            // Provide bg field used by this structure.
            bg: `Нова стойност: ${formatScalar(after, locale)}`,
            // Provide en field used by this structure.
            en: `New value: ${formatScalar(after, locale)}`,
          }),
        );
      // Support the surrounding logic for this step.
      } else {
        // Invoke lines.push to perform this step.
        lines.push(
          // Invoke pick to perform this step.
          pick(locale, {
            // Bilingual label for action/entity key bg.
            bg: "Има записана нова стойност",
            // Bilingual label for action/entity key en.
            en: "New value recorded",
          }),
        );
      }
    // Support the surrounding logic for this step.
    } else {
      // Invoke lines.push to perform this step.
      lines.push(
        // Invoke pick to perform this step.
        pick(locale, {
          // Bilingual label for action/entity key bg.
          bg: "Промяната е записана",
          // Bilingual label for action/entity key en.
          en: "Change recorded",
        }),
      );
    }
  }

  // Return early result or rendered output from this path.
  return lines;
}

/**
 * One-line job result for the runs table. Prefers `error`; otherwise formats
 * known summary shapes (SLA, overdue scan, lock inactive) or key/value bits.
 */
export function formatJobSummary(
  // Provide jobKey field used by this structure.
  jobKey: string,
  // Provide summary field used by this structure.
  summary: unknown,
  // Provide error field used by this structure.
  error: string | null,
  // Provide locale field used by this structure.
  locale: AuditLocale,
// Support the surrounding logic for this step.
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
    // Bind reason for use in the following logic.
    const reason =
      // Support the surrounding logic for this step.
      typeof obj.reason === "string" ? obj.reason : humanizeKey(String(obj.reason ?? ""));
    // Return value / early exit.
    return pick(locale, {
      // Provide bg field used by this structure.
      bg: `Пропуснато${reason ? ` (${reason === "disabled" ? "изключено" : reason})` : ""}`,
      // Provide en field used by this structure.
      // Provide en field/parameter used by this structure.
      en: `Skipped${reason ? ` (${reason})` : ""}`,
    });
  }

  // Branch: conditional gate.
  // Conditional branch for the case described by this guard.
  if (jobKey === "ticket_sla_breach") {
    // Count breached tickets from the job summary payload.
    const breached = Number(obj.breached ?? 0);
    // Count notified tickets from the job summary payload.
    const notified = Number(obj.notified ?? 0);
    // Return value / early exit.
    return pick(locale, {
      // Provide bg field used by this structure.
      bg: `SLA нарушение: ${breached} тикета, уведомени ${notified}`,
      // Provide en field used by this structure.
      en: `SLA breach: ${breached} tickets, notified ${notified}`,
    });
  }

  // Branch: conditional gate.
  if (
    // Support overdue session scan job keys.
    jobKey === "overdue_sessions" ||
    // Support anomaly scan job key.
    jobKey === "sessions.anomaly_scan" ||
    // Support stale attendance scan job key.
    jobKey === "stale_open_attendance"
  // Support the surrounding logic for this step.
  ) {
    // Optional scanned count when present on the summary.
    const scanned = obj.scanned != null ? Number(obj.scanned) : null;
    // Optional flagged count when present on the summary.
    const flagged = obj.flagged != null ? Number(obj.flagged) : null;
    // Accumulate localized summary fragments.
    const parts: string[] = [];
    // Branch: conditional gate.
    if (scanned != null) {
      // Accumulate part.
      parts.push(
        // Invoke pick to perform this step.
        pick(locale, {
          // Provide bg field used by this structure.
          bg: `проверени ${scanned}`,
          // Provide en field used by this structure.
          en: `scanned ${scanned}`,
        }),
      );
    }
    // Branch: conditional gate.
    if (flagged != null) {
      // Accumulate part.
      parts.push(
        // Invoke pick to perform this step.
        pick(locale, {
          // Provide bg field used by this structure.
          bg: `маркирани ${flagged}`,
          // Provide en field used by this structure.
          en: `flagged ${flagged}`,
        }),
      );
    }
    // Branch: conditional gate.
    if (parts.length) return parts.join(", ");
  }

  // Branch: conditional gate.
  if (jobKey === "lock_inactive_users") {
    // Count users locked by this job run.
    const locked = Number(obj.locked ?? 0);
    // Return value / early exit.
    return pick(locale, {
      // Provide bg field used by this structure.
      bg: `Заключени потребители: ${locked}`,
      // Provide en field used by this structure.
      en: `Users locked: ${locked}`,
    });
  }

  // Fallback: render remaining summary keys as humanized bits.
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
