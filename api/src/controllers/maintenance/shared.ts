/**
 * Shared Zod schemas and ticket mutation helpers for maintenance controllers.
 */
import type { Request, Response } from "express";
// Import type-only bindings from zod/v3.
import type { ZodTypeAny } from "zod/v3";
// Import local module ../../services/maintenance.
import { canBypassTicketAssignee } from "../../services/maintenance";
// Continue named import list.
import {
  // Bring assertCanAccessTicket into scope from the import.
  assertCanAccessTicket,
  // Bring resolveDataScope into scope from the import.
  resolveDataScope,
} from "../../services/dataScope";

// Re-export public symbols for consumers.
export {
  // Pass maintenanceTicketCreateHttpSchema through.
  maintenanceTicketCreateHttpSchema,
  // Continue the controller logic.
  maintenanceTicketPrioritySchema as prioritySchema,
  // Pass maintenanceTicketReportSchema through.
  maintenanceTicketReportSchema,
} from "../../services/maintenance/validation/ticketReportSchema";

// Continue the controller logic.
type TicketScopedMutationOpts<TSchema extends ZodTypeAny> = {
  // Provide schema for the object/call below.
  schema: TSchema;
  /** When true, pass canBypassTicketAssignee(role) into `run`. */
  withAssigneeBypass?: boolean;
  // Provide run for the object/call below.
  run: (input: {
    // Provide req for the object/call below.
    req: Request;
    // Provide data for the object/call below.
    data: TSchema["_output"];
    // Provide bypassAssigneeCheck for the object/call below.
    bypassAssigneeCheck: boolean;
  // Continue the controller logic.
  }) => Promise<unknown>;
};

/**
 * Validate body → resolve scope → assert ticket access → run service → JSON.
 */
export async function ticketScopedMutation<TSchema extends ZodTypeAny>(
  // Provide req for the object/call below.
  req: Request,
  // Provide res for the object/call below.
  res: Response,
  // Provide opts for the object/call below.
  opts: TicketScopedMutationOpts<TSchema>,
// Continue the controller logic.
) {
  // Parse and validate input against the schema.
  const parsed = opts.schema.safeParse(req.body ?? {});
  // Reject malformed input before any side effects.
  if (!parsed.success) {
    // Return value or early exit.
    return res
      // Set response status code.
      .status(400)
      // Attach JSON body to the response.
      .json({ error: "validation", details: parsed.error.flatten() });
  }
  // Resolve caller's DataScope for Prisma filtering.
  const scope = await resolveDataScope(req.user!);
  // Await side-effecting async work.
  await assertCanAccessTicket(scope, req.params.id);
  // Bind bypassAssigneeCheck for use in the handler below.
  const bypassAssigneeCheck = opts.withAssigneeBypass
    // Continue the conditional expression.
    ? canBypassTicketAssignee(req.user!.role)
    // Continue the conditional expression.
    : false;
  // Await async work into ticket.
  const ticket = await opts.run({
    // Pass req through.
    req,
    // Provide data for the object/call below.
    data: parsed.data,
    // Pass bypassAssigneeCheck through.
    bypassAssigneeCheck,
  });
  // JSON success response with the payload.
  return res.json(ticket);
}
