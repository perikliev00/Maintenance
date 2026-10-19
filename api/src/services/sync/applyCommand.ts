/**
 * Dispatch one sync command by type and map AppError status to SyncCommandResult.
 * 403 → forbidden, 409 → conflict; unknown types → error.
 */
import { AppError } from "../../errors";
import { z } from "zod";
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

const id = z.string().min(1);
const version = z.number().int().positive().optional();
const payloadSchemas: Record<string, z.ZodTypeAny> = {
  "cleaning.start": z.object({ taskId: id, expectedVersion: version }),
  "cleaning.complete": z.object({ sessionId: id, expectedVersion: version, notes: z.string().optional() }),
  "ticket.report": z.object({ locationId: id, issueOptionId: id.optional(), categoryId: id.optional(), title: z.string().optional(), priority: z.enum(["low", "normal", "high", "urgent"]).optional(), blocksRoom: z.boolean().optional() }),
  "ticket.start": z.object({ ticketId: id }),
  "ticket.wait": z.object({ ticketId: id, reason: z.string().optional() }),
  "ticket.resume": z.object({ ticketId: id }),
  "ticket.resolve": z.object({ ticketId: id, resolutionNotes: z.string().optional() }),
};

/**
 * Resolve the user's data scope once, then hand off to a typed handler.
 * Handlers may further remap access-loss 403s to conflict (see conflicts.ts).
 */
export async function applyCommand(
  user: AuthUser,
  cmd: SyncCommand,
): Promise<SyncCommandResult> {
  try {
    const schema = payloadSchemas[cmd.type];
    if (schema && !schema.safeParse(cmd.payload).success) {
      return { commandId: cmd.commandId, status: "error", code: "validation", message: "Invalid command payload" };
    }
    // Scope once per command so handlers share the same sector/assignment view.
    const scope = await resolveDataScope(user);

    // Dispatch by offline command type; handlers own validation + mutations.
    switch (cmd.type) {
      case "cleaning.start":
        return await handleCleaningStart(user, scope, cmd);
      case "cleaning.complete":
        return await handleCleaningComplete(user, scope, cmd);
      case "ticket.report":
        return await handleTicketReport(user, scope, cmd);
      case "ticket.start":
        return await handleTicketStart(user, scope, cmd);
      case "ticket.wait":
        return await handleTicketWait(user, scope, cmd);
      case "ticket.resume":
        return await handleTicketResume(user, scope, cmd);
      case "ticket.resolve":
        return await handleTicketResolve(user, scope, cmd);
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
