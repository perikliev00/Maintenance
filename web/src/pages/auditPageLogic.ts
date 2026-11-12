/**
 * Framework-free Audit page load orchestration (BUG-02/03/04).
 * Keeps race, partial-failure, and error-banner rules testable with node:test.
 */
import type { LiveEventType } from "../api/liveEvents";

/** Live SSE types that must refresh the Audit page (BUG-06/07 + NEW-03). */
export const AUDIT_PAGE_LIVE_EVENTS: LiveEventType[] = [
  // Support the surrounding logic for this step.
  "ticket.changed",
  // Support the surrounding logic for this step.
  "cleaning.changed",
  // Support the surrounding logic for this step.
  "settings.changed",
  // Support the surrounding logic for this step.
  "people.changed",
  // Support the surrounding logic for this step.
  "permissions.changed",
  // Support the surrounding logic for this step.
  "location.changed",
  // Support the surrounding logic for this step.
  "jobs.changed",
];

// Export type definition for consumers of this module.
export type AuditLoadSection = "events" | "jobs";

// Export type definition for consumers of this module.
export type AuditSectionError = {
  // Provide section field used by this structure.
  section: AuditLoadSection;
  // Provide message field used by this structure.
  message: string;
};

/** Stale HTTP responses must not clobber a newer refresh generation. */
export function shouldApplyAuditRefresh(
  // Provide responseGen field used by this structure.
  responseGen: number,
  // Provide currentGen field used by this structure.
  currentGen: number,
// Support the surrounding logic for this step.
): boolean {
  // Return early result or rendered output from this path.
  return responseGen === currentGen;
}

// Export function errorMessageFromUnknown as part of this module's API.
export function errorMessageFromUnknown(
  // Provide err field used by this structure.
  err: unknown,
  // Provide fallback field used by this structure.
  fallback: string,
// Support the surrounding logic for this step.
): string {
  // Return early result or rendered output from this path.
  return err instanceof Error && err.message.trim()
    // Support the surrounding logic for this step.
    ? err.message
    // Support the surrounding logic for this step.
    : fallback;
}

/**
 * Settle a promise into PromiseSettledResult without rejecting the caller.
 * Used so audit events and job runs load independently (BUG-04).
 */
export async function settleAuditFetch<T>(
  // Provide promise field used by this structure.
  promise: Promise<T>,
// Support the surrounding logic for this step.
): Promise<PromiseSettledResult<T>> {
  // Begin guarded block to catch runtime failures.
  try {
    // Return early result or rendered output from this path.
    return { status: "fulfilled", value: await promise };
  // Support the surrounding logic for this step.
  } catch (reason) {
    // Return early result or rendered output from this path.
    return { status: "rejected", reason };
  }
}

// Export type definition for consumers of this module.
export type AuditLoadOutcome<TEvents, TJobs> = {
  /** Applied only when the events request succeeded. */
  events: TEvents | undefined;
  /** Applied only when the jobs request succeeded (or jobs were skipped). */
  jobs: TJobs | undefined;
  /** Per-section failures for banners; empty when both ok. */
  errors: AuditSectionError[];
  /** True when at least one requested section succeeded. */
  anySuccess: boolean;
  /** Events request failed — caller may clear or mark rows stale (NEW-04). */
  eventsFailed: boolean;
};

/**
 * Combine independent audit + optional jobs results into one apply decision.
 * A jobs failure must not discard successful audit rows (and vice versa).
 */
export function combineAuditLoadResults<TEvents, TJobs>(input: {
  // Provide events field used by this structure.
  events: PromiseSettledResult<TEvents>;
  // Provide jobs field used by this structure.
  jobs: PromiseSettledResult<TJobs> | null;
  // Provide eventsFallback field used by this structure.
  eventsFallback: string;
  // Provide jobsFallback field used by this structure.
  jobsFallback: string;
// Support the surrounding logic for this step.
}): AuditLoadOutcome<TEvents, TJobs> {
  // Initialize an array used by subsequent logic.
  const errors: AuditSectionError[] = [];
  // Bind events for use in the following logic.
  let events: TEvents | undefined;
  // Bind jobs for use in the following logic.
  let jobs: TJobs | undefined;
  // Bind anySuccess for use in the following logic.
  let anySuccess = false;
  // Bind eventsFailed for use in the following logic.
  let eventsFailed = false;

  // Conditional branch for the case described by this guard.
  if (input.events.status === "fulfilled") {
    // Support the surrounding logic for this step.
    events = input.events.value;
    // Support the surrounding logic for this step.
    anySuccess = true;
  // Support the surrounding logic for this step.
  } else {
    // Support the surrounding logic for this step.
    eventsFailed = true;
    // Invoke errors.push to perform this step.
    errors.push({
      // Provide section field used by this structure.
      section: "events",
      // Provide message field used by this structure.
      message: errorMessageFromUnknown(
        // Support the surrounding logic for this step.
        input.events.reason,
        // Support the surrounding logic for this step.
        input.eventsFallback,
      ),
    });
  }

  // Conditional branch for the case described by this guard.
  if (input.jobs) {
    // Conditional branch for the case described by this guard.
    if (input.jobs.status === "fulfilled") {
      // Support the surrounding logic for this step.
      jobs = input.jobs.value;
      // Support the surrounding logic for this step.
      anySuccess = true;
    // Support the surrounding logic for this step.
    } else {
      // Invoke errors.push to perform this step.
      errors.push({
        // Provide section field used by this structure.
        section: "jobs",
        // Provide message field used by this structure.
        message: errorMessageFromUnknown(
          // Support the surrounding logic for this step.
          input.jobs.reason,
          // Support the surrounding logic for this step.
          input.jobsFallback,
        ),
      });
    }
  }

  // Return early result or rendered output from this path.
  return { events, jobs, errors, anySuccess, eventsFailed };
}

