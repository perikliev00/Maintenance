/**
 * Optimistic-concurrency helpers: version checks and conditional status claims
 * so concurrent cleaning mutations fail closed with 409 instead of overwriting.
 */
import { Prisma, SessionStatus, TaskStatus } from "@prisma/client";
// Import ../../errors for cleaning/claims.ts.
import { AppError } from "../../errors";
// Type-only import from ./locks used by cleaning/claims.ts.
import type { Tx } from "./locks";

/** Payload attached to version/state conflict AppErrors for clients. */
export type TaskConflictDetails = {
  /** Client's stale token when provided (offline sync). */
  expectedVersion?: number;
  /** Authoritative row version after the winning write. */
  currentVersion: number;
  /** Task status at read time (explains invalid_state vs version_conflict). */
  status: string;
  /** Current assignee, if any — helps UI show reassignment races. */
  assignedEmployeeId: string | null;
};

/**
 * Build conflict details from the current task row for 409 responses.
 * @param task — live row (or post-failed-claim read)
 * @param expectedVersion — omitted when the caller did not send optimistic concurrency
 */
export function taskConflictDetails(
  // Open nested structure for the next related fields.
  task: {
    // Carry this field through the payload or query.
    version: number;
    // Carry this field through the payload or query.
    status: string;
    // Field value required by this payload or query.
    assignedEmployeeId: string | null;
  },
  // Parameter/field in the surrounding signature or type.
  expectedVersion?: number,
// Begin block/object for the following statements.
): TaskConflictDetails {
  // Include expectedVersion only when the client sent one (offline sync).
  return {
    // Spread stale token only when defined so online paths stay smaller.
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    // Always echo authoritative version/status/assignee from the DB row.
    currentVersion: task.version,
    // Carry this field through the payload or query.
    status: task.status,
    // Carry this field through the payload or query.
    assignedEmployeeId: task.assignedEmployeeId,
  };
}

/**
 * Throw 409 version_conflict when the client's expectedVersion is stale.
 * No-op when expectedVersion is omitted (online paths without optimistic concurrency).
 */
export function assertTaskVersion(
  // Open nested structure for the next related fields.
  task: {
    // Carry this field through the payload or query.
    version: number;
    // Carry this field through the payload or query.
    status: string;
    // Field value required by this payload or query.
    assignedEmployeeId: string | null;
  },
  // Parameter/field in the surrounding signature or type.
  expectedVersion?: number,
// Begin block/object for the following statements.
) {
  // No expectedVersion → skip check (online paths without optimistic concurrency).
  if (
    // Execute: expectedVersion !== undefined &&
    expectedVersion !== undefined &&
    // Execute: task.version !== expectedVersion
    task.version !== expectedVersion
  // Begin block/object for the following statements.
  ) {
    // Fail closed with structured details for offline retry UX.
    throw new AppError(
      // Execute: 409,
      409,
      // Execute: "version_conflict",
      "version_conflict",
      // Execute: "Task was updated by another user",
      "Task was updated by another user",
      // Execute: taskConflictDetails(task, expectedVersion),
      taskConflictDetails(task, expectedVersion),
    );
  }
}

/**
 * Update a session only while it is still `running`.
 * Prevents double-complete / cancel races.
 */
export async function claimRunningSession(
  // Carry this field through the payload or query.
  tx: Tx,
  // Carry this field through the payload or query.
  sessionId: string,
  // Fields written by this create/update.
  data: Prisma.CleaningSessionUpdateManyMutationInput,
// Begin block/object for the following statements.
) {
  // Conditional update — only one complete/cancel wins the race.
  const claimed = await tx.cleaningSession.updateMany({
    // Match this session only while still running.
    where: { id: sessionId, status: SessionStatus.running },
    // Caller supplies terminal fields (completed/cancelled + command ids).
    data,
  });
  // Zero rows updated → another worker finished or cancelled first.
  if (claimed.count === 0) {
    // Abort with an HTTP-mapped AppError or rethrow.
    throw new AppError(
      // Execute: 409,
      409,
      // Execute: "invalid_state",
      "invalid_state",
      // Execute: "Session is no longer running",
      "Session is no longer running",
    );
  }
}

/**
 * Conditionally transition a task from one of `fromStatuses`, bumping `version`.
 * Distinguishes version conflicts from illegal status transitions on failure.
 */
export async function claimTaskStatus(
  // Carry this field through the payload or query.
  tx: Tx,
  // Carry this field through the payload or query.
  taskId: string,
  // Carry this field through the payload or query.
  fromStatuses: TaskStatus[],
  // Fields written by this create/update.
  data: Prisma.CleaningTaskUncheckedUpdateManyInput,
  // Parameter/field in the surrounding signature or type.
  expectedVersion?: number,
// Begin block/object for the following statements.
) {
  // Status (+ optional version) predicate is the concurrency claim.
  const claimed = await tx.cleaningTask.updateMany({
    // Restrict the query to the relevant rows only.
    where: {
      // Carry this field through the payload or query.
      id: taskId,
      // Must still be in one of the caller's allowed source statuses.
      status: { in: fromStatuses },
      // When provided, version must match or the update is a no-op.
      ...(expectedVersion !== undefined ? { version: expectedVersion } : {}),
    },
    // Fields written by this create/update.
    data: {
      // Spread remaining fields without dropping caller data.
      ...data,
      // Always bump version so offline clients detect the change.
      version: { increment: 1 },
    },
  });
  // Distinguish 404 / version_conflict / invalid_state for clients.
  if (claimed.count === 0) {
    // Re-read row to classify the failure (deleted vs stale vs wrong status).
    const task = await tx.cleaningTask.findUnique({ where: { id: taskId } });
    // Guard: handle missing/invalid state before continuing.
    if (!task) {
      // Abort with an HTTP-mapped AppError or rethrow.
      throw new AppError(404, "not_found", "Task not found");
    }
    // Prefer version_conflict when the token is stale.
    if (
      // Execute: expectedVersion !== undefined &&
      expectedVersion !== undefined &&
      // Execute: task.version !== expectedVersion
      task.version !== expectedVersion
    // Begin block/object for the following statements.
    ) {
      // Abort with an HTTP-mapped AppError or rethrow.
      throw new AppError(
        // Execute: 409,
        409,
        // Execute: "version_conflict",
        "version_conflict",
        // Execute: "Task was updated by another user",
        "Task was updated by another user",
        // Execute: taskConflictDetails(task, expectedVersion),
        taskConflictDetails(task, expectedVersion),
      );
    }
    // Otherwise the status left the allowed fromStatuses set.
    throw new AppError(
      // Execute: 409,
      409,
      // Execute: "invalid_state",
      "invalid_state",
      // Execute: `Cannot transition task from status ${task.status}`,
      `Cannot transition task from status ${task.status}`,
      // Execute: taskConflictDetails(task, expectedVersion),
      taskConflictDetails(task, expectedVersion),
    );
  }
}
