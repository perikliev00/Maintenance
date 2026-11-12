/**
 * Dispatch one sync command by type and map AppError status to SyncCommandResult.
 * Zod-parses the payload once, then hands a typed command to the handler.
 * 403 → forbidden, 409 → conflict; unknown types → error.
 */
import { Prisma } from "@prisma/client";
// Import module ../../errors for this service.
import { AppError } from "../../errors";
// Import module ../../observability for this service.
import { safeErrorMessage } from "../../observability";
// Import type(s) AuthUser for typing without runtime cost.
import type { AuthUser } from "../../auth/tokens";
// Import module ../dataScope for this service.
import { resolveDataScope } from "../dataScope";
// Import module dependency for this service.
import {
  // Run next step: handleCleaningComplete,
  handleCleaningComplete,
  // Run next step: handleCleaningStart,
  handleCleaningStart,
// Run next step: } from "./commands/cleaning";
} from "./commands/cleaning";
// Import module dependency for this service.
import {
  // Run next step: handleTicketAssign,
  handleTicketAssign,
  // Run next step: handleTicketClose,
  handleTicketClose,
  // Run next step: handleTicketReport,
  handleTicketReport,
  // Run next step: handleTicketReopen,
  handleTicketReopen,
  // Run next step: handleTicketResolve,
  handleTicketResolve,
  // Run next step: handleTicketResume,
  handleTicketResume,
  // Run next step: handleTicketStart,
  handleTicketStart,
  // Run next step: handleTicketWait,
  handleTicketWait,
// Run next step: } from "./commands/tickets";
} from "./commands/tickets";
// Import module dependency for this service.
import {
  // Run next step: cleaningCompletePayloadSchema,
  cleaningCompletePayloadSchema,
  // Run next step: cleaningStartPayloadSchema,
  cleaningStartPayloadSchema,
  // Run next step: syncCommandSchemas,
  syncCommandSchemas,
  // Run next step: ticketAssignPayloadSchema,
  ticketAssignPayloadSchema,
  // Run next step: ticketClosePayloadSchema,
  ticketClosePayloadSchema,
  // Run next step: ticketReopenPayloadSchema,
  ticketReopenPayloadSchema,
  // Run next step: ticketResumePayloadSchema,
  ticketResumePayloadSchema,
  // Run next step: ticketResolvePayloadSchema,
  ticketResolvePayloadSchema,
  // Run next step: ticketStartPayloadSchema,
  ticketStartPayloadSchema,
  // Run next step: ticketWaitPayloadSchema,
  ticketWaitPayloadSchema,
  // Declare type ParsedSyncCommand for callers and internals.
  type ParsedSyncCommand,
// Run next step: } from "./commandSchemas";
} from "./commandSchemas";
// Import module ../maintenance/validation/ticketReportSchema for this service.
import { maintenanceTicketReportSchema } from "../maintenance/validation/ticketReportSchema";
// Import type(s) SyncCommand, SyncCommandResult for typing without runtime cost.
import type { SyncCommand, SyncCommandResult } from "./types";

/** Prisma codes that usually mean the database is temporarily unavailable. */
const TRANSIENT_PRISMA_CODES = new Set([
  // Run next step: "P1001",
  "P1001",
  // Run next step: "P1002",
  "P1002",
  // Run next step: "P1008",
  "P1008",
  // Run next step: "P1017",
  "P1017",
  // Run next step: "P2024",
  "P2024",
  // Run next step: "P2034", // write conflict / deadlock — safe to retry with s…
  "P2034", // write conflict / deadlock — safe to retry with same commandId
]);

/** Prisma codes that will not succeed on blind retry of the same payload. */
const PERMANENT_PRISMA_CODES = new Set([
  // Run next step: "P2002", // unique constraint (unhandled by domain idempoten…
  "P2002", // unique constraint (unhandled by domain idempotency)
  // Run next step: "P2003", // foreign key
  "P2003", // foreign key
  // Run next step: "P2004", // database constraint
  "P2004", // database constraint
  // Run next step: "P2011", // null constraint
  "P2011", // null constraint
  // Run next step: "P2012", // missing required value
  "P2012", // missing required value
  // Run next step: "P2014", // required relation violation
  "P2014", // required relation violation
  // Run next step: "P2025", // record not found
  "P2025", // record not found
]);

// Define isSyncCommandType — core behavior for this module.
function isSyncCommandType(type: string): type is ParsedSyncCommand["type"] {
  // Return the computed result to the caller.
  return Object.hasOwn(syncCommandSchemas, type);
}

/**
 * Parse payload with the schema that matches `type`, rebuilding the
 * discriminated union without an uncorrelated cast.
 */
