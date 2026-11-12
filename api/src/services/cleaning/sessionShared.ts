/**
 * Shared includes, payload matchers, and complete/cancel lock+guard prelude.
 */
import { SessionStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";
// Import ../../errors for cleaning/sessionShared.ts.
import { AppError } from "../../errors";
// Import ../cleaningTasksQuery for cleaning/sessionShared.ts.
import { taskInclude } from "../cleaningTasksQuery";
// Import ./claims for cleaning/sessionShared.ts.
import { assertTaskVersion, taskConflictDetails } from "./claims";
// Import ./locks for cleaning/sessionShared.ts.
import { lockSession, lockTask } from "./locks";

// Local structural type for this module's contracts.
type TxClient = Prisma.TransactionClient;

// Exported constant sessionWithTaskInclude shared by callers.
export const sessionWithTaskInclude = {
  task: { include: taskInclude },
// Narrow or freeze the type for safer downstream use.
} as const;

// Public entry: startSessionPayloadMatches — see body for domain rules.
export function startSessionPayloadMatches(
  row: { taskId: string; employeeId: string },
  input: { taskId: string; employeeId: string },
): boolean {
  return row.taskId === input.taskId && row.employeeId === input.employeeId;
}

// Public entry: sessionCommandPayloadMatches — see body for domain rules.
export function sessionCommandPayloadMatches(
  // Open nested structure for the next related fields.
  row: {
    id: string;
    employeeId: string;
    // Parameter/field in the surrounding signature or type.
    completeActorEmployeeId?: string | null;
    // Parameter/field in the surrounding signature or type.
    cancelActorEmployeeId?: string | null;
  },
  input: { sessionId: string; employeeId: string },
  kind: "complete" | "cancel",
): boolean {
  const priorActor =
    // Execute: kind === "complete"
    kind === "complete"
      // Continue the previous expression with this clause.
      ? (row.completeActorEmployeeId ?? row.employeeId)
      // Continue the previous expression with this clause.
      : (row.cancelActorEmployeeId ?? row.employeeId);
  return row.id === input.sessionId && priorActor === input.employeeId;
}

/** Peek session, lock task→session. Throws 404 when missing. */
export async function peekAndLockSession(
  tx: TxClient,
  sessionId: string,
): Promise<{ id: string; taskId: string }> {
  // Load sessionPeek needed for the next decision or write.
  const sessionPeek = await tx.cleaningSession.findUnique({
    // Restrict the query to the relevant rows only.
    where: { id: sessionId },
  });
  // Guard: handle missing/invalid state before continuing.
  if (!sessionPeek) {
    // Abort with an HTTP-mapped AppError or rethrow.
    throw new AppError(404, "not_found", "Session not found");
  }
  await lockTask(tx, sessionPeek.taskId);
  await lockSession(tx, sessionPeek.id);
  return { id: sessionPeek.id, taskId: sessionPeek.taskId };
}

/**
 * After locks + replay miss: reload session/task, enforce owner, running status,
 * version, and finish-after-start. Used by complete and cancel.
 */
export async function loadRunningSessionForTerminalCommand(
  tx: TxClient,
  // Open nested structure for the next related fields.
  input: {
    sessionId: string;
    employeeId: string;
    // Parameter/field in the surrounding signature or type.
    expectedVersion?: number;
    // Parameter/field in the surrounding signature or type.
    bypassSessionOwnerCheck?: boolean;
  },
  alreadyTerminal: "completed" | "cancelled",
) {
  // Load session needed for the next decision or write.
  const session = await tx.cleaningSession.findUniqueOrThrow({
    // Restrict the query to the relevant rows only.
    where: { id: input.sessionId },
  });
  // Branch when this condition holds for the domain rule.
  if (
    // Execute: !input.bypassSessionOwnerCheck &&
    !input.bypassSessionOwnerCheck &&
    // Execute: session.employeeId !== input.employeeId
    session.employeeId !== input.employeeId
  ) {
    // Load taskPeek needed for the next decision or write.
    const taskPeek = await tx.cleaningTask.findUnique({
      // Restrict the query to the relevant rows only.
      where: { id: session.taskId },
    });
    // Abort with an HTTP-mapped AppError or rethrow.
    throw new AppError(
      // Execute: 409,
      409,
      // Execute: "assignee_conflict",
      "assignee_conflict",
      // Execute: "Session belongs to another employee",
      "Session belongs to another employee",
      // Execute: taskPeek
      taskPeek
        // Continue the previous expression with this clause.
        ? taskConflictDetails(taskPeek, input.expectedVersion)
        // Continue the previous expression with this clause.
        : undefined,
    );
  }
  // Branch when this condition holds for the domain rule.
  if (session.status === alreadyTerminal) {
    // Abort with an HTTP-mapped AppError or rethrow.
    throw new AppError(
      // Execute: 409,
      409,
      // Execute: "invalid_state",
      "invalid_state",
      // Execute: alreadyTerminal === "completed"
      alreadyTerminal === "completed"
        // Continue the previous expression with this clause.
        ? "Session already completed"
        // Continue the previous expression with this clause.
        : "Session already cancelled",
    );
  }
  // Guard: handle missing/invalid state before continuing.
  if (session.status !== SessionStatus.running) {
    // Abort with an HTTP-mapped AppError or rethrow.
    throw new AppError(
      // Execute: 409,
      409,
      // Execute: "invalid_state",
      "invalid_state",
      // Execute: alreadyTerminal === "completed"
      alreadyTerminal === "completed"
        // Continue the previous expression with this clause.
        ? `Cannot complete session in status ${session.status}`
        // Continue the previous expression with this clause.
        : `Cannot cancel session in status ${session.status}`,
    );
  }

  // Load task needed for the next decision or write.
  const task = await tx.cleaningTask.findUniqueOrThrow({
    // Restrict the query to the relevant rows only.
    where: { id: session.taskId },
  });
  // Execute: assertTaskVersion(task, input.expectedVersion);
  assertTaskVersion(task, input.expectedVersion);

  // Construct finishedAt for later use in this flow.
  const finishedAt = new Date();
  // Branch when this condition holds for the domain rule.
  if (finishedAt < session.startedAt) {
    // Abort with an HTTP-mapped AppError or rethrow.
    throw new AppError(400, "invalid_time", "Finish time before start time");
  }

  return { session, task, finishedAt };
}
