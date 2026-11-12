/**
 * Pure offline conflict helpers (unit-testable, no I/O).
 *
 * Version conflicts can be rebased by advancing `expectedVersion`; assignee /
 * scope losses cannot — those need human dismiss or a different action.
 * Some 403 "forbidden" sync results are really reassignment conflicts and are
 * mapped into the conflict bucket so Retry/Rebase UI still applies.
 */

export type ConflictDetails = {
  // Field/property in this shape.
  expectedVersion?: number;
  // Field/property in this shape.
  currentVersion?: number;
  // Field/property in this shape.
  status?: string;
  // Field/property in this shape.
  assignedEmployeeId?: string | null;
};

/** Codes where rebase cannot succeed (ownership / scope lost / duplicates). */
export const NON_REBASEABLE_CODES = new Set([
  // Continue multi-line list/arguments.
  "assignee_conflict",
  // Continue multi-line list/arguments.
  "out_of_scope",
  // Continue multi-line list/arguments.
  "duplicate_active",
  // Continue multi-line list/arguments.
  "probable_duplicate",
]);

/** Narrow unknown sync `details` into typed conflict fields (best-effort). */
export function parseConflictDetails(raw: unknown): ConflictDetails | null {
  // Conditional branch for this case.
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  // Local constant binding.
  const o = raw as Record<string, unknown>;
  // Local constant binding.
  const details: ConflictDetails = {};
  // Conditional branch for this case.
  if (
    // Assign value for subsequent use.
    typeof o.expectedVersion === "number" &&
    // Invoke helper or pass arguments.
    Number.isSafeInteger(o.expectedVersion) &&
    // Continue module logic.
    o.expectedVersion > 0
  // Open multi-line construct.
  ) {
    // Assign value for subsequent use.
    details.expectedVersion = o.expectedVersion;
  }
  // Conditional branch for this case.
  if (
    // Assign value for subsequent use.
    typeof o.currentVersion === "number" &&
    // Invoke helper or pass arguments.
    Number.isSafeInteger(o.currentVersion) &&
    // Continue module logic.
    o.currentVersion > 0
  // Open multi-line construct.
  ) {
    // Assign value for subsequent use.
    details.currentVersion = o.currentVersion;
  }
  // Conditional branch for this case.
  if (typeof o.status === "string") {
    // Assign value for subsequent use.
    details.status = o.status;
  }
  // null is a valid "unassigned" signal from the server.
  if (
    // Assign value for subsequent use.
    o.assignedEmployeeId === null ||
    // Assign value for subsequent use.
    typeof o.assignedEmployeeId === "string"
  // Open multi-line construct.
  ) {
    // Assign value for subsequent use.
    details.assignedEmployeeId = o.assignedEmployeeId as string | null;
  }
  // Return computed result to caller.
  return details;
}

/**
 * Rebase is only safe when the server gave a numeric `currentVersion` and the
 * code is not an ownership/scope loss (retrying those would keep failing).
 */
export function canRebaseConflict(
  // Field/property in this shape.
  conflictCode: string | null | undefined,
  // Field/property in this shape.
  details: unknown,
// Open multi-line construct.
): boolean {
  // Assignee / scope losses need dismiss, not version bump.
  if (conflictCode && NON_REBASEABLE_CODES.has(conflictCode)) return false;
  // Local constant binding.
  const parsed = parseConflictDetails(details);
  // Return computed result to caller.
  return typeof parsed?.currentVersion === "number";
}

/** Explicit conflict codes that may arrive under sync status `forbidden`. */
export const FORBIDDEN_AS_CONFLICT_CODES = new Set([
  // Continue multi-line list/arguments.
  "assignee_conflict",
  // Continue multi-line list/arguments.
  "out_of_scope",
]);

/**
 * Some 403 sync results are reassignment/scope conflicts (show Retry/Rebase UI)
 * rather than hard permission denials (stay in failed).
 */
