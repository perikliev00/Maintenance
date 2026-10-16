/**
 * Optimistic-concurrency helpers: version checks and conditional status claims
 * so concurrent cleaning mutations fail closed with 409 instead of overwriting.
 */
import { Prisma, SessionStatus, TaskStatus } from "@prisma/client";
import { AppError } from "../../errors";
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
  task: {
    version: number;
    status: string;
    assignedEmployeeId: string | null;
  },
  expectedVersion?: number,
): TaskConflictDetails {
  // Include expectedVersion only when the client sent one (offline sync).
  return {
    // Spread stale token only when defined so online paths stay smaller.
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    // Always echo authoritative version/status/assignee from the DB row.
    currentVersion: task.version,
    status: task.status,
    assignedEmployeeId: task.assignedEmployeeId,
  };
}

/**
 * Throw 409 version_conflict when the client's expectedVersion is stale.
 * No-op when expectedVersion is omitted (online paths without optimistic concurrency).
 */
export function assertTaskVersion(
  task: {
    version: number;
    status: string;
    assignedEmployeeId: string | null;
  },
  expectedVersion?: number,
) {
  // No expectedVersion → skip check (online paths without optimistic concurrency).
  if (
    expectedVersion !== undefined &&
    task.version !== expectedVersion
  ) {
    // Fail closed with structured details for offline retry UX.
    throw new AppError(
      409,
      "version_conflict",
      "Task was updated by another user",
      taskConflictDetails(task, expectedVersion),
    );
  }
}

/**
 * Update a session only while it is still `running`.
 * Prevents double-complete / cancel races.
 */
export async function claimRunningSession(
  tx: Tx,
  sessionId: string,
  data: Prisma.CleaningSessionUpdateManyMutationInput,
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
    throw new AppError(
      409,
      "invalid_state",
      "Session is no longer running",
    );
  }
}

/**
 * Conditionally transition a task from one of `fromStatuses`, bumping `version`.
 * Distinguishes version conflicts from illegal status transitions on failure.
 */
export async function claimTaskStatus(
  tx: Tx,
  taskId: string,
  fromStatuses: TaskStatus[],
  data: Prisma.CleaningTaskUncheckedUpdateManyInput,
  expectedVersion?: number,
) {
  // Status (+ optional version) predicate is the concurrency claim.
  const claimed = await tx.cleaningTask.updateMany({
    where: {
      id: taskId,
      // Must still be in one of the caller's allowed source statuses.
      status: { in: fromStatuses },
      // When provided, version must match or the update is a no-op.
      ...(expectedVersion !== undefined ? { version: expectedVersion } : {}),
    },
    data: {
      ...data,
      // Always bump version so offline clients detect the change.
      version: { increment: 1 },
    },
  });
  // Distinguish 404 / version_conflict / invalid_state for clients.
  if (claimed.count === 0) {
    // Re-read row to classify the failure (deleted vs stale vs wrong status).
    const task = await tx.cleaningTask.findUnique({ where: { id: taskId } });
    if (!task) {
      throw new AppError(404, "not_found", "Task not found");
    }
    // Prefer version_conflict when the token is stale.
    if (
      expectedVersion !== undefined &&
      task.version !== expectedVersion
    ) {
      throw new AppError(
        409,
        "version_conflict",
        "Task was updated by another user",
        taskConflictDetails(task, expectedVersion),
      );
    }
    // Otherwise the status left the allowed fromStatuses set.
    throw new AppError(
      409,
      "invalid_state",
      `Cannot transition task from status ${task.status}`,
      taskConflictDetails(task, expectedVersion),
    );
  }
}
