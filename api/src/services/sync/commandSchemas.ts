/**
 * Zod schemas + inferred payload types for offline sync commands.
 * applyCommand parses once and passes typed payloads to handlers.
 */
import { z } from "zod/v3";
import { maintenanceTicketReportSchema } from "../maintenance/validation/ticketReportSchema";

const id = z.string().min(1);
const version = z.number().int().positive().optional();

// Export cleaningStartPayloadSchema for reuse by other modules.
export const cleaningStartPayloadSchema = z.object({
  taskId: id,
  expectedVersion: version,
});
// Export cleaningCompletePayloadSchema for reuse by other modules.
export const cleaningCompletePayloadSchema = z.object({
  sessionId: id,
  expectedVersion: version,
  notes: z.string().optional(),
});
// Export ticketStartPayloadSchema for reuse by other modules.
export const ticketStartPayloadSchema = z.object({ ticketId: id });
// Export ticketWaitPayloadSchema for reuse by other modules.
export const ticketWaitPayloadSchema = z.object({
  ticketId: id,
  reason: z.string().optional(),
});
// Export ticketResumePayloadSchema for reuse by other modules.
export const ticketResumePayloadSchema = z.object({ ticketId: id });
// Export ticketResolvePayloadSchema for reuse by other modules.
export const ticketResolvePayloadSchema = z.object({
  ticketId: id,
  resolutionNotes: z.string().optional(),
});
// Export ticketAssignPayloadSchema for reuse by other modules.
export const ticketAssignPayloadSchema = z.object({
  ticketId: id,
  assigneeId: id,
});
// Export ticketClosePayloadSchema for reuse by other modules.
export const ticketClosePayloadSchema = z.object({ ticketId: id });
// Export ticketReopenPayloadSchema for reuse by other modules.
export const ticketReopenPayloadSchema = z.object({
  ticketId: id,
  reason: z.string().optional(),
});

// Declare type CleaningStartPayload for callers and internals.
export type CleaningStartPayload = z.infer<typeof cleaningStartPayloadSchema>;
// Declare type CleaningCompletePayload for callers and internals.
export type CleaningCompletePayload = z.infer<
  typeof cleaningCompletePayloadSchema
>;
// Declare type TicketReportPayload for callers and internals.
export type TicketReportPayload = z.infer<typeof maintenanceTicketReportSchema>;
// Declare type TicketStartPayload for callers and internals.
export type TicketStartPayload = z.infer<typeof ticketStartPayloadSchema>;
// Declare type TicketWaitPayload for callers and internals.
export type TicketWaitPayload = z.infer<typeof ticketWaitPayloadSchema>;
// Declare type TicketResumePayload for callers and internals.
export type TicketResumePayload = z.infer<typeof ticketResumePayloadSchema>;
// Declare type TicketResolvePayload for callers and internals.
export type TicketResolvePayload = z.infer<typeof ticketResolvePayloadSchema>;
// Declare type TicketAssignPayload for callers and internals.
export type TicketAssignPayload = z.infer<typeof ticketAssignPayloadSchema>;
// Declare type TicketClosePayload for callers and internals.
export type TicketClosePayload = z.infer<typeof ticketClosePayloadSchema>;
// Declare type TicketReopenPayload for callers and internals.
export type TicketReopenPayload = z.infer<typeof ticketReopenPayloadSchema>;

/** Known sync command types with parsed payloads. */
export type ParsedSyncCommand =
  | {
      commandId: string;
      type: "cleaning.start";
      payload: CleaningStartPayload;
      clientTime?: string;
    }
  | {
      commandId: string;
      type: "cleaning.complete";
      payload: CleaningCompletePayload;
      clientTime?: string;
    }
  | {
      commandId: string;
      type: "ticket.report";
      payload: TicketReportPayload;
      clientTime?: string;
    }
  | {
      commandId: string;
      type: "ticket.start";
      payload: TicketStartPayload;
      clientTime?: string;
    }
  | {
      commandId: string;
      type: "ticket.wait";
      payload: TicketWaitPayload;
      clientTime?: string;
    }
  | {
      commandId: string;
      type: "ticket.resume";
      payload: TicketResumePayload;
      clientTime?: string;
    }
  | {
      commandId: string;
      type: "ticket.resolve";
      payload: TicketResolvePayload;
      clientTime?: string;
    }
  | {
      commandId: string;
      type: "ticket.assign";
      payload: TicketAssignPayload;
      clientTime?: string;
    }
  | {
      commandId: string;
      type: "ticket.close";
      payload: TicketClosePayload;
      clientTime?: string;
    }
  | {
      commandId: string;
      type: "ticket.reopen";
      payload: TicketReopenPayload;
      clientTime?: string;
    };

// Declare type SchemaEntry for callers and internals.
type SchemaEntry<T extends ParsedSyncCommand["type"]> = {
  type: T;
  schema: z.ZodType<Extract<ParsedSyncCommand, { type: T }>["payload"]>;
};

/** Registry used by applyCommand for validation + typed dispatch. */
export const syncCommandSchemas: {
  [K in ParsedSyncCommand["type"]]: SchemaEntry<K>;
} = {
  "cleaning.start": {
    type: "cleaning.start",
    schema: cleaningStartPayloadSchema,
  },
  "cleaning.complete": {
    type: "cleaning.complete",
    schema: cleaningCompletePayloadSchema,
  },
  "ticket.report": {
    type: "ticket.report",
    schema: maintenanceTicketReportSchema,
  },
  "ticket.start": { type: "ticket.start", schema: ticketStartPayloadSchema },
  "ticket.wait": { type: "ticket.wait", schema: ticketWaitPayloadSchema },
  "ticket.resume": { type: "ticket.resume", schema: ticketResumePayloadSchema },
  "ticket.resolve": {
    type: "ticket.resolve",
    schema: ticketResolvePayloadSchema,
  },
  "ticket.assign": { type: "ticket.assign", schema: ticketAssignPayloadSchema },
  "ticket.close": { type: "ticket.close", schema: ticketClosePayloadSchema },
  "ticket.reopen": { type: "ticket.reopen", schema: ticketReopenPayloadSchema },
};
