/**
 * Offline cleaning.start / cleaning.complete handlers with grant + scope checks.
 * Scope 403 after reassignment becomes a conflict (assignee_conflict / out_of_scope).
 */
import { AppError } from "../../../errors";
import type { AuthUser } from "../../../middleware/auth";
import { canPerform } from "../../roleGrants";
import {
  completeCleaningSession,
  startCleaningTask,
} from "../../cleaning";
import {
  assertCanAccessSession,
  assertCanAccessTask,
  type DataScope,
} from "../../dataScope";
import { conflictFromAccessLoss } from "../conflicts";
import type { SyncCommand, SyncCommandResult } from "../types";

/** Start a cleaning session; forwards expectedVersion for optimistic concurrency. */
export async function handleCleaningStart(
  user: AuthUser,
  scope: DataScope,
  cmd: SyncCommand,
): Promise<SyncCommandResult> {
  // Soft-forbidden so the offline batch can continue with other commands.
  if (!(await canPerform(user.role, "cleaning.start"))) {
    return {
      commandId: cmd.commandId,
      status: "forbidden",
      message: "Missing cleaning.start",
    };
  }
  // Payload taskId is required by startCleaningTask; coerce empties to "".
  const taskId = String(cmd.payload.taskId ?? "");
  // Optimistic concurrency token from the offline client snapshot.
  const expectedVersion =
    typeof cmd.payload.expectedVersion === "number"
      ? cmd.payload.expectedVersion
      : undefined;
  try {
    // Data-scope gate before mutation (sector / assignee visibility).
    await assertCanAccessTask(scope, taskId);
  } catch (err) {
    // Access lost (e.g. reassigned) while offline → conflict with task snapshot.
    if (err instanceof AppError) {
      const mapped = await conflictFromAccessLoss(
        cmd,
        err,
        expectedVersion,
      );
      // Remapped access-loss 403 → conflict; other AppErrors rethrow.
      if (mapped) return mapped;
    }
    throw err;
  }
  // Domain start (idempotent via commandId + expectedVersion CAS).
  const result = await startCleaningTask({
    taskId,
    employeeId: user.employeeId,
    commandId: cmd.commandId,
    expectedVersion,
  });
  return { commandId: cmd.commandId, status: "ok", data: result };
}

/** Complete a running session; same access-loss → conflict mapping as start. */
export async function handleCleaningComplete(
  user: AuthUser,
  scope: DataScope,
  cmd: SyncCommand,
): Promise<SyncCommandResult> {
  // Soft-forbidden so the offline batch can continue with other commands.
  if (!(await canPerform(user.role, "cleaning.complete"))) {
    return {
      commandId: cmd.commandId,
      status: "forbidden",
      message: "Missing cleaning.complete",
    };
  }
  // Session id from the offline client; notes optional free text.
  const sessionId = String(cmd.payload.sessionId ?? "");
  const notes =
    typeof cmd.payload.notes === "string" ? cmd.payload.notes : undefined;
  // Optimistic concurrency token from the offline client snapshot.
  const expectedVersion =
    typeof cmd.payload.expectedVersion === "number"
      ? cmd.payload.expectedVersion
      : undefined;
  try {
    // Data-scope gate before mutation (session → task visibility).
    await assertCanAccessSession(scope, sessionId);
  } catch (err) {
    // Same reassignment → conflict remapping as start.
    if (err instanceof AppError) {
      const mapped = await conflictFromAccessLoss(
        cmd,
        err,
        expectedVersion,
      );
      // Remapped access-loss 403 → conflict; other AppErrors rethrow.
      if (mapped) return mapped;
    }
    throw err;
  }
  // Domain complete (idempotent via commandId + expectedVersion CAS).
  const result = await completeCleaningSession({
    sessionId,
    employeeId: user.employeeId,
    commandId: cmd.commandId,
    notes,
    expectedVersion,
  });
  return { commandId: cmd.commandId, status: "ok", data: result };
}
