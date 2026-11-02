/**
 * Maintenance ticket list/create and workflow transitions (assign/start/wait/
 * resume/resolve/close/reopen). Create requires exactly one of issueOptionId or
 * categoryId; mutations assert ticket/location scope.
 */
import type { Request, Response } from "express";
import { Priority } from "@prisma/client";
import { z } from "zod/v3";
import {
  assignMaintenanceTicket,
  closeMaintenanceTicket,
  createMaintenanceTicket,
  listMaintenanceTickets,
  listTicketEvents,
  reopenMaintenanceTicket,
  resolveMaintenanceTicket,
  resumeMaintenanceTicket,
  startMaintenanceTicket,
  waitMaintenanceTicket,
} from "../../services/maintenance";
import {
  assertCanAccessLocation,
  assertCanAccessTicket,
  resolveDataScope,
  ticketWhere,
} from "../../services/dataScope";
import { queryTriBool, queryTruthy } from "./queryBool";
import {
  maintenanceTicketCreateHttpSchema,
  ticketScopedMutation,
} from "./shared";

/** GET /tickets — scoped list with status/assignee/SLA/blocksRoom filters. */
export async function list(req: Request, res: Response) {
  // Optional filters from query string.
  const locationId =
    typeof req.query.locationId === "string" ? req.query.locationId : undefined;
  const statusParam =
    typeof req.query.status === "string" ? req.query.status : "open";
  const assigneeIdParam =
    typeof req.query.assigneeId === "string" ? req.query.assigneeId : undefined;
  const priorityParam =
    typeof req.query.priority === "string" ? req.query.priority : undefined;
  const slaBreached = queryTruthy(req.query.slaBreached);
  // Tri-state blocksRoom filter (true / false / undefined).
  const blocksRoom = queryTriBool(req.query.blocksRoom);
  // status=resolved shortcut vs open-only default.
  const resolvedOnly = statusParam === "resolved";
  const openOnly =
    !resolvedOnly &&
    (req.query.open === "true" ||
      (req.query.open !== "false" &&
        statusParam !== "all" &&
        !statusParam.includes(",")));
  // Explicit status list (comma-separated or single known status).
  const statuses =
    statusParam.includes(",") ||
    ["new", "assigned", "in_progress", "waiting", "resolved", "closed"].includes(
      statusParam,
    )
      ? (statusParam
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean) as import("@prisma/client").TicketStatus[])
      : undefined;
  const mine = queryTruthy(req.query.mine);
  const limitRaw =
    typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
  const limit =
    limitRaw !== undefined && Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(Math.floor(limitRaw), 100)
      : undefined;
  const cursor =
    typeof req.query.cursor === "string" && req.query.cursor.trim()
      ? req.query.cursor.trim()
      : undefined;
  // Opt-in envelope `{ items, nextCursor, total }` — default remains a bare array.
  const paginated = Boolean(cursor) || queryTruthy(req.query.paginated);

  // mine requires an authenticated employee id.
  if (mine && !req.user?.employeeId) {
    // Return value / early exit.
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
      statuses && statusParam !== "open" && statusParam !== "all"
        ? statuses
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
    return res.json(page.items);
  }
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
    // Return value / early exit.
    return res
      .status(400)
      .json({ error: "validation", details: parsed.error.flatten() });
  }

  // Must be able to access the report location.
  const scope = await resolveDataScope(req.user!);
  // Assert access / permission.
  await assertCanAccessLocation(scope, parsed.data.locationId);

  // Capture service / command result.
  const result = await createMaintenanceTicket({
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
  return ticketScopedMutation(req, res, {
    schema: z.object({
      assigneeId: z.string().min(1),
      commandId: z.string().uuid().optional(),
    }),
    run: ({ req: r, data }) =>
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
  return ticketScopedMutation(req, res, {
    schema: z.object({ commandId: z.string().uuid().optional() }),
    withAssigneeBypass: true,
    run: ({ req: r, data, bypassAssigneeCheck }) =>
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
  return ticketScopedMutation(req, res, {
    schema: z.object({
      reason: z.string().optional(),
      commandId: z.string().uuid().optional(),
    }),
    withAssigneeBypass: true,
    run: ({ req: r, data, bypassAssigneeCheck }) =>
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
  return ticketScopedMutation(req, res, {
    schema: z.object({ commandId: z.string().uuid().optional() }),
    withAssigneeBypass: true,
    run: ({ req: r, data, bypassAssigneeCheck }) =>
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
  return ticketScopedMutation(req, res, {
    schema: z.object({
      resolutionNotes: z.string().optional(),
      commandId: z.string().uuid().optional(),
    }),
    withAssigneeBypass: true,
    run: ({ req: r, data, bypassAssigneeCheck }) =>
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
  return ticketScopedMutation(req, res, {
    schema: z.object({ commandId: z.string().uuid().optional() }),
    run: ({ req: r, data }) =>
      closeMaintenanceTicket({
        ticketId: r.params.id,
        closedByEmployeeId: r.user!.employeeId,
        commandId: data.commandId,
      }),
  });
}

/** POST /tickets/:id/reopen — reopen a closed/resolved ticket. */
export async function reopen(req: Request, res: Response) {
  return ticketScopedMutation(req, res, {
    schema: z.object({
      reason: z.string().optional(),
      commandId: z.string().uuid().optional(),
    }),
    run: ({ req: r, data }) =>
      reopenMaintenanceTicket({
        ticketId: r.params.id,
        reopenedByEmployeeId: r.user!.employeeId,
        reason: data.reason,
        commandId: data.commandId,
      }),
  });
}
