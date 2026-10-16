/**
 * Dispatch one sync command by type and map AppError status to SyncCommandResult.
 * 403 → forbidden, 409 → conflict; unknown types → error.
 */
import { AppError } from "../../errors";
import type { AuthUser } from "../../middleware/auth";
import { resolveDataScope } from "../dataScope";
import {
  handleCleaningComplete,
  handleCleaningStart,
} from "./commands/cleaning";
import {
  handleTicketReport,
  handleTicketResolve,
  handleTicketResume,
  handleTicketStart,
  handleTicketWait,
} from "./commands/tickets";
import type { SyncCommand, SyncCommandResult } from "./types";

/**
 * Resolve the user's data scope once, then hand off to a typed handler.
 * Handlers may further remap access-loss 403s to conflict (see conflicts.ts).
 */
export async function applyCommand(
  user: AuthUser,
  cmd: SyncCommand,
): Promise<SyncCommandResult> {
  try {
    // Scope once per command so handlers share the same sector/assignment view.
    const scope = await resolveDataScope(user);

    // Dispatch by offline command type; handlers own validation + mutations.
    switch (cmd.type) {
      case "cleaning.start":
        return handleCleaningStart(user, scope, cmd);
      case "cleaning.complete":
        return handleCleaningComplete(user, scope, cmd);
      case "ticket.report":
        return handleTicketReport(user, scope, cmd);
      case "ticket.start":
        return handleTicketStart(user, scope, cmd);
      case "ticket.wait":
        return handleTicketWait(user, scope, cmd);
      case "ticket.resume":
        return handleTicketResume(user, scope, cmd);
      case "ticket.resolve":
        return handleTicketResolve(user, scope, cmd);
      default:
        // Forward-compat: unknown types fail soft so the batch can continue.
        return {
          commandId: cmd.commandId,
          status: "error",
          message: `Unknown command type ${cmd.type}`,
        };
    }
  } catch (err) {
    // Map AppError HTTP statuses into sync result statuses for the client.
    if (err instanceof AppError) {
      if (err.status === 403) {
        return {
          commandId: cmd.commandId,
          status: "forbidden",
          message: err.message,
        };
      }
      if (err.status === 409) {
        return {
          commandId: cmd.commandId,
          status: "conflict",
          message: err.message,
          code: err.code,
          details: err.details,
        };
      }
      return {
        commandId: cmd.commandId,
        status: "error",
        message: err.message,
      };
    }
    // Unexpected throws become opaque error results (batch continues).
    return {
      commandId: cmd.commandId,
      status: "error",
      message: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