/** Join section errors into one banner string (stable order). */
export function formatAuditLoadErrors(
  // Provide errors field used by this structure.
  errors: readonly AuditSectionError[],
  // Provide locale field used by this structure.
  locale: "bg" | "en",
  // Support the surrounding logic for this step.
  opts?: { eventsStale?: boolean },
// Support the surrounding logic for this step.
): string | null {
  // Conditional branch for the case described by this guard.
  if (errors.length === 0) return null;
  // Bind label for use in the following logic.
  const label = (section: AuditLoadSection) => {
    // Conditional branch for the case described by this guard.
    if (section === "events") {
      // Return early result or rendered output from this path.
      return locale === "en" ? "Events" : "Събития";
    }
    // Return early result or rendered output from this path.
    return locale === "en" ? "Background tasks" : "Фонови задачи";
  };
  // Map source items into a derived list for rendering or logic.
  const parts = errors.map((err) => `${label(err.section)}: ${err.message}`);
  // Soft refresh left previous rows on screen — make that explicit (NEW-04).
  if (opts?.eventsStale) {
    // Invoke parts.push to perform this step.
    parts.push(
      // Support the surrounding logic for this step.
      locale === "en"
        // Support the surrounding logic for this step.
        ? "Showing previous events until refresh succeeds"
        // Support the surrounding logic for this step.
        : "Показани са предишните събития до успешно обновяване",
    );
  }
  // Return early result or rendered output from this path.
  return parts.join(" · ");
}

/**
 * Decide whether to keep, clear, or mark events rows after a load attempt.
 * - Initial failure → clear (no trustworthy table).
 * - Soft-refresh failure → keep previous rows + stale flag (NEW-04).
 * - Jobs-only failure → keep events (BUG-04).
 */
export function resolveEventsTableAfterLoad<T>(input: {
  // Provide initial field used by this structure.
  initial: boolean;
  // Provide eventsFailed field used by this structure.
  eventsFailed: boolean;
  // Provide nextEvents field used by this structure.
  nextEvents: T | undefined;
// Support the surrounding logic for this step.
}): { rows: T | "keep"; stale: boolean } {
  // Conditional branch for the case described by this guard.
  if (!input.eventsFailed) {
    // Return early result or rendered output from this path.
    return {
      // Provide rows field used by this structure.
      rows: input.nextEvents !== undefined ? input.nextEvents : "keep",
      // Provide stale field used by this structure.
      stale: false,
    };
  }
  // Conditional branch for the case described by this guard.
  if (input.initial) {
    // Return early result or rendered output from this path.
    return { rows: [] as T, stale: false };
  }
  // Return early result or rendered output from this path.
  return { rows: "keep", stale: true };
}

/**
 * Related-to cell: type label plus a stable short identity so two SLA rows
 * with identical payloads remain distinguishable (BUG-08).
 */
export function formatAuditRelated(
  // Provide row field used by this structure.
  row: {
    // Provide entityType field used by this structure.
    entityType: string;
    // Provide entityId field used by this structure.
    entityId: string;
    // Support the surrounding logic for this step.
    after?: unknown;
  },
  // Provide entityTypeLabelFn field used by this structure.
  entityTypeLabelFn: (entityType: string, locale: "bg" | "en") => string,
  // Provide locale field used by this structure.
  locale: "bg" | "en",
// Support the surrounding logic for this step.
): string {
  // Bind typeLabel for use in the following logic.
  const typeLabel = entityTypeLabelFn(row.entityType, locale);
  // Bind after for use in the following logic.
  const after =
    // Support the surrounding logic for this step.
    row.after && typeof row.after === "object" && !Array.isArray(row.after)
      // Support the surrounding logic for this step.
      ? (row.after as Record<string, unknown>)
      // Support the surrounding logic for this step.
      : null;
  // Bind locationNumber for use in the following logic.
  const locationNumber =
    // Support the surrounding logic for this step.
    typeof after?.locationNumber === "string" ? after.locationNumber : null;
  // Bind title for use in the following logic.
  const title = typeof after?.title === "string" ? after.title : null;
  // Bind shortId for use in the following logic.
  const shortId =
    // Support the surrounding logic for this step.
    row.entityId.length > 8 ? row.entityId.slice(0, 8) : row.entityId;

  // Conditional branch for the case described by this guard.
  if (locationNumber && title) {
    // Return early result or rendered output from this path.
    return `${typeLabel} · ${locationNumber} · ${title}`;
  }
  // Conditional branch for the case described by this guard.
  if (locationNumber) {
    // Return early result or rendered output from this path.
    return `${typeLabel} · ${locationNumber} · #${shortId}`;
  }
  // Conditional branch for the case described by this guard.
  if (title) {
    // Return early result or rendered output from this path.
    return `${typeLabel} · ${title} · #${shortId}`;
  }
  // Return early result or rendered output from this path.
  return `${typeLabel} · #${shortId}`;
}
