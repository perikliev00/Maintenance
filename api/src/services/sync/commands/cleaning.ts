/**
 * Offline cleaning.start / cleaning.complete handlers with grant + scope checks.
 * Scope 403 after reassignment becomes a conflict (assignee_conflict / out_of_scope).
 * Payloads are already Zod-parsed by applyCommand.
 */
import { AppError } from "../../../errors";
// Import type(s) AuthUser for typing without runtime cost.
import type { AuthUser } from "../../../auth/tokens";
import { canPerform } from "../../roleGrants";
import {
  completeCleaningSession,
  startCleaningTask,
} from "../../cleaning";
import { canBypassCleaningAssignee } from "../../cleaning/authorization";
import {
  assertCanAccessSession,
  assertCanAccessTask,
  // Declare type DataScope for callers and internals.
  type DataScope,
} from "../../dataScope";
// Import type(s) ParsedSyncCommand for typing without runtime cost.
import type { ParsedSyncCommand } from "../commandSchemas";
import { conflictFromAccessLoss } from "../conflicts";
// Import type(s) SyncCommand, SyncCommandResult for typing without runtime cost.
import type { SyncCommand, SyncCommandResult } from "../types";

function asWireCmd(
  cmd: ParsedSyncCommand,
): SyncCommand {
  return {
    commandId: cmd.commandId,
    type: cmd.type,
    payload: cmd.payload as unknown as Record<string, unknown>,
    clientTime: cmd.clientTime,
  };
}

/** Start a cleaning session; forwards expectedVersion for optimistic concurrency. */
export async function handleCleaningStart(
  user: AuthUser,
  scope: DataScope,
  cmd: Extract<ParsedSyncCommand, { type: "cleaning.start" }>,
): Promise<SyncCommandResult> {
  if (!(await canPerform(user.role, "cleaning.start"))) {
    return {
      commandId: cmd.commandId,
      status: "forbidden",
      message: "Missing cleaning.start",
    };
  }
  const { taskId, expectedVersion } = cmd.payload;
  try {
    await assertCanAccessTask(scope, taskId);
  } catch (err) {
    if (err instanceof AppError) {
      const mapped = await conflictFromAccessLoss(
        asWireCmd(cmd),
        err,
        expectedVersion,
      );
      if (mapped) return mapped;
    }
    throw err;
  }
  const result = await startCleaningTask({
    taskId,
    employeeId: user.employeeId,
    commandId: cmd.commandId,
    expectedVersion,
    bypassAssigneeCheck: canBypassCleaningAssignee(user.role),
  });
  return { commandId: cmd.commandId, status: "ok", data: result };
}

/** Complete a running session; same access-loss → conflict mapping as start. */
export async function handleCleaningComplete(
  user: AuthUser,
  scope: DataScope,
  cmd: Extract<ParsedSyncCommand, { type: "cleaning.complete" }>,
): Promise<SyncCommandResult> {
  if (!(await canPerform(user.role, "cleaning.complete"))) {
    return {
      commandId: cmd.commandId,
      status: "forbidden",
      message: "Missing cleaning.complete",
    };
  }
  const { sessionId, notes, expectedVersion } = cmd.payload;
  try {
    await assertCanAccessSession(scope, sessionId);
  } catch (err) {
    if (err instanceof AppError) {
      const mapped = await conflictFromAccessLoss(
        asWireCmd(cmd),
        err,
        expectedVersion,
      );
      if (mapped) return mapped;
    }
    throw err;
  }
  const result = await completeCleaningSession({
    sessionId,
    employeeId: user.employeeId,
    commandId: cmd.commandId,
    notes,
    expectedVersion,
    bypassSessionOwnerCheck: canBypassCleaningAssignee(user.role),
  });
  return { commandId: cmd.commandId, status: "ok", data: result };
}
