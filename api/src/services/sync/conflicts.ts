import { prisma } from "../../db";
import { AppError } from "../../errors";
import type { TaskConflictDetails } from "../cleaning";
import type { SyncCommand, SyncCommandResult } from "./types";

async function taskSnapshotDetails(
  taskId: string,
  expectedVersion?: number,
): Promise<TaskConflictDetails | undefined> {
  const task = await prisma.cleaningTask.findUnique({
    where: { id: taskId },
    select: {
      version: true,
      status: true,
      assignedEmployeeId: true,
    },
  });
  if (!task) return undefined;
  return {
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    currentVersion: task.version,
    status: task.status,
    assignedEmployeeId: task.assignedEmployeeId,
  };
}

async function sessionTaskSnapshotDetails(
  sessionId: string,
  expectedVersion?: number,
): Promise<TaskConflictDetails | undefined> {
  const session = await prisma.cleaningSession.findUnique({
    where: { id: sessionId },
    select: { taskId: true },
  });
  if (!session) return undefined;
  return taskSnapshotDetails(session.taskId, expectedVersion);
}

/** Build a sync conflict result for access loss after reassignment. */
export function accessLossConflictResult(
  commandId: string,
  details: TaskConflictDetails | undefined,
  fallbackMessage: string,
): SyncCommandResult {
  return {
    commandId,
    status: "conflict",
    code: details ? "assignee_conflict" : "out_of_scope",
    message: details
      ? "Task was reassigned to another employee"
      : fallbackMessage,
    details,
  };
}

/**
 * Access loss after reassignment is a conflict for offline sync, not a bare
 * permission denial. True "missing action" denials stay forbidden.
 */
export async function conflictFromAccessLoss(
  cmd: SyncCommand,
  err: AppError,
  expectedVersion?: number,
): Promise<SyncCommandResult | null> {
  if (err.status !== 403) return null;
  if (cmd.type === "cleaning.start") {
    const taskId = String(cmd.payload.taskId ?? "");
    const details = await taskSnapshotDetails(taskId, expectedVersion);
    return accessLossConflictResult(cmd.commandId, details, err.message);
  }
  if (cmd.type === "cleaning.complete") {
    const sessionId = String(cmd.payload.sessionId ?? "");
    const details = await sessionTaskSnapshotDetails(
      sessionId,
      expectedVersion,
    );
    return accessLossConflictResult(cmd.commandId, details, err.message);
  }
  return null;
}
