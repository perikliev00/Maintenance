import { Prisma, SessionStatus, TaskStatus } from "@prisma/client";
import { AppError } from "../../errors";
import type { Tx } from "./locks";

export type TaskConflictDetails = {
  expectedVersion?: number;
  currentVersion: number;
  status: string;
  assignedEmployeeId: string | null;
};

export function taskConflictDetails(
  task: {
    version: number;
    status: string;
    assignedEmployeeId: string | null;
  },
  expectedVersion?: number,
): TaskConflictDetails {
  return {
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    currentVersion: task.version,
    status: task.status,
    assignedEmployeeId: task.assignedEmployeeId,
  };
}

export function assertTaskVersion(
  task: {
    version: number;
    status: string;
    assignedEmployeeId: string | null;
  },
  expectedVersion?: number,
) {
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
}

export async function claimRunningSession(
  tx: Tx,
  sessionId: string,
  data: Prisma.CleaningSessionUpdateManyMutationInput,
) {
  const claimed = await tx.cleaningSession.updateMany({
    where: { id: sessionId, status: SessionStatus.running },
    data,
  });
  if (claimed.count === 0) {
    throw new AppError(
      409,
      "invalid_state",
      "Session is no longer running",
    );
  }
}

export async function claimTaskStatus(
  tx: Tx,
  taskId: string,
  fromStatuses: TaskStatus[],
  data: Prisma.CleaningTaskUncheckedUpdateManyInput,
  expectedVersion?: number,
) {
  const claimed = await tx.cleaningTask.updateMany({
    where: {
      id: taskId,
      status: { in: fromStatuses },
      ...(expectedVersion !== undefined ? { version: expectedVersion } : {}),
    },
    data: {
      ...data,
      version: { increment: 1 },
    },
  });
  if (claimed.count === 0) {
    const task = await tx.cleaningTask.findUnique({ where: { id: taskId } });
    if (!task) {
      throw new AppError(404, "not_found", "Task not found");
    }
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
    throw new AppError(
      409,
      "invalid_state",
      `Cannot transition task from status ${task.status}`,
      taskConflictDetails(task, expectedVersion),
    );
  }
}
