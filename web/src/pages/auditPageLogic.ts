/**
 * Framework-free Audit page load orchestration (BUG-02/03/04).
 * Keeps race, partial-failure, and error-banner rules testable with node:test.
 */
import type { LiveEventType } from "../api/liveEvents";

/** Live SSE types that must refresh the Audit page (BUG-06/07 + NEW-03). */
export const AUDIT_PAGE_LIVE_EVENTS: LiveEventType[] = [
  "ticket.changed",
  "cleaning.changed",
  "settings.changed",
  "people.changed",
  "permissions.changed",
  "location.changed",
  "jobs.changed",
];

export type AuditLoadSection = "events" | "jobs";

export type AuditSectionError = {
  section: AuditLoadSection;
  message: string;
};

/** Stale HTTP responses must not clobber a newer refresh generation. */
export function shouldApplyAuditRefresh(
  responseGen: number,
  currentGen: number,
): boolean {
  return responseGen === currentGen;
}

// Export function errorMessageFromUnknown as part of this module's API.
export function errorMessageFromUnknown(
  err: unknown,
  fallback: string,
): string {
  return err instanceof Error && err.message.trim()
    ? err.message
    : fallback;
}

/**
 * Settle a promise into PromiseSettledResult without rejecting the caller.
 * Used so audit events and job runs load independently (BUG-04).
 */
export async function settleAuditFetch<T>(
  promise: Promise<T>,
): Promise<PromiseSettledResult<T>> {
  try {
    return { status: "fulfilled", value: await promise };
  } catch (reason) {
    return { status: "rejected", reason };
  }
}

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
  events: PromiseSettledResult<TEvents>;
  jobs: PromiseSettledResult<TJobs> | null;
  eventsFallback: string;
  jobsFallback: string;
}): AuditLoadOutcome<TEvents, TJobs> {
  const errors: AuditSectionError[] = [];
  let events: TEvents | undefined;
  let jobs: TJobs | undefined;
  let anySuccess = false;
  let eventsFailed = false;

  if (input.events.status === "fulfilled") {
    events = input.events.value;
    anySuccess = true;
  } else {
    eventsFailed = true;
    errors.push({
      section: "events",
      message: errorMessageFromUnknown(
        input.events.reason,
        input.eventsFallback,
      ),
    });
  }

  if (input.jobs) {
    if (input.jobs.status === "fulfilled") {
      jobs = input.jobs.value;
      anySuccess = true;
    } else {
      errors.push({
        section: "jobs",
        message: errorMessageFromUnknown(
          input.jobs.reason,
          input.jobsFallback,
        ),
      });
    }
  }

  return { events, jobs, errors, anySuccess, eventsFailed };
}

/** Join section errors into one banner string (stable order). */
export function formatAuditLoadErrors(
  errors: readonly AuditSectionError[],
  locale: "bg" | "en",
  opts?: { eventsStale?: boolean },
): string | null {
  if (errors.length === 0) return null;
  const label = (section: AuditLoadSection) => {
    if (section === "events") {
      return locale === "en" ? "Events" : "Събития";
    }
    return locale === "en" ? "Background tasks" : "Фонови задачи";
  };
  // Map source items into a derived list for rendering or logic.
  const parts = errors.map((err) => `${label(err.section)}: ${err.message}`);
  // Soft refresh left previous rows on screen — make that explicit (NEW-04).
  if (opts?.eventsStale) {
    parts.push(
      locale === "en"
        ? "Showing previous events until refresh succeeds"
        : "Показани са предишните събития до успешно обновяване",
    );
  }
  return parts.join(" · ");
}

/**
 * Decide whether to keep, clear, or mark events rows after a load attempt.
 * - Initial failure → clear (no trustworthy table).
 * - Soft-refresh failure → keep previous rows + stale flag (NEW-04).
 * - Jobs-only failure → keep events (BUG-04).
 */
export function resolveEventsTableAfterLoad<T>(input: {
  initial: boolean;
  eventsFailed: boolean;
  nextEvents: T | undefined;
}): { rows: T | "keep"; stale: boolean } {
  if (!input.eventsFailed) {
    return {
      rows: input.nextEvents !== undefined ? input.nextEvents : "keep",
      stale: false,
    };
  }
  if (input.initial) {
    return { rows: [] as T, stale: false };
  }
  return { rows: "keep", stale: true };
}

/**
 * Related-to cell: type label plus a stable short identity so two SLA rows
 * with identical payloads remain distinguishable (BUG-08).
 */
export function formatAuditRelated(
  row: {
    entityType: string;
    entityId: string;
    after?: unknown;
  },
  entityTypeLabelFn: (entityType: string, locale: "bg" | "en") => string,
  locale: "bg" | "en",
): string {
  const typeLabel = entityTypeLabelFn(row.entityType, locale);
  const after =
    row.after && typeof row.after === "object" && !Array.isArray(row.after)
      ? (row.after as Record<string, unknown>)
      : null;
  const locationNumber =
    typeof after?.locationNumber === "string" ? after.locationNumber : null;
  const title = typeof after?.title === "string" ? after.title : null;
  const shortId =
    row.entityId.length > 8 ? row.entityId.slice(0, 8) : row.entityId;

  if (locationNumber && title) {
    return `${typeLabel} · ${locationNumber} · ${title}`;
  }
  if (locationNumber) {
    return `${typeLabel} · ${locationNumber} · #${shortId}`;
  }
  if (title) {
    return `${typeLabel} · ${title} · #${shortId}`;
  }
  return `${typeLabel} · #${shortId}`;
}
