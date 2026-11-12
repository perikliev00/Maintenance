/**
 * Maintenance ticket list/create and workflow transitions (assign/start/wait/
 * resume/resolve/close/reopen). Create requires exactly one of issueOptionId or
 * categoryId; mutations assert ticket/location scope.
 */
import type { Request, Response } from "express";
import { Priority } from "@prisma/client";
import { z } from "zod/v3";
// Continue named import list.
import {
  // Bring assignMaintenanceTicket into scope from the import.
  assignMaintenanceTicket,
  // Bring closeMaintenanceTicket into scope from the import.
  closeMaintenanceTicket,
  // Bring createMaintenanceTicket into scope from the import.
  createMaintenanceTicket,
  // Bring listMaintenanceTickets into scope from the import.
  listMaintenanceTickets,
  // Bring listTicketEvents into scope from the import.
  listTicketEvents,
  // Bring reopenMaintenanceTicket into scope from the import.
  reopenMaintenanceTicket,
  // Bring resolveMaintenanceTicket into scope from the import.
  resolveMaintenanceTicket,
  // Bring resumeMaintenanceTicket into scope from the import.
  resumeMaintenanceTicket,
  // Bring startMaintenanceTicket into scope from the import.
  startMaintenanceTicket,
  // Bring waitMaintenanceTicket into scope from the import.
  waitMaintenanceTicket,
} from "../../services/maintenance";
// Continue named import list.
import {
  // Bring assertCanAccessLocation into scope from the import.
  assertCanAccessLocation,
  // Bring assertCanAccessTicket into scope from the import.
  assertCanAccessTicket,
  // Bring resolveDataScope into scope from the import.
  resolveDataScope,
  // Bring ticketWhere into scope from the import.
  ticketWhere,
} from "../../services/dataScope";
// Import local module ./queryBool.
import { queryTriBool, queryTruthy } from "./queryBool";
// Continue named import list.
import {
  // Bring maintenanceTicketCreateHttpSchema into scope from the import.
  maintenanceTicketCreateHttpSchema,
  // Bring ticketScopedMutation into scope from the import.
  ticketScopedMutation,
} from "./shared";

/** GET /tickets — scoped list with status/assignee/SLA/blocksRoom filters. */
export async function list(req: Request, res: Response) {
  // Optional filters from query string.
  const locationId =
    // Narrow the runtime type before using the value.
    typeof req.query.locationId === "string" ? req.query.locationId : undefined;
  const statusParam =
    // Narrow the runtime type before using the value.
    typeof req.query.status === "string" ? req.query.status : "open";
  const assigneeIdParam =
    // Narrow the runtime type before using the value.
    typeof req.query.assigneeId === "string" ? req.query.assigneeId : undefined;
  const priorityParam =
    // Narrow the runtime type before using the value.
    typeof req.query.priority === "string" ? req.query.priority : undefined;
  const slaBreached = queryTruthy(req.query.slaBreached);
  // Tri-state blocksRoom filter (true / false / undefined).
  const blocksRoom = queryTriBool(req.query.blocksRoom);
  // status=resolved shortcut vs open-only default.
  const resolvedOnly = statusParam === "resolved";
  const openOnly =
    // Continue the controller logic.
    !resolvedOnly &&
    // Continue the controller logic.
    (req.query.open === "true" ||
      // Continue the controller logic.
      (req.query.open !== "false" &&
        // Continue the controller logic.
        statusParam !== "all" &&
        // Continue the controller logic.
        !statusParam.includes(",")));
  // Explicit status list (comma-separated or single known status).
  const statuses =
    // Continue the controller logic.
    statusParam.includes(",") ||
    // Continue the controller logic.
    ["new", "assigned", "in_progress", "waiting", "resolved", "closed"].includes(
      statusParam,
    )
      // Continue the conditional expression.
      ? (statusParam
          // Continue the fluent chain.
          .split(",")
          // Continue the fluent chain.
          .map((s) => s.trim())
          // Continue the fluent chain.
          .filter(Boolean) as import("@prisma/client").TicketStatus[])
      // Continue the conditional expression.
      : undefined;
  const mine = queryTruthy(req.query.mine);
  const limitRaw =
    // Narrow the runtime type before using the value.
    typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
  const limit =
    // Continue the controller logic.
    limitRaw !== undefined && Number.isFinite(limitRaw) && limitRaw > 0
      // Continue the conditional expression.
      ? Math.min(Math.floor(limitRaw), 100)
      // Continue the conditional expression.
      : undefined;
  const cursor =
    // Narrow the runtime type before using the value.
    typeof req.query.cursor === "string" && req.query.cursor.trim()
      // Continue the conditional expression.
      ? req.query.cursor.trim()
      // Continue the conditional expression.
      : undefined;
  // Opt-in envelope `{ items, nextCursor, total }` — default remains a bare array.
  const paginated = Boolean(cursor) || queryTruthy(req.query.paginated);

  // mine requires an authenticated employee id.
  if (mine && !req.user?.employeeId) {
    return res.status(401).json({ error: "unauthorized", message: "Missing user" });
  }

  // Build data-scope filter.
  const scope = await resolveDataScope(req.user!);
  const page = await listMaintenanceTickets({
    locationId,
    // mine overrides assigneeId to the caller's employee.
    assigneeId: mine ? req.user!.employeeId : assigneeIdParam,
    openOnly: statuses ? false : openOnly,
    resolvedOnly: statuses ? false : resolvedOnly,
    statuses:
      // Continue the controller logic.
      statuses && statusParam !== "open" && statusParam !== "all"
        // Continue the conditional expression.
        ? statuses
        // Continue the conditional expression.
        : undefined,
    priority: priorityParam as import("@prisma/client").Priority | undefined,
    slaBreached: slaBreached || undefined,
    blocksRoom,
    // History (status=all) includes archived-location tickets; open queues hide them.
    includeArchivedLocations: statusParam === "all",
    limit: paginated ? limit ?? 50 : limit,
    cursor,
    scopeWhere: ticketWhere(scope),
  });
  // Bare array keeps Home/Control/e2e consumers unchanged.
  if (!paginated) {
    // JSON success response with the payload.
    return res.json(page.items);
  }
  // JSON success response with the payload.
  return res.json({
    items: page.items,
    nextCursor: page.nextCursor,
    total: page.total,
  });
}

