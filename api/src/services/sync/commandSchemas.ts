/**
 * Zod schemas + inferred payload types for offline sync commands.
 * applyCommand parses once and passes typed payloads to handlers.
 */
import { z } from "zod/v3";
import { maintenanceTicketReportSchema } from "../maintenance/validation/ticketReportSchema";

const id = z.string().min(1);
const version = z.number().int().positive().optional();

export const cleaningStartPayloadSchema = z.object({
  taskId: id,
  expectedVersion: version,
});
export const cleaningCompletePayloadSchema = z.object({
  sessionId: id,
  expectedVersion: version,
  notes: z.string().optional(),
});
export const ticketStartPayloadSchema = z.object({ ticketId: id });
export const ticketWaitPayloadSchema = z.object({
  ticketId: id,
  reason: z.string().optional(),
});
export const ticketResumePayloadSchema = z.object({ ticketId: id });
export const ticketResolvePayloadSchema = z.object({
  ticketId: id,
  resolutionNotes: z.string().optional(),
});
export const ticketAssignPayloadSchema = z.object({
  ticketId: id,
  assigneeId: id,
});
export const ticketClosePayloadSchema = z.object({ ticketId: id });
export const ticketReopenPayloadSchema = z.object({
  ticketId: id,
  reason: z.string().optional(),
});

export type CleaningStartPayload = z.infer<typeof cleaningStartPayloadSchema>;
export type CleaningCompletePayload = z.infer<
  typeof cleaningCompletePayloadSchema
>;
export type TicketReportPayload = z.infer<typeof maintenanceTicketReportSchema>;
export type TicketStartPayload = z.infer<typeof ticketStartPayloadSchema>;
export type TicketWaitPayload = z.infer<typeof ticketWaitPayloadSchema>;
export type TicketResumePayload = z.infer<typeof ticketResumePayloadSchema>;
export type TicketResolvePayload = z.infer<typeof ticketResolvePayloadSchema>;
export type TicketAssignPayload = z.infer<typeof ticketAssignPayloadSchema>;
export type TicketClosePayload = z.infer<typeof ticketClosePayloadSchema>;
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
