/**
 * Pure offline conflict helpers (unit-testable, no I/O).
 *
 * Version conflicts can be rebased by advancing `expectedVersion`; assignee /
 * scope losses cannot — those need human dismiss or a different action.
 * Some 403 "forbidden" sync results are really reassignment conflicts and are
 * mapped into the conflict bucket so Retry/Rebase UI still applies.
 */

export type ConflictDetails = {
  expectedVersion?: number;
  currentVersion?: number;
  status?: string;
  assignedEmployeeId?: string | null;
};

/** Codes where rebase cannot succeed (ownership / scope lost). */
export const NON_REBASEABLE_CODES = new Set([
  "assignee_conflict",
  "out_of_scope",
]);

/** Narrow unknown sync `details` into typed conflict fields (best-effort). */
export function parseConflictDetails(raw: unknown): ConflictDetails | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const details: ConflictDetails = {};
  if (
    typeof o.expectedVersion === "number" &&
    Number.isSafeInteger(o.expectedVersion) &&
    o.expectedVersion > 0
  ) {
    details.expectedVersion = o.expectedVersion;
  }
  if (
    typeof o.currentVersion === "number" &&
    Number.isSafeInteger(o.currentVersion) &&
    o.currentVersion > 0
  ) {
    details.currentVersion = o.currentVersion;
  }
  if (typeof o.status === "string") {
    details.status = o.status;
  }
  // null is a valid "unassigned" signal from the server.
  if (
    o.assignedEmployeeId === null ||
    typeof o.assignedEmployeeId === "string"
  ) {
    details.assignedEmployeeId = o.assignedEmployeeId as string | null;
  }
  return details;
}

/**
 * Rebase is only safe when the server gave a numeric `currentVersion` and the
 * code is not an ownership/scope loss (retrying those would keep failing).
 */
export function canRebaseConflict(
  conflictCode: string | null | undefined,
  details: unknown,
): boolean {
  // Assignee / scope losses need dismiss, not version bump.
  if (conflictCode && NON_REBASEABLE_CODES.has(conflictCode)) return false;
  const parsed = parseConflictDetails(details);
  return typeof parsed?.currentVersion === "number";
}

/** Explicit conflict codes that may arrive under sync status `forbidden`. */
export const FORBIDDEN_AS_CONFLICT_CODES = new Set([
  "assignee_conflict",
  "out_of_scope",
]);

/**
 * Some 403 sync results are reassignment/scope conflicts (show Retry/Rebase UI)
 * rather than hard permission denials (stay in failed).
 */
export function shouldTreatForbiddenAsConflict(
  code: string | null | undefined,
  message: string | null | undefined,
): boolean {
  // True permission denials ("Missing cleaning.start") stay failed.
  if (message && /^Missing\s/i.test(message)) return false;
  if (code && FORBIDDEN_AS_CONFLICT_CODES.has(code)) return true;
  // Heuristic on human-readable messages when code is missing.
  if (
    message &&
    (/reassigned/i.test(message) ||
      /assigned to another/i.test(message) ||
      /belongs to another/i.test(message) ||
      /outside your permitted/i.test(message) ||
      /out of scope/i.test(message))
  ) {
    return true;
  }
  return false;
}

export type SyncResultLike = {
  status: string;
  message?: string;
  code?: string;
  details?: unknown;
};

export type QueuedActionPatch = {
  status: "conflict" | "failed" | "pending" | "deleted";
  lastError?: string | null;
  conflictCode?: string | null;
  conflictMessage?: string | null;
  conflictDetails?: unknown;
  retries?: number;
  body?: Record<string, unknown>;
};

/**
 * Pure decision for applying a sync push result to an outbox row.
 * `deleted` means remove from outbox (success only).
 */
export function decideSyncResult(
  result: SyncResultLike,
  retries: number,
  maxRetries: number,
): QueuedActionPatch {
  const message = nonEmptyString(result.message);
  const code = nonEmptyString(result.code);
  const details = isRecord(result.details) ? result.details : null;
  // Success — remove from outbox.
  if (result.status === "ok") {
    return { status: "deleted" };
  }
  // Explicit version / state conflict — park for rebase UI.
  if (result.status === "conflict") {
    return {
      status: "conflict",
      lastError: message ?? "conflict",
      conflictCode: code ?? null,
      conflictMessage: message ?? null,
      conflictDetails: details,
    };
  }
  if (result.status === "forbidden") {
    // Reassignment-style 403 → conflict bucket; true ACL miss → failed.
    if (
      shouldTreatForbiddenAsConflict(code ?? null, message ?? null)
    ) {
      return {
        status: "conflict",
        lastError: message ?? "conflict",
        conflictCode: code ?? "assignee_conflict",
        conflictMessage: message ?? null,
        conflictDetails: details,
      };
    }
    return {
      status: "failed",
      lastError: message ?? "forbidden",
      conflictCode: null,
      conflictMessage: null,
      conflictDetails: null,
      retries: retries + 1,
    };
  }
  // Other errors: retry until maxRetries, then failed.
  const next = retries + 1;
  return {
    status: next >= maxRetries ? "failed" : "pending",
    lastError: message ?? "error",
    conflictCode: null,
    conflictMessage: null,
    conflictDetails: null,
    retries: next,
  };
}

/** Rewrite body.expectedVersion from conflict details for a rebase retry. */
export function rebaseBodyWithCurrentVersion(
  body: Record<string, unknown>,
  details: unknown,
): Record<string, unknown> | null {
  const parsed = parseConflictDetails(details);
  // Without currentVersion there is nothing safe to advance to.
  if (typeof parsed?.currentVersion !== "number") return null;
  return { ...body, expectedVersion: parsed.currentVersion };
}

/** Best-effort entity id for UI grouping (body fields, else path segments). */
export function entityIdFromQueued(
  type: string,
  url: string,
  body: Record<string, unknown>,
): string | null {
  // Prefer explicit body ids when present.
  if (typeof body.taskId === "string" && body.taskId) return body.taskId;
  if (typeof body.sessionId === "string" && body.sessionId) return body.sessionId;
  if (typeof body.ticketId === "string" && body.ticketId) return body.ticketId;
  // The stored URL may be relative or absolute and can include query/hash
  // parameters. Match against its pathname so those do not become part of the
  // entity id; invalid URLs simply have no fallback id.
  let pathname: string;
  try {
    pathname = new URL(url, "http://offline.invalid").pathname;
  } catch {
    return null;
  }
  // Fall back to parsing REST paths used by cleaning/ticket commands.
  if (type === "cleaning.start") {
    return pathSegmentAfter(pathname, "/tasks/");
  }
  if (type === "cleaning.complete") {
    return pathSegmentAfter(pathname, "/sessions/");
  }
  if (type.startsWith("ticket.")) {
    return pathSegmentAfter(pathname, "/tickets/");
  }
  return null;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pathSegmentAfter(pathname: string, marker: string): string | null {
  const segment = pathname.split(marker)[1]?.split("/")[0];
  return segment || null;
}
