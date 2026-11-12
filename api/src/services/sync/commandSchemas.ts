/**
 * Zod schemas + inferred payload types for offline sync commands.
 * applyCommand parses once and passes typed payloads to handlers.
 */
import { z } from "zod/v3";
// Import module ../maintenance/validation/ticketReportSchema for this service.
import { maintenanceTicketReportSchema } from "../maintenance/validation/ticketReportSchema";

// Capture id for use in this scope.
const id = z.string().min(1);
// Capture version for use in this scope.
const version = z.number().int().positive().optional();

// Export cleaningStartPayloadSchema for reuse by other modules.
export const cleaningStartPayloadSchema = z.object({
  // Set taskId on the structure being built.
  taskId: id,
  // Set expectedVersion on the structure being built.
  expectedVersion: version,
});
// Export cleaningCompletePayloadSchema for reuse by other modules.
export const cleaningCompletePayloadSchema = z.object({
  // Set sessionId on the structure being built.
  sessionId: id,
  // Set expectedVersion on the structure being built.
  expectedVersion: version,
  // Set notes on the structure being built.
  notes: z.string().optional(),
});
// Export ticketStartPayloadSchema for reuse by other modules.
export const ticketStartPayloadSchema = z.object({ ticketId: id });
// Export ticketWaitPayloadSchema for reuse by other modules.
export const ticketWaitPayloadSchema = z.object({
  // Set ticketId on the structure being built.
  ticketId: id,
  // Set reason on the structure being built.
  reason: z.string().optional(),
});
// Export ticketResumePayloadSchema for reuse by other modules.
export const ticketResumePayloadSchema = z.object({ ticketId: id });
// Export ticketResolvePayloadSchema for reuse by other modules.
export const ticketResolvePayloadSchema = z.object({
  // Set ticketId on the structure being built.
  ticketId: id,
  // Set resolutionNotes on the structure being built.
  resolutionNotes: z.string().optional(),
});
// Export ticketAssignPayloadSchema for reuse by other modules.
export const ticketAssignPayloadSchema = z.object({
  // Set ticketId on the structure being built.
  ticketId: id,
  // Set assigneeId on the structure being built.
  assigneeId: id,
});
// Export ticketClosePayloadSchema for reuse by other modules.
export const ticketClosePayloadSchema = z.object({ ticketId: id });
// Export ticketReopenPayloadSchema for reuse by other modules.
export const ticketReopenPayloadSchema = z.object({
  // Set ticketId on the structure being built.
  ticketId: id,
  // Set reason on the structure being built.
  reason: z.string().optional(),
});

// Declare type CleaningStartPayload for callers and internals.
export type CleaningStartPayload = z.infer<typeof cleaningStartPayloadSchema>;
// Declare type CleaningCompletePayload for callers and internals.
export type CleaningCompletePayload = z.infer<
  // Run next step: typeof cleaningCompletePayloadSchema
  typeof cleaningCompletePayloadSchema
