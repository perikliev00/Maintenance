/**
 * Cleaning task list/create/start/inspect/reassign.
 * Mutating handlers assert task/location scope; start/inspect use commandId for idempotency.
 */
import type { NextFunction, Request, Response } from "express";
import { Role } from "@prisma/client";
import { z } from "zod/v3";
// Import local module ../../services/assignees.
import { listActiveHousekeepers } from "../../services/assignees";
// Import local module ../../services/cleaning/authorization.
import { canBypassCleaningAssignee } from "../../services/cleaning/authorization";
// Continue named import list.
import {
  // Bring createCleaningTask into scope from the import.
  createCleaningTask,
  // Bring inspectCleaningTask into scope from the import.
  inspectCleaningTask,
  // Bring reassignCleaningTask into scope from the import.
  reassignCleaningTask,
  // Bring startCleaningTask into scope from the import.
  startCleaningTask,
} from "../../services/cleaning";
// Import local module ../../services/cleaningTasksQuery.
import { listCleaningTasks } from "../../services/cleaningTasksQuery";
// Continue named import list.
import {
  // Bring assertCanAccessLocation into scope from the import.
  assertCanAccessLocation,
  // Bring assertCanAccessTask into scope from the import.
  assertCanAccessTask,
  // Bring resolveDataScope into scope from the import.
  resolveDataScope,
  // Bring taskWhere into scope from the import.
  taskWhere,
} from "../../services/dataScope";
// Import local module ../../services/housekeepers.
import { listAvailableHousekeepers as listAvailableHousekeepersService } from "../../services/housekeepers";
// Import local module ../../services/settings.
import { getFlags } from "../../services/settings";

/** GET /cleaning/tasks — scoped list with optional hotelDate/status filters. */
export async function list(req: Request, res: Response) {
  // Build data-scope filter.
  const scope = await resolveDataScope(req.user!);
  const hotelDate =
    // Narrow the runtime type before using the value.
    typeof req.query.hotelDate === "string" ? req.query.hotelDate : undefined;
  const statusParam =
    // Narrow the runtime type before using the value.
    typeof req.query.status === "string" ? req.query.status : undefined;
  // Comma-separated status list → Prisma `in` filter.
  const statuses = statusParam
    // Continue the conditional expression.
    ? statusParam
        // Continue the fluent chain.
        .split(",")
        // Continue the fluent chain.
        .map((s) => s.trim())
        // Continue the fluent chain.
        .filter(Boolean)
    // Continue the conditional expression.
    : undefined;
  const where = {
    // Continue the controller logic.
    ...taskWhere(scope),
    // Continue the controller logic.
    ...(hotelDate
      // Continue the conditional expression.
      ? { hotelDate: new Date(`${hotelDate}T00:00:00.000Z`) }
      // Continue the conditional expression.
      : {}),
    // Continue the controller logic.
    ...(statuses?.length ? { status: { in: statuses as never[] } } : {}),
  };

  const tasks = await listCleaningTasks(where);

  // JSON success response.
  return res.json(tasks);
}

/** POST /cleaning/tasks — create a task for a location in scope. */
export async function create(req: Request, res: Response) {
  // Zod schema for request shape.
  const schema = z.object({
    // Validate field locationId.
    locationId: z.string().min(1),
    // Validate field hotelDate.
    hotelDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    // Validate field priority.
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    // Validate field assignedEmployeeId.
    assignedEmployeeId: z.string().optional(),
    // Validate field shiftId.
    shiftId: z.string().min(1).nullable().optional(),
    // Validate field dueAt.
    dueAt: z.string().datetime().optional(),
    serviceType: z
      // Restrict to an allowed enum set.
      .enum(["stayover", "departure", "arrival", "common_area"])
      // Allow the field to be omitted.
      .optional(),
  });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body);
  // Reject invalid request payload.
  if (!parsed.success) {
    // Validation error response.
    return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
  }

  // Must be able to access the target location before creating work.
  const scope = await resolveDataScope(req.user!);
  // Assert access / permission.
  await assertCanAccessLocation(scope, parsed.data.locationId);

  const task = await createCleaningTask({
    // Continue the controller logic.
    ...parsed.data,
    actorEmployeeId: req.user!.employeeId,
  });
  return res.status(201).json(task);
}

/**
 * Start a task session. Requires cleaning.start; SEC-002 assignee bypass is a
 * separate role check (same set as tickets). 200 on idempotent replay.
 */
export async function start(req: Request, res: Response) {
  // Zod schema for request shape.
  const schema = z.object({
    // Validate field commandId.
    commandId: z.string().uuid(),
    // Validate field expectedVersion.
    expectedVersion: z.number().int().optional(),
  });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body);
  // Reject invalid request payload.
  if (!parsed.success) {
    // Validation error response.
    return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
  }

  // Build data-scope filter.
  const scope = await resolveDataScope(req.user!);
  // Assert access / permission.
  await assertCanAccessTask(scope, req.params.id);

  // Capture service / command result.
  const result = await startCleaningTask({
    taskId: req.params.id,
    employeeId: req.user!.employeeId,
    commandId: parsed.data.commandId,
    expectedVersion: parsed.data.expectedVersion,
    // Same bypass set as tickets (owner/supervisor/manager/admin/reception).
    bypassAssigneeCheck: canBypassCleaningAssignee(req.user!.role),
  });

  // Idempotent replay returns 200; first start returns 201.
  return res.status(result.idempotent ? 200 : 201).json(result);
}

