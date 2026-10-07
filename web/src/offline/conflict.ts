/** Shared offline conflict helpers (pure — unit-testable). */

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

export function parseConflictDetails(raw: unknown): ConflictDetails | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const details: ConflictDetails = {};
  if (typeof o.expectedVersion === "number") {
    details.expectedVersion = o.expectedVersion;
  }
  if (typeof o.currentVersion === "number") {
    details.currentVersion = o.currentVersion;
  }
  if (typeof o.status === "string") {
    details.status = o.status;
  }
  if (
    o.assignedEmployeeId === null ||
    typeof o.assignedEmployeeId === "string"
  ) {
    details.assignedEmployeeId = o.assignedEmployeeId as string | null;
  }
  return details;
}

export function canRebaseConflict(
  conflictCode: string | null | undefined,
  details: unknown,
): boolean {
  if (conflictCode && NON_REBASEABLE_CODES.has(conflictCode)) return false;
  const parsed = parseConflictDetails(details);
  return typeof parsed?.currentVersion === "number";
}

/** Codes that older servers may return as sync `forbidden` but are conflicts. */
export const FORBIDDEN_AS_CONFLICT_CODES = new Set([
  "assignee_conflict",
  "out_of_scope",
  "forbidden",
]);

export function shouldTreatForbiddenAsConflict(
  code: string | null | undefined,
  message: string | null | undefined,
): boolean {
  if (code && FORBIDDEN_AS_CONFLICT_CODES.has(code)) {
    // True permission denials ("Missing cleaning.start") stay failed.
    if (message && /^Missing\s/i.test(message)) return false;
    return true;
  }
  if (
    message &&
    (/reassigned/i.test(message) ||
      /assigned to another/i.test(message) ||
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
  if (result.status === "ok") {
    return { status: "deleted" };
  }
  if (result.status === "conflict") {
    return {
      status: "conflict",
      lastError: result.message ?? "conflict",
      conflictCode: result.code ?? null,
      conflictMessage: result.message ?? null,
      conflictDetails: result.details ?? null,
    };
  }
  if (result.status === "forbidden") {
    if (
      shouldTreatForbiddenAsConflict(result.code ?? null, result.message ?? null)
    ) {
      return {
        status: "conflict",
        lastError: result.message ?? "conflict",
        conflictCode: result.code ?? "assignee_conflict",
        conflictMessage: result.message ?? null,
        conflictDetails: result.details ?? null,
      };
    }
    return {
      status: "failed",
      lastError: result.message ?? "forbidden",
      conflictCode: null,
      conflictMessage: null,
      conflictDetails: null,
      retries: retries + 1,
    };
  }
  const next = retries + 1;
  return {
    status: next >= maxRetries ? "failed" : "pending",
    lastError: result.message ?? "error",
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
  if (typeof parsed?.currentVersion !== "number") return null;
  return { ...body, expectedVersion: parsed.currentVersion };
}

export function entityIdFromQueued(
  type: string,
  url: string,
  body: Record<string, unknown>,
): string | null {
  if (typeof body.taskId === "string" && body.taskId) return body.taskId;
  if (typeof body.sessionId === "string" && body.sessionId) return body.sessionId;
  if (typeof body.ticketId === "string" && body.ticketId) return body.ticketId;
  if (type === "cleaning.start") {
    return url.split("/tasks/")[1]?.split("/")[0] ?? null;
  }
  if (type === "cleaning.complete") {
    return url.split("/sessions/")[1]?.split("/")[0] ?? null;
  }
  if (type.startsWith("ticket.")) {
    return url.split("/tickets/")[1]?.split("/")[0] ?? null;
  }
  return null;
}