export function shouldTreatForbiddenAsConflict(
  // Field/property in this shape.
  code: string | null | undefined,
  // Field/property in this shape.
  message: string | null | undefined,
// Open multi-line construct.
): boolean {
  // True permission denials ("Missing cleaning.start") stay failed.
  if (message && /^Missing\s/i.test(message)) return false;
  // Conditional branch for this case.
  if (code && FORBIDDEN_AS_CONFLICT_CODES.has(code)) return true;
  // Heuristic on human-readable messages when code is missing.
  if (
    // Continue module logic.
    message &&
    // Invoke helper or pass arguments.
    (/reassigned/i.test(message) ||
      // JSX element boundary.
      /assigned to another/i.test(message) ||
      // JSX element boundary.
      /belongs to another/i.test(message) ||
      // JSX element boundary.
      /outside your permitted/i.test(message) ||
      // JSX element boundary.
      /out of scope/i.test(message))
  // Open multi-line construct.
  ) {
    // Return computed result to caller.
    return true;
  }
  // Return computed result to caller.
  return false;
}

// Export type alias for consumers.
export type SyncResultLike = {
  // Field/property in this shape.
  status: string;
  // Field/property in this shape.
  message?: string;
  // Field/property in this shape.
  code?: string;
  // Field/property in this shape.
  details?: unknown;
  // Field/property in this shape.
  retryable?: boolean;
};

// Export type alias for consumers.
export type QueuedActionPatch = {
  // Field/property in this shape.
  status: "conflict" | "failed" | "pending" | "deleted";
  // Field/property in this shape.
  lastError?: string | null;
  // Field/property in this shape.
  conflictCode?: string | null;
  // Field/property in this shape.
  conflictMessage?: string | null;
  // Field/property in this shape.
  conflictDetails?: unknown;
  // Field/property in this shape.
  retries?: number;
  // Field/property in this shape.
  body?: Record<string, unknown>;
};

/**
 * Pure decision for applying a sync push result to an outbox row.
 * `deleted` means remove from outbox (success only).
 */
export function decideSyncResult(
  // Field/property in this shape.
  result: SyncResultLike,
  // Field/property in this shape.
  retries: number,
  // Field/property in this shape.
  maxRetries: number,
// Open multi-line construct.
): QueuedActionPatch {
  // Local constant binding.
  const message = nonEmptyString(result.message);
  // Local constant binding.
  const code = nonEmptyString(result.code);
  // Local constant binding.
  const details = isRecord(result.details) ? result.details : null;
  // Success — remove from outbox.
  if (result.status === "ok") {
    // Return computed result to caller.
    return { status: "deleted" };
  }
  // Explicit version / state conflict — park for rebase UI.
  if (result.status === "conflict") {
    // Return computed result to caller.
    return {
      // Field/property in this shape.
      status: "conflict",
      // Field/property in this shape.
      lastError: message ?? "conflict",
      // Field/property in this shape.
      conflictCode: code ?? null,
      // Field/property in this shape.
      conflictMessage: message ?? null,
      // Field/property in this shape.
      conflictDetails: details,
    };
  }
  // Conditional branch for this case.
  if (result.status === "forbidden") {
    // Reassignment-style 403 → conflict bucket; true ACL miss → failed.
    if (
      // Invoke helper or pass arguments.
      shouldTreatForbiddenAsConflict(code ?? null, message ?? null)
    // Open multi-line construct.
    ) {
      // Return computed result to caller.
      return {
        // Field/property in this shape.
        status: "conflict",
        // Field/property in this shape.
        lastError: message ?? "conflict",
        // Field/property in this shape.
        conflictCode: code ?? "assignee_conflict",
        // Field/property in this shape.
        conflictMessage: message ?? null,
        // Field/property in this shape.
        conflictDetails: details,
      };
    }
    // Return computed result to caller.
    return {
      // Field/property in this shape.
      status: "failed",
      // Field/property in this shape.
      lastError: message ?? "forbidden",
      // Field/property in this shape.
      conflictCode: null,
      // Field/property in this shape.
      conflictMessage: null,
      // Field/property in this shape.
      conflictDetails: null,
      // Field/property in this shape.
      retries: retries + 1,
    };
  }
  // Conditional branch for this case.
  if (result.retryable === false || code === "validation") {
    // Return computed result to caller.
    return { status: "failed", lastError: message ?? "error", retries: retries + 1,
      // Field/property in this shape.
      conflictCode: null, conflictMessage: null, conflictDetails: null };
  }
  // Legacy servers omit retryable; keep bounded retries for those results too.
  const next = retries + 1;
  // Return computed result to caller.
  return {
    // Field/property in this shape.
    status: next >= maxRetries ? "failed" : "pending",
    // Field/property in this shape.
    lastError: message ?? "error",
    // Field/property in this shape.
    conflictCode: null,
    // Field/property in this shape.
    conflictMessage: null,
    // Field/property in this shape.
    conflictDetails: null,
    // Field/property in this shape.
    retries: next,
  };
}