// Run next step: >;
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
  // Run next step: | {
  | {
      // Set commandId on the structure being built.
      commandId: string;
      // Set type on the structure being built.
      type: "cleaning.start";
      // Set payload on the structure being built.
      payload: CleaningStartPayload;
      // Run next step: clientTime?: string;
      clientTime?: string;
    }
  // Run next step: | {
  | {
      // Set commandId on the structure being built.
      commandId: string;
      // Set type on the structure being built.
      type: "cleaning.complete";
      // Set payload on the structure being built.
      payload: CleaningCompletePayload;
      // Run next step: clientTime?: string;
      clientTime?: string;
    }
  // Run next step: | {
  | {
      // Set commandId on the structure being built.
      commandId: string;
      // Set type on the structure being built.
      type: "ticket.report";
      // Set payload on the structure being built.
      payload: TicketReportPayload;
      // Run next step: clientTime?: string;
      clientTime?: string;
    }
  // Run next step: | {
  | {
      // Set commandId on the structure being built.
      commandId: string;
      // Set type on the structure being built.
      type: "ticket.start";
      // Set payload on the structure being built.
      payload: TicketStartPayload;
      // Run next step: clientTime?: string;
      clientTime?: string;
    }
  // Run next step: | {
  | {
      // Set commandId on the structure being built.
      commandId: string;
      // Set type on the structure being built.
      type: "ticket.wait";
      // Set payload on the structure being built.
      payload: TicketWaitPayload;
      // Run next step: clientTime?: string;
      clientTime?: string;
    }
  // Run next step: | {
  | {
      // Set commandId on the structure being built.
      commandId: string;
      // Set type on the structure being built.
      type: "ticket.resume";
      // Set payload on the structure being built.
      payload: TicketResumePayload;
      // Run next step: clientTime?: string;
      clientTime?: string;
    }
  // Run next step: | {
  | {
      // Set commandId on the structure being built.
      commandId: string;
      // Set type on the structure being built.
      type: "ticket.resolve";
      // Set payload on the structure being built.
      payload: TicketResolvePayload;
      // Run next step: clientTime?: string;
      clientTime?: string;
    }
  // Run next step: | {
  | {
      // Set commandId on the structure being built.
      commandId: string;
      // Set type on the structure being built.
      type: "ticket.assign";
      // Set payload on the structure being built.
      payload: TicketAssignPayload;
      // Run next step: clientTime?: string;
      clientTime?: string;
    }
  // Run next step: | {
  | {
      // Set commandId on the structure being built.
      commandId: string;
      // Set type on the structure being built.
      type: "ticket.close";
      // Set payload on the structure being built.
      payload: TicketClosePayload;
      // Run next step: clientTime?: string;
      clientTime?: string;
    }
  // Run next step: | {
  | {
      // Set commandId on the structure being built.
      commandId: string;
      // Set type on the structure being built.
      type: "ticket.reopen";
      // Set payload on the structure being built.
      payload: TicketReopenPayload;
      // Run next step: clientTime?: string;
      clientTime?: string;
    };

// Declare type SchemaEntry for callers and internals.
type SchemaEntry<T extends ParsedSyncCommand["type"]> = {
  // Set type on the structure being built.
  type: T;
  // Set schema on the structure being built.
  schema: z.ZodType<Extract<ParsedSyncCommand, { type: T }>["payload"]>;
};

/** Registry used by applyCommand for validation + typed dispatch. */
export const syncCommandSchemas: {
  // Run next step: [K in ParsedSyncCommand["type"]]: SchemaEntry<K>;
  [K in ParsedSyncCommand["type"]]: SchemaEntry<K>;
// Run next step: } = {
} = {
  // Run next step: "cleaning.start": {
  "cleaning.start": {
    // Set type on the structure being built.
    type: "cleaning.start",
    // Set schema on the structure being built.
    schema: cleaningStartPayloadSchema,
  },
  // Run next step: "cleaning.complete": {
  "cleaning.complete": {
    // Set type on the structure being built.
    type: "cleaning.complete",
    // Set schema on the structure being built.
    schema: cleaningCompletePayloadSchema,
  },
  // Run next step: "ticket.report": {
  "ticket.report": {
    // Set type on the structure being built.
    type: "ticket.report",
    // Set schema on the structure being built.
    schema: maintenanceTicketReportSchema,
  },
  // Run next step: "ticket.start": { type: "ticket.start", schema: ticketStartP…
  "ticket.start": { type: "ticket.start", schema: ticketStartPayloadSchema },
  // Run next step: "ticket.wait": { type: "ticket.wait", schema: ticketWaitPayl…
  "ticket.wait": { type: "ticket.wait", schema: ticketWaitPayloadSchema },
  // Run next step: "ticket.resume": { type: "ticket.resume", schema: ticketResu…
  "ticket.resume": { type: "ticket.resume", schema: ticketResumePayloadSchema },
  // Run next step: "ticket.resolve": {
  "ticket.resolve": {
    // Set type on the structure being built.
    type: "ticket.resolve",
    // Set schema on the structure being built.
    schema: ticketResolvePayloadSchema,
  },
  // Run next step: "ticket.assign": { type: "ticket.assign", schema: ticketAssi…
  "ticket.assign": { type: "ticket.assign", schema: ticketAssignPayloadSchema },
  // Run next step: "ticket.close": { type: "ticket.close", schema: ticketCloseP…
  "ticket.close": { type: "ticket.close", schema: ticketClosePayloadSchema },
  // Run next step: "ticket.reopen": { type: "ticket.reopen", schema: ticketReop…
  "ticket.reopen": { type: "ticket.reopen", schema: ticketReopenPayloadSchema },
};
