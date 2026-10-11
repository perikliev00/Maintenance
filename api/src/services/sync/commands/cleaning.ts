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

export async function handleCleaningStart(
  user: AuthUser,
  scope: DataScope,
  cmd: SyncCommand,
): Promise<SyncCommandResult> {
  if (!(await canPerform(user.role, "cleaning.start"))) {
    return {
      commandId: cmd.commandId,
      status: "forbidden",
      message: "Missing cleaning.start",
    };
  }
  const taskId = String(cmd.payload.taskId ?? "");
  const expectedVersion =
    typeof cmd.payload.expectedVersion === "number"
      ? cmd.payload.expectedVersion
      : undefined;
  try {
    await assertCanAccessTask(scope, taskId);
  } catch (err) {
    if (err instanceof AppError) {
      const mapped = await conflictFromAccessLoss(
        cmd,
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
  });
  return { commandId: cmd.commandId, status: "ok", data: result };
}

export async function handleCleaningComplete(
  user: AuthUser,
  scope: DataScope,
  cmd: SyncCommand,
): Promise<SyncCommandResult> {
  if (!(await canPerform(user.role, "cleaning.complete"))) {
    return {
      commandId: cmd.commandId,
      status: "forbidden",
      message: "Missing cleaning.complete",
    };
  }
  const sessionId = String(cmd.payload.sessionId ?? "");
  const notes =
    typeof cmd.payload.notes === "string" ? cmd.payload.notes : undefined;
  const expectedVersion =
    typeof cmd.payload.expectedVersion === "number"
      ? cmd.payload.expectedVersion
      : undefined;
  try {
    await assertCanAccessSession(scope, sessionId);
  } catch (err) {
    if (err instanceof AppError) {
      const mapped = await conflictFromAccessLoss(
        cmd,
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
  });
  return { commandId: cmd.commandId, status: "ok", data: result };
}
