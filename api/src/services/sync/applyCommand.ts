/**
 * Dispatch one sync command by type and map AppError status to SyncCommandResult.
 * 403 → forbidden, 409 → conflict; unknown types → error.
 */
import { Prisma } from "@prisma/client";
import { AppError } from "../../errors";
import { safeErrorMessage } from "../../observability";
import { z } from "zod";
import type { AuthUser } from "../../middleware/auth";
import { resolveDataScope } from "../dataScope";
import {
  handleCleaningComplete,
  handleCleaningStart,
} from "./commands/cleaning";
import {
  handleTicketAssign,
  handleTicketClose,
  handleTicketReport,
  handleTicketReopen,
  handleTicketResolve,
  handleTicketResume,
  handleTicketStart,
  handleTicketWait,
} from "./commands/tickets";
import type { SyncCommand, SyncCommandResult } from "./types";

const id = z.string().min(1);
const version = z.number().int().positive().optional();
const ticketReportSchema = z
  .object({
    locationId: id,
    issueOptionId: id.optional(),
    categoryId: id.optional(),
    title: z.string().optional(),
    description: z.string().max(4000).optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    blocksRoom: z.boolean().optional(),
    allowDuplicate: z.boolean().optional(),
    duplicateOverrideReason: z.string().max(1000).optional(),
    confirmSimilar: z.boolean().optional(),
  })
  .refine(
    (data) =>
      (Boolean(data.issueOptionId) && !data.categoryId) ||
      (!data.issueOptionId && Boolean(data.categoryId)),
    { message: "Provide exactly one of issueOptionId or categoryId" },
  );

const payloadSchemas: Record<string, z.ZodTypeAny> = {
  "cleaning.start": z.object({ taskId: id, expectedVersion: version }),
  "cleaning.complete": z.object({
    sessionId: id,
    expectedVersion: version,
    notes: z.string().optional(),
  }),
  "ticket.report": ticketReportSchema,
  "ticket.start": z.object({ ticketId: id }),
  "ticket.wait": z.object({ ticketId: id, reason: z.string().optional() }),
  "ticket.resume": z.object({ ticketId: id }),
  "ticket.resolve": z.object({
    ticketId: id,
    resolutionNotes: z.string().optional(),
  }),
  "ticket.assign": z.object({ ticketId: id, assigneeId: id }),
  "ticket.close": z.object({ ticketId: id }),
  "ticket.reopen": z.object({ ticketId: id, reason: z.string().optional() }),
};

/** Prisma codes that usually mean the database is temporarily unavailable. */
const TRANSIENT_PRISMA_CODES = new Set([
  "P1001",
  "P1002",
  "P1008",
  "P1017",
  "P2024",
  "P2034", // write conflict / deadlock — safe to retry with same commandId
]);

/** Prisma codes that will not succeed on blind retry of the same payload. */
const PERMANENT_PRISMA_CODES = new Set([
  "P2002", // unique constraint (unhandled by domain idempotency)
  "P2003", // foreign key
  "P2004", // database constraint
  "P2011", // null constraint
  "P2012", // missing required value
  "P2014", // required relation violation
  "P2025", // record not found
]);

/**
 * Resolve the user's data scope once, then hand off to a typed handler.
 * Handlers may further remap access-loss 403s to conflict (see conflicts.ts).
 */
export async function applyCommand(
  user: AuthUser,
  cmd: SyncCommand,
): Promise<SyncCommandResult> {
  try {
    const schema = Object.hasOwn(payloadSchemas, cmd.type)
      ? payloadSchemas[cmd.type]
      : undefined;
    if (schema && !schema.safeParse(cmd.payload).success) {
      return {
        commandId: cmd.commandId,
        status: "error",
        code: "validation",
        message: "Invalid command payload",
        retryable: false,
      };
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
      case "ticket.assign":
        return await handleTicketAssign(user, scope, cmd);
      case "ticket.close":
        return await handleTicketClose(user, scope, cmd);
      case "ticket.reopen":
        return await handleTicketReopen(user, scope, cmd);
      default:
        // Forward-compat: unknown types fail soft so the batch can continue.
        return {
          commandId: cmd.commandId,
          status: "error",
          message: `Unknown command type ${cmd.type}`,
          retryable: false,
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
          code: err.code,
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
        code: err.code,
        retryable: err.status === 408 || err.status === 429 || err.status >= 500,
      };
    }

    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        service: "maintenance-api",
        event: "sync_command_failed",
        commandId: cmd.commandId,
        type: cmd.type,
        error: safeErrorMessage(err),
      }),
    );

    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (
        TRANSIENT_PRISMA_CODES.has(err.code) ||
        !PERMANENT_PRISMA_CODES.has(err.code)
      ) {
        return {
          commandId: cmd.commandId,
          status: "error",
          message: "Temporary command failure",
          code: err.code,
          retryable: true,
        };
      }
      // Unique / FK / data conflicts after domain handlers are permanent for the client.
      return {
        commandId: cmd.commandId,
        status: "error",
        message:
          err.code === "P2003" || err.code === "P2025"
            ? "Referenced record was not found"
            : "Command could not be applied",
        code: err.code,
        retryable: false,
      };
    }

    if (
      err instanceof Prisma.PrismaClientInitializationError ||
      err instanceof Prisma.PrismaClientRustPanicError ||
      err instanceof Prisma.PrismaClientUnknownRequestError
    ) {
      return {
        commandId: cmd.commandId,
        status: "error",
        message: "Temporary command failure",
        retryable: true,
      };
    }

    // Unexpected throws become opaque error results (batch continues).
    return {
      commandId: cmd.commandId,
      status: "error",
      message: "Temporary command failure",
      retryable: true,
    };
  }
}
