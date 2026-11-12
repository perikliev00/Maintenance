/**
 * Offline cleaning.start / cleaning.complete handlers with grant + scope checks.
 * Scope 403 after reassignment becomes a conflict (assignee_conflict / out_of_scope).
 * Payloads are already Zod-parsed by applyCommand.
 */
import { AppError } from "../../../errors";
// Import type(s) AuthUser for typing without runtime cost.
import type { AuthUser } from "../../../auth/tokens";
// Import module ../../roleGrants for this service.
import { canPerform } from "../../roleGrants";
// Import module dependency for this service.
import {
  // Run next step: completeCleaningSession,
  completeCleaningSession,
  // Run next step: startCleaningTask,
  startCleaningTask,
// Run next step: } from "../../cleaning";
} from "../../cleaning";
// Import module ../../cleaning/authorization for this service.
import { canBypassCleaningAssignee } from "../../cleaning/authorization";
// Import module dependency for this service.
import {
  // Run next step: assertCanAccessSession,
  assertCanAccessSession,
  // Run next step: assertCanAccessTask,
  assertCanAccessTask,
  // Declare type DataScope for callers and internals.
  type DataScope,
// Run next step: } from "../../dataScope";
} from "../../dataScope";
// Import type(s) ParsedSyncCommand for typing without runtime cost.
import type { ParsedSyncCommand } from "../commandSchemas";
// Import module ../conflicts for this service.
import { conflictFromAccessLoss } from "../conflicts";
// Import type(s) SyncCommand, SyncCommandResult for typing without runtime cost.
import type { SyncCommand, SyncCommandResult } from "../types";

// Define asWireCmd — core behavior for this module.
function asWireCmd(
  // Set cmd on the structure being built.
  cmd: ParsedSyncCommand,
// Run next step: ): SyncCommand {
): SyncCommand {
  // Return the computed result to the caller.
  return {
    // Set commandId on the structure being built.
    commandId: cmd.commandId,
    // Set type on the structure being built.
    type: cmd.type,
    // Set payload on the structure being built.
    payload: cmd.payload as unknown as Record<string, unknown>,
    // Set clientTime on the structure being built.
    clientTime: cmd.clientTime,
  };
}

/** Start a cleaning session; forwards expectedVersion for optimistic concurrency. */
export async function handleCleaningStart(
  // Set user on the structure being built.
  user: AuthUser,
  // Set scope on the structure being built.
  scope: DataScope,
  // Set cmd on the structure being built.
  cmd: Extract<ParsedSyncCommand, { type: "cleaning.start" }>,
// Run next step: ): Promise<SyncCommandResult> {
): Promise<SyncCommandResult> {
  // Branch when this condition holds so the right path runs.
  if (!(await canPerform(user.role, "cleaning.start"))) {
    // Return the computed result to the caller.
    return {
      // Set commandId on the structure being built.
      commandId: cmd.commandId,
      // Set status on the structure being built.
      status: "forbidden",
      // Set message on the structure being built.
      message: "Missing cleaning.start",
    };
  }
  // Destructure value fields needed locally.
  const { taskId, expectedVersion } = cmd.payload;
  // Attempt the fallible work so errors can be handled below.
  try {
    // Wait for the async step before continuing.
    await assertCanAccessTask(scope, taskId);
  // Run next step: } catch (err) {
  } catch (err) {
    // Branch when this condition holds so the right path runs.
    if (err instanceof AppError) {
      // Load mapped asynchronously for the next steps.
      const mapped = await conflictFromAccessLoss(
        // Run next step: asWireCmd(cmd),
        asWireCmd(cmd),
        // Run next step: err,
        err,
        // Run next step: expectedVersion,
        expectedVersion,
      );
      // Branch when this condition holds so the right path runs.
      if (mapped) return mapped;
    }
    // Abort with an error so callers can react.
    throw err;
  }
  // Load result asynchronously for the next steps.
  const result = await startCleaningTask({
    // Run next step: taskId,
    taskId,
    // Set employeeId on the structure being built.
    employeeId: user.employeeId,
    // Set commandId on the structure being built.
    commandId: cmd.commandId,
    // Run next step: expectedVersion,
    expectedVersion,
    // Set bypassAssigneeCheck on the structure being built.
    bypassAssigneeCheck: canBypassCleaningAssignee(user.role),
  });
  // Return the computed result to the caller.
  return { commandId: cmd.commandId, status: "ok", data: result };
}

/** Complete a running session; same access-loss → conflict mapping as start. */
export async function handleCleaningComplete(
  // Set user on the structure being built.
  user: AuthUser,
  // Set scope on the structure being built.
  scope: DataScope,
  // Set cmd on the structure being built.
  cmd: Extract<ParsedSyncCommand, { type: "cleaning.complete" }>,
// Run next step: ): Promise<SyncCommandResult> {
): Promise<SyncCommandResult> {
  // Branch when this condition holds so the right path runs.
  if (!(await canPerform(user.role, "cleaning.complete"))) {
    // Return the computed result to the caller.
    return {
      // Set commandId on the structure being built.
      commandId: cmd.commandId,
      // Set status on the structure being built.
      status: "forbidden",
      // Set message on the structure being built.
      message: "Missing cleaning.complete",
    };
  }
  // Destructure value fields needed locally.
  const { sessionId, notes, expectedVersion } = cmd.payload;
  // Attempt the fallible work so errors can be handled below.
  try {
    // Wait for the async step before continuing.
    await assertCanAccessSession(scope, sessionId);
  // Run next step: } catch (err) {
  } catch (err) {
    // Branch when this condition holds so the right path runs.
    if (err instanceof AppError) {
      // Load mapped asynchronously for the next steps.
      const mapped = await conflictFromAccessLoss(
        // Run next step: asWireCmd(cmd),
        asWireCmd(cmd),
        // Run next step: err,
        err,
        // Run next step: expectedVersion,
        expectedVersion,
      );
      // Branch when this condition holds so the right path runs.
      if (mapped) return mapped;
    }
    // Abort with an error so callers can react.
    throw err;
  }
  // Load result asynchronously for the next steps.
  const result = await completeCleaningSession({
    // Run next step: sessionId,
    sessionId,
    // Set employeeId on the structure being built.
    employeeId: user.employeeId,
    // Set commandId on the structure being built.
    commandId: cmd.commandId,
    // Run next step: notes,
    notes,
    // Run next step: expectedVersion,
    expectedVersion,
    // Set bypassSessionOwnerCheck on the structure being built.
    bypassSessionOwnerCheck: canBypassCleaningAssignee(user.role),
  });
  // Return the computed result to the caller.
  return { commandId: cmd.commandId, status: "ok", data: result };
}