/** POST /tasks/:id/inspect — approve or reject after completion. */
export async function inspect(req: Request, res: Response) {
  // Zod schema for request shape.
  const schema = z.object({
    // Validate field commandId.
    commandId: z.string().uuid(),
    // Validate field result.
    result: z.enum(["approved", "rejected"]),
    // Validate field findings.
    findings: z.string().optional(),
    // Validate field expectedVersion.
    expectedVersion: z.number().int().optional(),
  });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body);
  // Reject invalid request payload.
  if (!parsed.success) {
    // Validation error response.
    return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
  }

  // Build data-scope filter.
  const scope = await resolveDataScope(req.user!);
  // Assert access / permission.
  await assertCanAccessTask(scope, req.params.id);

  // Capture service / command result.
  const result = await inspectCleaningTask({
    taskId: req.params.id,
    inspectorEmployeeId: req.user!.employeeId,
    commandId: parsed.data.commandId,
    result: parsed.data.result,
    findings: parsed.data.findings,
    expectedVersion: parsed.data.expectedVersion,
  });

  return res.status(result.idempotent ? 200 : 201).json(result);
}

/**
 * Reassign a task. Reception additionally needs the allow_reception_reassign setting flag.
 */
export async function reassign(req: Request, res: Response) {
  // Reception reassign is feature-flagged in settings.
  if (req.user!.role === Role.reception) {
    const flags = await getFlags();
    if (!flags.allow_reception_reassign) {
      return res.status(403).json({
        error: "forbidden",
        message: "Reception reassign is disabled in settings",
      });
    }
  }

  // Zod schema for request shape.
  const schema = z.object({
    // Validate field assignedEmployeeId.
    assignedEmployeeId: z.string().min(1),
    // Validate field reason.
    reason: z.string().min(1),
    // Validate field shiftId.
    shiftId: z.string().min(1).nullable().optional(),
    // Validate field expectedVersion.
    expectedVersion: z.number().int().optional(),
    // Validate field forceDespiteAvailability.
    forceDespiteAvailability: z.boolean().optional(),
  });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body);
  // Reject invalid request payload.
  if (!parsed.success) {
    // Validation error response.
    return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
  }

  // Build data-scope filter.
  const scope = await resolveDataScope(req.user!);
  // Assert access / permission.
  await assertCanAccessTask(scope, req.params.id);

  const task = await reassignCleaningTask({
    taskId: req.params.id,
    assignedEmployeeId: parsed.data.assignedEmployeeId,
    reason: parsed.data.reason,
    shiftId: parsed.data.shiftId,
    expectedVersion: parsed.data.expectedVersion,
    actorEmployeeId: req.user!.employeeId,
    actorRole: req.user!.role,
    forceDespiteAvailability: parsed.data.forceDespiteAvailability === true,
  });

  // JSON success response.
  return res.json(task);
}

/** GET /employees/housekeepers — active housekeepers for the reassign picker. */
export async function listHousekeepers(
  _req: Request,
  res: Response,
  next: NextFunction,
// Continue the controller logic.
) {
  const employees = await listActiveHousekeepers();
  // JSON success response.
  return res.json(employees);
}

/**
 * GET /available-housekeepers?locationId=&taskId=
 * Real-time availability for the room-specific reassignment modal.
 */
export async function listAvailableHousekeepers(
  req: Request,
  res: Response,
  next: NextFunction,
// Continue the controller logic.
) {
  const locationId =
    // Narrow the runtime type before using the value.
    typeof req.query.locationId === "string" ? req.query.locationId : "";
  // Guard: skip or fail when the negated condition holds.
  if (!locationId) {
    // Bad-request validation error response.
    return res.status(400).json({
      error: "validation",
      message: "locationId is required",
    });
  }
  const taskId =
    // Narrow the runtime type before using the value.
    typeof req.query.taskId === "string" && req.query.taskId.length > 0
      // Continue the conditional expression.
      ? req.query.taskId
      // Continue the conditional expression.
      : undefined;

  // Resolve caller's DataScope for Prisma filtering.
  const scope = await resolveDataScope(req.user!);
  // Await side-effecting async work.
  await assertCanAccessLocation(scope, locationId);
  // Branch when this condition holds.
  if (taskId) {
    // Await side-effecting async work.
    await assertCanAccessTask(scope, taskId);
  }

  // Invoke service and capture the result payload.
  const result = await listAvailableHousekeepersService({
    locationId,
    taskId,
  });
  // JSON success response with the payload.
  return res.json(result);
}