/** POST /tickets — report a ticket (issueOption XOR category+title). */
export async function create(req: Request, res: Response) {
  // Exactly one of issueOptionId or categoryId; title required for category path.
  // blocksRoom optional — catalog default applied server-side when omitted.
  const schema = maintenanceTicketCreateHttpSchema;
  // Parse and validate input.
  const parsed = schema.safeParse(req.body);
  // Reject invalid request payload.
  if (!parsed.success) {
    return res
      // Set response status code.
      .status(400)
      // Attach JSON body to the response.
      .json({ error: "validation", details: parsed.error.flatten() });
  }

  // Must be able to access the report location.
  const scope = await resolveDataScope(req.user!);
  // Assert access / permission.
  await assertCanAccessLocation(scope, parsed.data.locationId);

  // Capture service / command result.
  const result = await createMaintenanceTicket({
    // Continue the controller logic.
    ...parsed.data,
    priority: parsed.data.priority as Priority | undefined,
    reportedByEmployeeId: req.user!.employeeId,
  });

  // Idempotent replay via commandId returns 200.
  return res.status(result.idempotent ? 200 : 201).json(result.ticket);
}

/** GET /tickets/:id/events — ticket timeline after scope check. */
export async function listEvents(req: Request, res: Response) {
  // Build data-scope filter.
  const scope = await resolveDataScope(req.user!);
  // Assert access / permission.
  await assertCanAccessTicket(scope, req.params.id);
  const events = await listTicketEvents(req.params.id);
  // JSON success response.
  return res.json(events);
}

/** POST /tickets/:id/assign — assign to a technician. */
export async function assign(req: Request, res: Response) {
  // Return value or early exit.
  return ticketScopedMutation(req, res, {
    // Validate field schema.
    schema: z.object({
      // Validate field assigneeId.
      assigneeId: z.string().min(1),
      // Validate field commandId.
      commandId: z.string().uuid().optional(),
    }),
    // Continue the controller logic.
    run: ({ req: r, data }) =>
      // Continue the controller logic.
      assignMaintenanceTicket({
        ticketId: r.params.id,
        assigneeId: data.assigneeId,
        actorEmployeeId: r.user!.employeeId,
        commandId: data.commandId,
      }),
  });
}

