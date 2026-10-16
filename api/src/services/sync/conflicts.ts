/**
 * Map access-loss 403s during offline cleaning sync into conflict results so
 * clients can refresh task state instead of treating them as hard permission errors.
 */
import { prisma } from "../../db";
import { AppError } from "../../errors";
import type { TaskConflictDetails } from "../cleaning";
import type { SyncCommand, SyncCommandResult } from "./types";

/**
 * Current task version/status/assignee for conflict payloads.
 */
async function taskSnapshotDetails(
  taskId: string,
  expectedVersion?: number,
): Promise<TaskConflictDetails | undefined> {
  // Load the live task row the offline client may be racing against.
  const task = await prisma.cleaningTask.findUnique({
    where: { id: taskId },
    select: {
      version: true,
      status: true,
      assignedEmployeeId: true,
    },
  });
  // Missing task → caller uses out_of_scope fallback message.
  if (!task) return undefined;
  // Include client's expectedVersion when provided so the UI can show the race.
  return {
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    currentVersion: task.version,
    status: task.status,
    assignedEmployeeId: task.assignedEmployeeId,
  };
}

/**
 * Resolve a session id to its parent task snapshot for complete-command conflicts.
 */
async function sessionTaskSnapshotDetails(
  sessionId: string,
  expectedVersion?: number,
): Promise<TaskConflictDetails | undefined> {
  // Complete commands reference a session; map back to the parent task.
  const session = await prisma.cleaningSession.findUnique({
    where: { id: sessionId },
    select: { taskId: true },
  });
  // Orphaned / deleted session → no snapshot (out_of_scope fallback).
  if (!session) return undefined;
  return taskSnapshotDetails(session.taskId, expectedVersion);
}

/** Build a sync conflict result for access loss after reassignment. */
export function accessLossConflictResult(
  commandId: string,
  details: TaskConflictDetails | undefined,
  fallbackMessage: string,
): SyncCommandResult {
  // With a snapshot → assignee_conflict; without → generic out_of_scope.
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
  // Only 403s are remapped; other AppErrors stay as-is for applyCommand.
  if (err.status !== 403) return null;
  // Start commands carry taskId directly in the payload.
  if (cmd.type === "cleaning.start") {
    const taskId = String(cmd.payload.taskId ?? "");
    const details = await taskSnapshotDetails(taskId, expectedVersion);
    return accessLossConflictResult(cmd.commandId, details, err.message);
  }
  // Complete commands reference a session; resolve back to the task.
  if (cmd.type === "cleaning.complete") {
    const sessionId = String(cmd.payload.sessionId ?? "");
    const details = await sessionTaskSnapshotDetails(
      sessionId,
      expectedVersion,
    );
    return accessLossConflictResult(cmd.commandId, details, err.message);
  }
  // Other command types do not remap access loss.
  return null;
}
