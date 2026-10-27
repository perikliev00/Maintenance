/**
 * Cleaning task list/create/start/inspect/reassign.
 * Mutating handlers assert task/location scope; start/inspect use commandId for idempotency.
 */
import type { NextFunction, Request, Response } from "express";
import { Role } from "@prisma/client";
import { z } from "zod";
import { listActiveHousekeepers } from "../../services/assignees";
import { canBypassCleaningAssignee } from "../../services/cleaning/authorization";
import {
  createCleaningTask,
  inspectCleaningTask,
  reassignCleaningTask,
  startCleaningTask,
} from "../../services/cleaning";
import { listCleaningTasks } from "../../services/cleaningTasksQuery";
import {
  assertCanAccessLocation,
  assertCanAccessTask,
  resolveDataScope,
  taskWhere,
} from "../../services/dataScope";
import { listAvailableHousekeepers as listAvailableHousekeepersService } from "../../services/housekeepers";
import { getFlags } from "../../services/settings";

/** GET /cleaning/tasks — scoped list with optional hotelDate/status filters. */
export async function list(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    // Build data-scope filter.
    const scope = await resolveDataScope(req.user!);
    const hotelDate =
      typeof req.query.hotelDate === "string" ? req.query.hotelDate : undefined;
    const statusParam =
      typeof req.query.status === "string" ? req.query.status : undefined;
    // Comma-separated status list → Prisma `in` filter.
    const statuses = statusParam
      ? statusParam
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    const where = {
      ...taskWhere(scope),
      ...(hotelDate
        ? { hotelDate: new Date(`${hotelDate}T00:00:00.000Z`) }
        : {}),
      ...(statuses?.length ? { status: { in: statuses as never[] } } : {}),
    };

    const tasks = await listCleaningTasks(where);

    // JSON success response.
    return res.json(tasks);
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** POST /cleaning/tasks — create a task for a location in scope. */
export async function create(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    // Zod schema for request shape.
    const schema = z.object({
      locationId: z.string().min(1),
      hotelDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
      assignedEmployeeId: z.string().optional(),
      shiftId: z.string().min(1).nullable().optional(),
      dueAt: z.string().datetime().optional(),
      serviceType: z
        .enum(["stayover", "departure", "arrival", "common_area"])
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
      ...parsed.data,
      actorEmployeeId: req.user!.employeeId,
    });
    // Return value / early exit.
    return res.status(201).json(task);
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/**
 * Start a task session. Bypass roles match tickets (SEC-002); 200 on idempotent replay.
 */
export async function start(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    // Zod schema for request shape.
    const schema = z.object({
      commandId: z.string().uuid(),
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
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** POST /tasks/:id/inspect — approve or reject after completion. */
export async function inspect(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    // Zod schema for request shape.
    const schema = z.object({
      commandId: z.string().uuid(),
      result: z.enum(["approved", "rejected"]),
      findings: z.string().optional(),
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

    // Return value / early exit.
    return res.status(result.idempotent ? 200 : 201).json(result);
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/**
 * Reassign a task. Reception additionally needs the allow_reception_reassign setting flag.
 */
export async function reassign(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    // Reception reassign is feature-flagged in settings.
    if (req.user!.role === Role.reception) {
      const flags = await getFlags();
      // Branch: conditional gate.
      if (!flags.allow_reception_reassign) {
        // Return value / early exit.
        return res.status(403).json({
          error: "forbidden",
          message: "Reception reassign is disabled in settings",
        });
      }
    }

    // Zod schema for request shape.
    const schema = z.object({
      assignedEmployeeId: z.string().min(1),
      reason: z.string().min(1),
      shiftId: z.string().min(1).nullable().optional(),
      expectedVersion: z.number().int().optional(),
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
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** GET /employees/housekeepers — active housekeepers for the reassign picker. */
export async function listHousekeepers(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  // Try block for fallible work.
  try {
    const employees = await listActiveHousekeepers();
    // JSON success response.
    return res.json(employees);
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/**
 * GET /available-housekeepers?locationId=&taskId=
 * Real-time availability for the room-specific reassignment modal.
 */
export async function listAvailableHousekeepers(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const locationId =
      typeof req.query.locationId === "string" ? req.query.locationId : "";
    if (!locationId) {
      return res.status(400).json({
        error: "validation",
        message: "locationId is required",
      });
    }
    const taskId =
      typeof req.query.taskId === "string" && req.query.taskId.length > 0
        ? req.query.taskId
        : undefined;

    const scope = await resolveDataScope(req.user!);
    await assertCanAccessLocation(scope, locationId);
    if (taskId) {
      await assertCanAccessTask(scope, taskId);
    }

    const result = await listAvailableHousekeepersService({
      locationId,
      taskId,
    });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}