/** POST /tickets/:id/start — start work (privileged roles may bypass assignee). */
export async function start(req: Request, res: Response) {
  // Return value or early exit.
  return ticketScopedMutation(req, res, {
    // Validate field schema.
    schema: z.object({ commandId: z.string().uuid().optional() }),
    withAssigneeBypass: true,
    // Continue the controller logic.
    run: ({ req: r, data, bypassAssigneeCheck }) =>
      // Continue the controller logic.
      startMaintenanceTicket({
        ticketId: r.params.id,
        actorEmployeeId: r.user!.employeeId,
        bypassAssigneeCheck,
        commandId: data.commandId,
      }),
  });
}

/** POST /tickets/:id/wait — pause / move to waiting (optional reason). */
export async function wait(req: Request, res: Response) {
  // Return value or early exit.
  return ticketScopedMutation(req, res, {
    // Validate field schema.
    schema: z.object({
      // Validate field reason.
      reason: z.string().optional(),
      // Validate field commandId.
      commandId: z.string().uuid().optional(),
    }),
    withAssigneeBypass: true,
    // Continue the controller logic.
    run: ({ req: r, data, bypassAssigneeCheck }) =>
      // Continue the controller logic.
      waitMaintenanceTicket({
        ticketId: r.params.id,
        actorEmployeeId: r.user!.employeeId,
        reason: data.reason,
        bypassAssigneeCheck,
        commandId: data.commandId,
      }),
  });
}

/** POST /tickets/:id/resume — resume from waiting. */
export async function resume(req: Request, res: Response) {
  // Return value or early exit.
  return ticketScopedMutation(req, res, {
    // Validate field schema.
    schema: z.object({ commandId: z.string().uuid().optional() }),
    withAssigneeBypass: true,
    // Continue the controller logic.
    run: ({ req: r, data, bypassAssigneeCheck }) =>
      // Continue the controller logic.
      resumeMaintenanceTicket({
        ticketId: r.params.id,
        actorEmployeeId: r.user!.employeeId,
        bypassAssigneeCheck,
        commandId: data.commandId,
      }),
  });
}

/** POST /tickets/:id/resolve — mark resolved with optional notes. */
export async function resolve(req: Request, res: Response) {
  // Return value or early exit.
  return ticketScopedMutation(req, res, {
    // Validate field schema.
    schema: z.object({
      // Validate field resolutionNotes.
      resolutionNotes: z.string().optional(),
      // Validate field commandId.
      commandId: z.string().uuid().optional(),
    }),
    withAssigneeBypass: true,
    // Continue the controller logic.
    run: ({ req: r, data, bypassAssigneeCheck }) =>
      // Continue the controller logic.
      resolveMaintenanceTicket({
        ticketId: r.params.id,
        resolvedByEmployeeId: r.user!.employeeId,
        resolutionNotes: data.resolutionNotes,
        bypassAssigneeCheck,
        commandId: data.commandId,
      }),
  });
}

/** POST /tickets/:id/close — close a resolved ticket. */
export async function close(req: Request, res: Response) {
  // Return value or early exit.
  return ticketScopedMutation(req, res, {
    // Validate field schema.
    schema: z.object({ commandId: z.string().uuid().optional() }),
    // Continue the controller logic.
    run: ({ req: r, data }) =>
      // Continue the controller logic.
      closeMaintenanceTicket({
        ticketId: r.params.id,
        closedByEmployeeId: r.user!.employeeId,
        commandId: data.commandId,
      }),
  });
}

/** POST /tickets/:id/reopen — reopen a closed/resolved ticket. */
export async function reopen(req: Request, res: Response) {
  // Return value or early exit.
  return ticketScopedMutation(req, res, {
    // Validate field schema.
    schema: z.object({
      // Validate field reason.
      reason: z.string().optional(),
      // Validate field commandId.
      commandId: z.string().uuid().optional(),
    }),
    // Continue the controller logic.
    run: ({ req: r, data }) =>
      // Continue the controller logic.
      reopenMaintenanceTicket({
        ticketId: r.params.id,
        reopenedByEmployeeId: r.user!.employeeId,
        reason: data.reason,
        commandId: data.commandId,
      }),
  });
}
