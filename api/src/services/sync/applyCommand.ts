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

export async function applyCommand(
  user: AuthUser,
  cmd: SyncCommand,
): Promise<SyncCommandResult> {
  try {
    const scope = await resolveDataScope(user);

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
        return {
          commandId: cmd.commandId,
          status: "error",
          message: `Unknown command type ${cmd.type}`,
        };
    }
  } catch (err) {
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
    return {
      commandId: cmd.commandId,
      status: "error",
      message: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
