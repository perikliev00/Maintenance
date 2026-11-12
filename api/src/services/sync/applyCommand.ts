/**
 * Dispatch one sync command by type and map AppError status to SyncCommandResult.
 * Zod-parses the payload once, then hands a typed command to the handler.
 * 403 → forbidden, 409 → conflict; unknown types → error.
 */
import { Prisma } from "@prisma/client";
import { AppError } from "../../errors";
import { safeErrorMessage } from "../../observability";
// Import type(s) AuthUser for typing without runtime cost.
import type { AuthUser } from "../../auth/tokens";
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
import {
  cleaningCompletePayloadSchema,
  cleaningStartPayloadSchema,
  syncCommandSchemas,
  ticketAssignPayloadSchema,
  ticketClosePayloadSchema,
  ticketReopenPayloadSchema,
  ticketResumePayloadSchema,
  ticketResolvePayloadSchema,
  ticketStartPayloadSchema,
  ticketWaitPayloadSchema,
  // Declare type ParsedSyncCommand for callers and internals.
  type ParsedSyncCommand,
} from "./commandSchemas";
import { maintenanceTicketReportSchema } from "../maintenance/validation/ticketReportSchema";
// Import type(s) SyncCommand, SyncCommandResult for typing without runtime cost.
import type { SyncCommand, SyncCommandResult } from "./types";

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

function isSyncCommandType(type: string): type is ParsedSyncCommand["type"] {
  return Object.hasOwn(syncCommandSchemas, type);
}

/**
 * Parse payload with the schema that matches `type`, rebuilding the
 * discriminated union without an uncorrelated cast.
 */
function buildParsedSyncCommand(
  commandId: string,
  type: ParsedSyncCommand["type"],
  payload: unknown,
  clientTime: string | undefined,
): ParsedSyncCommand | null {
  // Dispatch on the discriminant to pick the matching case.
  switch (type) {
    // Handle this specific case value.
    case "cleaning.start": {
      const parsed = cleaningStartPayloadSchema.safeParse(payload);
      return parsed.success
        // Complete the ternary or optional chain started above.
        ? { commandId, type, payload: parsed.data, clientTime }
        // Complete the ternary or optional chain started above.
        : null;
    }
    // Handle this specific case value.
    case "cleaning.complete": {
      const parsed = cleaningCompletePayloadSchema.safeParse(payload);
      return parsed.success
        // Complete the ternary or optional chain started above.
        ? { commandId, type, payload: parsed.data, clientTime }
        // Complete the ternary or optional chain started above.
        : null;
    }
    // Handle this specific case value.
    case "ticket.report": {
      const parsed = maintenanceTicketReportSchema.safeParse(payload);
      return parsed.success
        // Complete the ternary or optional chain started above.
        ? { commandId, type, payload: parsed.data, clientTime }
        // Complete the ternary or optional chain started above.
        : null;
    }
    // Handle this specific case value.
    case "ticket.start": {
      const parsed = ticketStartPayloadSchema.safeParse(payload);
      return parsed.success
        // Complete the ternary or optional chain started above.
        ? { commandId, type, payload: parsed.data, clientTime }
        // Complete the ternary or optional chain started above.
        : null;
    }
    // Handle this specific case value.
    case "ticket.wait": {
      const parsed = ticketWaitPayloadSchema.safeParse(payload);
      return parsed.success
        // Complete the ternary or optional chain started above.
        ? { commandId, type, payload: parsed.data, clientTime }
        // Complete the ternary or optional chain started above.
        : null;
    }
    // Handle this specific case value.
    case "ticket.resume": {
      const parsed = ticketResumePayloadSchema.safeParse(payload);
      return parsed.success
        // Complete the ternary or optional chain started above.
        ? { commandId, type, payload: parsed.data, clientTime }
        // Complete the ternary or optional chain started above.
        : null;
    }
    // Handle this specific case value.
    case "ticket.resolve": {
      const parsed = ticketResolvePayloadSchema.safeParse(payload);
      return parsed.success
        // Complete the ternary or optional chain started above.
        ? { commandId, type, payload: parsed.data, clientTime }
        // Complete the ternary or optional chain started above.
        : null;
    }
    // Handle this specific case value.
    case "ticket.assign": {
      const parsed = ticketAssignPayloadSchema.safeParse(payload);
      return parsed.success
        // Complete the ternary or optional chain started above.
        ? { commandId, type, payload: parsed.data, clientTime }
        // Complete the ternary or optional chain started above.
        : null;
    }
    // Handle this specific case value.
    case "ticket.close": {
      const parsed = ticketClosePayloadSchema.safeParse(payload);
      return parsed.success
        // Complete the ternary or optional chain started above.
        ? { commandId, type, payload: parsed.data, clientTime }
        // Complete the ternary or optional chain started above.
        : null;
    }
    // Handle this specific case value.
    case "ticket.reopen": {
      const parsed = ticketReopenPayloadSchema.safeParse(payload);
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
      void _exhaustive;
      return null;
    }
  }
}

