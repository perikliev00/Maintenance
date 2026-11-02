/**
 * Shared Zod schemas and ticket mutation helpers for maintenance controllers.
 */
import type { Request, Response } from "express";
import type { ZodTypeAny } from "zod/v3";
import { canBypassTicketAssignee } from "../../services/maintenance";
import {
  assertCanAccessTicket,
  resolveDataScope,
} from "../../services/dataScope";

export {
  maintenanceTicketCreateHttpSchema,
  maintenanceTicketPrioritySchema as prioritySchema,
  maintenanceTicketReportSchema,
} from "../../services/maintenance/validation/ticketReportSchema";

type TicketScopedMutationOpts<TSchema extends ZodTypeAny> = {
  schema: TSchema;
  /** When true, pass canBypassTicketAssignee(role) into `run`. */
  withAssigneeBypass?: boolean;
  run: (input: {
    req: Request;
    data: TSchema["_output"];
    bypassAssigneeCheck: boolean;
  }) => Promise<unknown>;
};

/**
 * Validate body → resolve scope → assert ticket access → run service → JSON.
 */
export async function ticketScopedMutation<TSchema extends ZodTypeAny>(
  req: Request,
  res: Response,
  opts: TicketScopedMutationOpts<TSchema>,
) {
  const parsed = opts.schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "validation", details: parsed.error.flatten() });
  }
  const scope = await resolveDataScope(req.user!);
  await assertCanAccessTicket(scope, req.params.id);
  const bypassAssigneeCheck = opts.withAssigneeBypass
    ? canBypassTicketAssignee(req.user!.role)
    : false;
  const ticket = await opts.run({
    req,
    data: parsed.data,
    bypassAssigneeCheck,
  });
  return res.json(ticket);
}