/** Rewrite body.expectedVersion from conflict details for a rebase retry. */
export function rebaseBodyWithCurrentVersion(
  // Field/property in this shape.
  body: Record<string, unknown>,
  // Field/property in this shape.
  details: unknown,
// Open multi-line construct.
): Record<string, unknown> | null {
  // Local constant binding.
  const parsed = parseConflictDetails(details);
  // Without currentVersion there is nothing safe to advance to.
  if (typeof parsed?.currentVersion !== "number") return null;
  // Return computed result to caller.
  return { ...body, expectedVersion: parsed.currentVersion };
}

/** Best-effort entity id for UI grouping (body fields, else path segments). */
export function entityIdFromQueued(
  // Field/property in this shape.
  type: string,
  // Field/property in this shape.
  url: string,
  // Field/property in this shape.
  body: Record<string, unknown>,
// Open multi-line construct.
): string | null {
  // Prefer explicit body ids when present.
  if (typeof body.taskId === "string" && body.taskId) return body.taskId;
  // Conditional branch for this case.
  if (typeof body.sessionId === "string" && body.sessionId) return body.sessionId;
  // Conditional branch for this case.
  if (typeof body.ticketId === "string" && body.ticketId) return body.ticketId;
  // The stored URL may be relative or absolute and can include query/hash
  // parameters. Match against its pathname so those do not become part of the
  // entity id; invalid URLs simply have no fallback id.
  let pathname: string;
  // Guard fallible work.
  try {
    // Assign value for subsequent use.
    pathname = new URL(url, "http://offline.invalid").pathname;
  // Open multi-line construct.
  } catch {
    // Return computed result to caller.
    return null;
  }
  // Fall back to parsing REST paths used by cleaning/ticket commands.
  if (type === "cleaning.start") {
    // Return computed result to caller.
    return pathSegmentAfter(pathname, "/tasks/");
  }
  // Conditional branch for this case.
  if (type === "cleaning.complete") {
    // Return computed result to caller.
    return pathSegmentAfter(pathname, "/sessions/");
  }
  // Conditional branch for this case.
  if (type.startsWith("ticket.")) {
    // Return computed result to caller.
    return pathSegmentAfter(pathname, "/tickets/");
  }
  // Return computed result to caller.
  return null;
}

// Function definition.
function nonEmptyString(value: unknown): string | undefined {
  // Return computed result to caller.
  return typeof value === "string" && value.trim().length > 0
    // Continue module logic.
    ? value
    // Continue module logic.
    : undefined;
}

// Function definition.
function isRecord(value: unknown): value is Record<string, unknown> {
  // Return computed result to caller.
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Function definition.
function pathSegmentAfter(pathname: string, marker: string): string | null {
  // Local constant binding.
  const segment = pathname.split(marker)[1]?.split("/")[0];
  // Return computed result to caller.
  return segment || null;
}
