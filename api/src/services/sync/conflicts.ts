/**
 * Map access-loss 403s during offline cleaning sync into conflict results so
 * clients can refresh task state instead of treating them as hard permission errors.
 */
import { prisma } from "../../db";
// Import module ../../errors for this service.
import { AppError } from "../../errors";
// Import type(s) TaskConflictDetails for typing without runtime cost.
import type { TaskConflictDetails } from "../cleaning";
// Import type(s) SyncCommand, SyncCommandResult for typing without runtime cost.
import type { SyncCommand, SyncCommandResult } from "./types";

/**
 * Current task version/status/assignee for conflict payloads.
 */
async function taskSnapshotDetails(
  // Set taskId on the structure being built.
  taskId: string,
  // Run next step: expectedVersion?: number,
  expectedVersion?: number,
// Run next step: ): Promise<TaskConflictDetails | undefined> {
): Promise<TaskConflictDetails | undefined> {
  // Load the live task row the offline client may be racing against.
  const task = await prisma.cleaningTask.findUnique({
    // Set where on the structure being built.
    where: { id: taskId },
    // Set select on the structure being built.
    select: {
      // Set version on the structure being built.
      version: true,
      // Set status on the structure being built.
      status: true,
      // Set assignedEmployeeId on the structure being built.
      assignedEmployeeId: true,
    },
  });
  // Missing task → caller uses out_of_scope fallback message.
  if (!task) return undefined;
  // Include client's expectedVersion when provided so the UI can show the race.
  return {
    // Run next step: ...(expectedVersion !== undefined ? { expectedVersion } : {}…
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    // Set currentVersion on the structure being built.
    currentVersion: task.version,
    // Set status on the structure being built.
    status: task.status,
    // Set assignedEmployeeId on the structure being built.
    assignedEmployeeId: task.assignedEmployeeId,
  };
}

/**
 * Resolve a session id to its parent task snapshot for complete-command conflicts.
 */
async function sessionTaskSnapshotDetails(
  // Set sessionId on the structure being built.
  sessionId: string,
  // Run next step: expectedVersion?: number,
  expectedVersion?: number,
// Run next step: ): Promise<TaskConflictDetails | undefined> {
): Promise<TaskConflictDetails | undefined> {
  // Complete commands reference a session; map back to the parent task.
  const session = await prisma.cleaningSession.findUnique({
    // Set where on the structure being built.
    where: { id: sessionId },
    // Set select on the structure being built.
    select: { taskId: true },
  });
  // Orphaned / deleted session → no snapshot (out_of_scope fallback).
  if (!session) return undefined;
  // Return the computed result to the caller.
  return taskSnapshotDetails(session.taskId, expectedVersion);
}

/** Build a sync conflict result for access loss after reassignment. */
export function accessLossConflictResult(
  // Set commandId on the structure being built.
  commandId: string,
  // Set details on the structure being built.
  details: TaskConflictDetails | undefined,
  // Set fallbackMessage on the structure being built.
  fallbackMessage: string,
// Run next step: ): SyncCommandResult {
): SyncCommandResult {
  // With a snapshot → assignee_conflict; without → generic out_of_scope.
  return {
    // Run next step: commandId,
    commandId,
    // Set status on the structure being built.
    status: "conflict",
    // Set code on the structure being built.
    code: details ? "assignee_conflict" : "out_of_scope",
    // Set message on the structure being built.
    message: details
      // Complete the ternary or optional chain started above.
      ? "Task was reassigned to another employee"
      // Complete the ternary or optional chain started above.
      : fallbackMessage,
    // Run next step: details,
    details,
  };
}

/**
 * Access loss after reassignment is a conflict for offline sync, not a bare
 * permission denial. True "missing action" denials stay forbidden.
 */
export async function conflictFromAccessLoss(
  // Set cmd on the structure being built.
  cmd: SyncCommand,
  // Set err on the structure being built.
  err: AppError,
  // Run next step: expectedVersion?: number,
  expectedVersion?: number,
// Run next step: ): Promise<SyncCommandResult | null> {
): Promise<SyncCommandResult | null> {
  // Only 403s are remapped; other AppErrors stay as-is for applyCommand.
  if (err.status !== 403) return null;
  // Start commands carry taskId directly in the payload.
  if (cmd.type === "cleaning.start") {
    // Capture task id for use in this scope.
    const taskId = String(cmd.payload.taskId ?? "");
    // Load details asynchronously for the next steps.
    const details = await taskSnapshotDetails(taskId, expectedVersion);
    // Return the computed result to the caller.
    return accessLossConflictResult(cmd.commandId, details, err.message);
  }
  // Complete commands reference a session; resolve back to the task.
  if (cmd.type === "cleaning.complete") {
    // Capture session id for use in this scope.
    const sessionId = String(cmd.payload.sessionId ?? "");
    // Load details asynchronously for the next steps.
    const details = await sessionTaskSnapshotDetails(
      // Run next step: sessionId,
      sessionId,
      // Run next step: expectedVersion,
      expectedVersion,
    );
    // Return the computed result to the caller.
    return accessLossConflictResult(cmd.commandId, details, err.message);
  }
  // Other command types do not remap access loss.
  return null;
}