function buildParsedSyncCommand(
  // Set commandId on the structure being built.
  commandId: string,
  // Set type on the structure being built.
  type: ParsedSyncCommand["type"],
  // Set payload on the structure being built.
  payload: unknown,
  // Set clientTime on the structure being built.
  clientTime: string | undefined,
// Run next step: ): ParsedSyncCommand | null {
): ParsedSyncCommand | null {
  // Dispatch on the discriminant to pick the matching case.
  switch (type) {
    // Handle this specific case value.
    case "cleaning.start": {
      // Capture parsed for use in this scope.
      const parsed = cleaningStartPayloadSchema.safeParse(payload);
      // Return the computed result to the caller.
      return parsed.success
        // Complete the ternary or optional chain started above.
        ? { commandId, type, payload: parsed.data, clientTime }
        // Complete the ternary or optional chain started above.
        : null;
    }
    // Handle this specific case value.
    case "cleaning.complete": {
      // Capture parsed for use in this scope.
      const parsed = cleaningCompletePayloadSchema.safeParse(payload);
      // Return the computed result to the caller.
      return parsed.success
        // Complete the ternary or optional chain started above.
        ? { commandId, type, payload: parsed.data, clientTime }
        // Complete the ternary or optional chain started above.
        : null;
    }
    // Handle this specific case value.
    case "ticket.report": {
      // Capture parsed for use in this scope.
      const parsed = maintenanceTicketReportSchema.safeParse(payload);
      // Return the computed result to the caller.
      return parsed.success
        // Complete the ternary or optional chain started above.
        ? { commandId, type, payload: parsed.data, clientTime }
        // Complete the ternary or optional chain started above.
        : null;
    }
    // Handle this specific case value.
    case "ticket.start": {
      // Capture parsed for use in this scope.
      const parsed = ticketStartPayloadSchema.safeParse(payload);
      // Return the computed result to the caller.
      return parsed.success
        // Complete the ternary or optional chain started above.
        ? { commandId, type, payload: parsed.data, clientTime }
        // Complete the ternary or optional chain started above.
        : null;
    }
    // Handle this specific case value.
    case "ticket.wait": {
      // Capture parsed for use in this scope.
      const parsed = ticketWaitPayloadSchema.safeParse(payload);
      // Return the computed result to the caller.
      return parsed.success
        // Complete the ternary or optional chain started above.
        ? { commandId, type, payload: parsed.data, clientTime }
        // Complete the ternary or optional chain started above.
        : null;
    }
    // Handle this specific case value.
    case "ticket.resume": {
      // Capture parsed for use in this scope.
      const parsed = ticketResumePayloadSchema.safeParse(payload);
      // Return the computed result to the caller.
      return parsed.success
        // Complete the ternary or optional chain started above.
        ? { commandId, type, payload: parsed.data, clientTime }
        // Complete the ternary or optional chain started above.
        : null;
    }
    // Handle this specific case value.
    case "ticket.resolve": {
      // Capture parsed for use in this scope.
      const parsed = ticketResolvePayloadSchema.safeParse(payload);
      // Return the computed result to the caller.
      return parsed.success
        // Complete the ternary or optional chain started above.
        ? { commandId, type, payload: parsed.data, clientTime }
        // Complete the ternary or optional chain started above.
        : null;
    }
    // Handle this specific case value.
    case "ticket.assign": {
      // Capture parsed for use in this scope.
      const parsed = ticketAssignPayloadSchema.safeParse(payload);
      // Return the computed result to the caller.
      return parsed.success
        // Complete the ternary or optional chain started above.
        ? { commandId, type, payload: parsed.data, clientTime }
        // Complete the ternary or optional chain started above.
        : null;
    }
    // Handle this specific case value.
    case "ticket.close": {
      // Capture parsed for use in this scope.
      const parsed = ticketClosePayloadSchema.safeParse(payload);
      // Return the computed result to the caller.
      return parsed.success
        // Complete the ternary or optional chain started above.
        ? { commandId, type, payload: parsed.data, clientTime }
        // Complete the ternary or optional chain started above.
        : null;
    }
    // Handle this specific case value.
    case "ticket.reopen": {
      // Capture parsed for use in this scope.
      const parsed = ticketReopenPayloadSchema.safeParse(payload);
      // Return the computed result to the caller.
      return parsed.success
        // Complete the ternary or optional chain started above.
        ? { commandId, type, payload: parsed.data, clientTime }
        // Complete the ternary or optional chain started above.
        : null;
    }
    // Cover any unmatched case.
    default: {
      // Capture  exhaustive for use in this scope.
      const _exhaustive: never = type;
      // Run next step: void _exhaustive;
      void _exhaustive;
      // Return the computed result to the caller.
      return null;
    }
  }
}