function parseSyncCommand(
  cmd: SyncCommand,
):
  | { ok: true; parsed: ParsedSyncCommand }
  | { ok: false; result: SyncCommandResult } {
  if (!isSyncCommandType(cmd.type)) {
    return {
      ok: false,
      result: {
        commandId: cmd.commandId,
        status: "error",
        message: `Unknown command type ${cmd.type}`,
        retryable: false,
      },
    };
  }
  const parsed = buildParsedSyncCommand(
    cmd.commandId,
    cmd.type,
    cmd.payload,
    cmd.clientTime,
  );
  if (!parsed) {
    return {
      ok: false,
      result: {
        commandId: cmd.commandId,
        status: "error",
        code: "validation",
        message: "Invalid command payload",
        retryable: false,
      },
    };
  }
  return { ok: true, parsed };
}

async function dispatchParsed(
  user: AuthUser,
  scope: Awaited<ReturnType<typeof resolveDataScope>>,
  cmd: ParsedSyncCommand,
): Promise<SyncCommandResult> {
  // Dispatch on the discriminant to pick the matching case.
  switch (cmd.type) {
    // Handle this specific case value.
    case "cleaning.start":
      return await handleCleaningStart(user, scope, cmd);
    // Handle this specific case value.
    case "cleaning.complete":
      return await handleCleaningComplete(user, scope, cmd);
    // Handle this specific case value.
    case "ticket.report":
      return await handleTicketReport(user, scope, cmd);
    // Handle this specific case value.
    case "ticket.start":
      return await handleTicketStart(user, scope, cmd);
    // Handle this specific case value.
    case "ticket.wait":
      return await handleTicketWait(user, scope, cmd);
    // Handle this specific case value.
    case "ticket.resume":
      return await handleTicketResume(user, scope, cmd);
    // Handle this specific case value.
    case "ticket.resolve":
      return await handleTicketResolve(user, scope, cmd);
    // Handle this specific case value.
    case "ticket.assign":
      return await handleTicketAssign(user, scope, cmd);
    // Handle this specific case value.
    case "ticket.close":
      return await handleTicketClose(user, scope, cmd);
    // Handle this specific case value.
    case "ticket.reopen":
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
  user: AuthUser,
  cmd: SyncCommand,
): Promise<SyncCommandResult> {
  try {
    const parsed = parseSyncCommand(cmd);
    if (!parsed.ok) return parsed.result;

    const scope = await resolveDataScope(user);
    return await dispatchParsed(user, scope, parsed.parsed);
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
      return {
        commandId: cmd.commandId,
        status: "error",
        message:
          err.code === "P2003" || err.code === "P2025"
            // Complete the ternary or optional chain started above.
            ? "Referenced record was not found"
            // Complete the ternary or optional chain started above.
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

    return {
      commandId: cmd.commandId,
      status: "error",
      message: "Temporary command failure",
      retryable: true,
    };
  }
}
