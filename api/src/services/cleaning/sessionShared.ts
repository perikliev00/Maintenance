/**
 * Shared includes, payload matchers, and complete/cancel lock+guard prelude.
 */
import { SessionStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { AppError } from "../../errors";
import { taskInclude } from "../cleaningTasksQuery";
import { assertTaskVersion, taskConflictDetails } from "./claims";
import { lockSession, lockTask } from "./locks";

type TxClient = Prisma.TransactionClient;

export const sessionWithTaskInclude = {
  task: { include: taskInclude },
} as const;

export function startSessionPayloadMatches(
  row: { taskId: string; employeeId: string },
  input: { taskId: string; employeeId: string },
): boolean {
  return row.taskId === input.taskId && row.employeeId === input.employeeId;
}

export function sessionCommandPayloadMatches(
  row: {
    id: string;
    employeeId: string;
    completeActorEmployeeId?: string | null;
    cancelActorEmployeeId?: string | null;
  },
  input: { sessionId: string; employeeId: string },
  kind: "complete" | "cancel",
): boolean {
  const priorActor =
    kind === "complete"
      ? (row.completeActorEmployeeId ?? row.employeeId)
      : (row.cancelActorEmployeeId ?? row.employeeId);
  return row.id === input.sessionId && priorActor === input.employeeId;
}

/** Peek session, lock task→session. Throws 404 when missing. */
export async function peekAndLockSession(
  tx: TxClient,
  sessionId: string,
): Promise<{ id: string; taskId: string }> {
  const sessionPeek = await tx.cleaningSession.findUnique({
    where: { id: sessionId },
  });
  if (!sessionPeek) {
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
  input: {
    sessionId: string;
    employeeId: string;
    expectedVersion?: number;
    bypassSessionOwnerCheck?: boolean;
  },
  alreadyTerminal: "completed" | "cancelled",
) {
  const session = await tx.cleaningSession.findUniqueOrThrow({
    where: { id: input.sessionId },
  });
  if (
    !input.bypassSessionOwnerCheck &&
    session.employeeId !== input.employeeId
  ) {
    const taskPeek = await tx.cleaningTask.findUnique({
      where: { id: session.taskId },
    });
    throw new AppError(
      409,
      "assignee_conflict",
      "Session belongs to another employee",
      taskPeek
        ? taskConflictDetails(taskPeek, input.expectedVersion)
        : undefined,
    );
  }
  if (session.status === alreadyTerminal) {
    throw new AppError(
      409,
      "invalid_state",
      alreadyTerminal === "completed"
        ? "Session already completed"
        : "Session already cancelled",
    );
  }
  if (session.status !== SessionStatus.running) {
    throw new AppError(
      409,
      "invalid_state",
      alreadyTerminal === "completed"
        ? `Cannot complete session in status ${session.status}`
        : `Cannot cancel session in status ${session.status}`,
    );
  }

  const task = await tx.cleaningTask.findUniqueOrThrow({
    where: { id: session.taskId },
  });
  assertTaskVersion(task, input.expectedVersion);

  const finishedAt = new Date();
  if (finishedAt < session.startedAt) {
    throw new AppError(400, "invalid_time", "Finish time before start time");
  }

  return { session, task, finishedAt };
}