// Define parseSyncCommand — core behavior for this module.
function parseSyncCommand(
  // Set cmd on the structure being built.
  cmd: SyncCommand,
// Run next step: ):
):
  // Run next step: | { ok: true; parsed: ParsedSyncCommand }
  | { ok: true; parsed: ParsedSyncCommand }
  // Run next step: | { ok: false; result: SyncCommandResult } {
  | { ok: false; result: SyncCommandResult } {
  // Branch when this condition holds so the right path runs.
  if (!isSyncCommandType(cmd.type)) {
    // Return the computed result to the caller.
    return {
      // Set ok on the structure being built.
      ok: false,
      // Set result on the structure being built.
      result: {
        // Set commandId on the structure being built.
        commandId: cmd.commandId,
        // Set status on the structure being built.
        status: "error",
        // Set message on the structure being built.
        message: `Unknown command type ${cmd.type}`,
        // Set retryable on the structure being built.
        retryable: false,
      },
    };
  }
  // Capture parsed for use in this scope.
  const parsed = buildParsedSyncCommand(
    // Run next step: cmd.commandId,
    cmd.commandId,
    // Run next step: cmd.type,
    cmd.type,
    // Run next step: cmd.payload,
    cmd.payload,
    // Run next step: cmd.clientTime,
    cmd.clientTime,
  );
  // Branch when this condition holds so the right path runs.
  if (!parsed) {
    // Return the computed result to the caller.
    return {
      // Set ok on the structure being built.
      ok: false,
      // Set result on the structure being built.
      result: {
        // Set commandId on the structure being built.
        commandId: cmd.commandId,
        // Set status on the structure being built.
        status: "error",
        // Set code on the structure being built.
        code: "validation",
        // Set message on the structure being built.
        message: "Invalid command payload",
        // Set retryable on the structure being built.
        retryable: false,
      },
    };
  }
  // Return the computed result to the caller.
  return { ok: true, parsed };
}

// Define dispatchParsed — core behavior for this module.
async function dispatchParsed(
  // Set user on the structure being built.
  user: AuthUser,
  // Set scope on the structure being built.
  scope: Awaited<ReturnType<typeof resolveDataScope>>,
  // Set cmd on the structure being built.
  cmd: ParsedSyncCommand,
// Run next step: ): Promise<SyncCommandResult> {
): Promise<SyncCommandResult> {
  // Dispatch on the discriminant to pick the matching case.
  switch (cmd.type) {
    // Handle this specific case value.
    case "cleaning.start":
      // Return the computed result to the caller.
      return await handleCleaningStart(user, scope, cmd);
    // Handle this specific case value.
    case "cleaning.complete":
      // Return the computed result to the caller.
      return await handleCleaningComplete(user, scope, cmd);
    // Handle this specific case value.
    case "ticket.report":
      // Return the computed result to the caller.
      return await handleTicketReport(user, scope, cmd);
    // Handle this specific case value.
    case "ticket.start":
      // Return the computed result to the caller.
      return await handleTicketStart(user, scope, cmd);
    // Handle this specific case value.
    case "ticket.wait":
      // Return the computed result to the caller.
      return await handleTicketWait(user, scope, cmd);
    // Handle this specific case value.
    case "ticket.resume":
      // Return the computed result to the caller.
      return await handleTicketResume(user, scope, cmd);
    // Handle this specific case value.
    case "ticket.resolve":
      // Return the computed result to the caller.
      return await handleTicketResolve(user, scope, cmd);
    // Handle this specific case value.
    case "ticket.assign":
      // Return the computed result to the caller.
      return await handleTicketAssign(user, scope, cmd);
    // Handle this specific case value.
    case "ticket.close":
      // Return the computed result to the caller.
      return await handleTicketClose(user, scope, cmd);
    // Handle this specific case value.
    case "ticket.reopen":
      // Return the computed result to the caller.
      return await handleTicketReopen(user, scope, cmd);
    // Cover any unmatched case.
    default: {
      // Capture  exhaustive for use in this scope.
      const _exhaustive: never = cmd;
      // Abort with an error so callers can react.
      throw new Error(`Unhandled sync command type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/**
 * Resolve the user's data scope once, then hand off to a typed handler.
 * Handlers may further remap access-loss 403s to conflict (see conflicts.ts).
 */
export async function applyCommand(
  // Set user on the structure being built.
  user: AuthUser,
  // Set cmd on the structure being built.
  cmd: SyncCommand,
// Run next step: ): Promise<SyncCommandResult> {
): Promise<SyncCommandResult> {
  // Attempt the fallible work so errors can be handled below.
  try {
    // Capture parsed for use in this scope.
    const parsed = parseSyncCommand(cmd);
    // Branch when this condition holds so the right path runs.
    if (!parsed.ok) return parsed.result;

    // Load scope asynchronously for the next steps.
    const scope = await resolveDataScope(user);
    // Return the computed result to the caller.
    return await dispatchParsed(user, scope, parsed.parsed);
  // Run next step: } catch (err) {
  } catch (err) {
    // Map AppError HTTP statuses into sync result statuses for the client.
    if (err instanceof AppError) {
      // Branch when this condition holds so the right path runs.
      if (err.status === 403) {
        // Return the computed result to the caller.
        return {
          // Set commandId on the structure being built.
          commandId: cmd.commandId,
          // Set status on the structure being built.
          status: "forbidden",
          // Set message on the structure being built.
          message: err.message,
          // Set code on the structure being built.
          code: err.code,
        };
      }
      // Branch when this condition holds so the right path runs.
      if (err.status === 409) {
        // Return the computed result to the caller.
        return {
          // Set commandId on the structure being built.
          commandId: cmd.commandId,
          // Set status on the structure being built.
          status: "conflict",
          // Set message on the structure being built.
          message: err.message,
          // Set code on the structure being built.
          code: err.code,
          // Set details on the structure being built.
          details: err.details,
        };
      }
      // Return the computed result to the caller.
      return {
        // Set commandId on the structure being built.
        commandId: cmd.commandId,
        // Set status on the structure being built.
        status: "error",
        // Set message on the structure being built.
        message: err.message,
        // Set code on the structure being built.
        code: err.code,
        // Set retryable on the structure being built.
        retryable: err.status === 408 || err.status === 429 || err.status >= 500,
      };
    }

    // Run next step: console.error(
    console.error(
      // Run next step: JSON.stringify({
      JSON.stringify({
        // Set timestamp on the structure being built.
        timestamp: new Date().toISOString(),
        // Set level on the structure being built.
        level: "error",
        // Set service on the structure being built.
        service: "maintenance-api",
        // Set event on the structure being built.
        event: "sync_command_failed",
        // Set commandId on the structure being built.
        commandId: cmd.commandId,
        // Set type on the structure being built.
        type: cmd.type,
        // Set error on the structure being built.
        error: safeErrorMessage(err),
      }),
    );

    // Branch when this condition holds so the right path runs.
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // Branch when this condition holds so the right path runs.
      if (
        // Run next step: TRANSIENT_PRISMA_CODES.has(err.code) ||
        TRANSIENT_PRISMA_CODES.has(err.code) ||
        // Run next step: !PERMANENT_PRISMA_CODES.has(err.code)
        !PERMANENT_PRISMA_CODES.has(err.code)
      // Run next step: ) {
      ) {
        // Return the computed result to the caller.
        return {
          // Set commandId on the structure being built.
          commandId: cmd.commandId,
          // Set status on the structure being built.
          status: "error",
          // Set message on the structure being built.
          message: "Temporary command failure",
          // Set code on the structure being built.
          code: err.code,
          // Set retryable on the structure being built.
          retryable: true,
        };
      }
      // Return the computed result to the caller.
      return {
        // Set commandId on the structure being built.
        commandId: cmd.commandId,
        // Set status on the structure being built.
        status: "error",
        // Set message on the structure being built.
        message:
          // Run next step: err.code === "P2003" || err.code === "P2025"
          err.code === "P2003" || err.code === "P2025"
            // Complete the ternary or optional chain started above.
            ? "Referenced record was not found"
            // Complete the ternary or optional chain started above.
            : "Command could not be applied",
        // Set code on the structure being built.
        code: err.code,
        // Set retryable on the structure being built.
        retryable: false,
      };
    }

    // Branch when this condition holds so the right path runs.
    if (
      // Run next step: err instanceof Prisma.PrismaClientInitializationError ||
      err instanceof Prisma.PrismaClientInitializationError ||
      // Run next step: err instanceof Prisma.PrismaClientRustPanicError ||
      err instanceof Prisma.PrismaClientRustPanicError ||
      // Run next step: err instanceof Prisma.PrismaClientUnknownRequestError
      err instanceof Prisma.PrismaClientUnknownRequestError
    // Run next step: ) {
    ) {
      // Return the computed result to the caller.
      return {
        // Set commandId on the structure being built.
        commandId: cmd.commandId,
        // Set status on the structure being built.
        status: "error",
        // Set message on the structure being built.
        message: "Temporary command failure",
        // Set retryable on the structure being built.
        retryable: true,
      };
    }

    // Return the computed result to the caller.
    return {
      // Set commandId on the structure being built.
      commandId: cmd.commandId,
      // Set status on the structure being built.
      status: "error",
      // Set message on the structure being built.
      message: "Temporary command failure",
      // Set retryable on the structure being built.
      retryable: true,
    };
  }
}
