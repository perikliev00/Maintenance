import { Router } from "express";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireAuth, requireAction } from "../../middleware/auth";
import { isOwner } from "../../permissions";
import { listActiveHousekeepers } from "../../services/assignees";
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
import { getFlags } from "../../services/settings";

export function registerTaskRoutes(router: Router): void {
  router.get("/tasks", requireAuth, requireAction("rooms.view"), async (req, res, next) => {
    try {
      const scope = await resolveDataScope(req.user!);
      const hotelDate =
        typeof req.query.hotelDate === "string" ? req.query.hotelDate : undefined;
      const statusParam =
        typeof req.query.status === "string" ? req.query.status : undefined;
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

      return res.json(tasks);
    } catch (err) {
      return next(err);
    }
  });

  router.post(
    "/tasks",
    requireAuth,
    requireAction("cleaning.create"),
    async (req, res, next) => {
      try {
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
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
        }

        const scope = await resolveDataScope(req.user!);
        await assertCanAccessLocation(scope, parsed.data.locationId);

        const task = await createCleaningTask({
          ...parsed.data,
          actorEmployeeId: req.user!.employeeId,
        });
        return res.status(201).json(task);
      } catch (err) {
        return next(err);
      }
    },
  );

  router.post(
    "/tasks/:id/start",
    requireAuth,
    requireAction("cleaning.start"),
    async (req, res, next) => {
      try {
        const schema = z.object({
          commandId: z.string().uuid(),
          expectedVersion: z.number().int().optional(),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
        }

        const scope = await resolveDataScope(req.user!);
        await assertCanAccessTask(scope, req.params.id);

        const result = await startCleaningTask({
          taskId: req.params.id,
          employeeId: req.user!.employeeId,
          commandId: parsed.data.commandId,
          expectedVersion: parsed.data.expectedVersion,
          bypassAssigneeCheck: isOwner(req.user!.role),
        });

        return res.status(result.idempotent ? 200 : 201).json(result);
      } catch (err) {
        return next(err);
      }
    },
  );

  router.post(
    "/tasks/:id/inspect",
    requireAuth,
    requireAction("cleaning.inspect"),
    async (req, res, next) => {
      try {
        const schema = z.object({
          commandId: z.string().uuid(),
          result: z.enum(["approved", "rejected"]),
          findings: z.string().optional(),
          expectedVersion: z.number().int().optional(),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
        }

        const scope = await resolveDataScope(req.user!);
        await assertCanAccessTask(scope, req.params.id);

        const result = await inspectCleaningTask({
          taskId: req.params.id,
          inspectorEmployeeId: req.user!.employeeId,
          commandId: parsed.data.commandId,
          result: parsed.data.result,
          findings: parsed.data.findings,
          expectedVersion: parsed.data.expectedVersion,
        });

        return res.status(result.idempotent ? 200 : 201).json(result);
      } catch (err) {
        return next(err);
      }
    },
  );

  router.post(
    "/tasks/:id/reassign",
    requireAuth,
    requireAction("cleaning.reassign"),
    async (req, res, next) => {
      try {
        if (req.user!.role === Role.reception) {
          const flags = await getFlags();
          if (!flags.allow_reception_reassign) {
            return res.status(403).json({
              error: "forbidden",
              message: "Reception reassign is disabled in settings",
            });
          }
        }

        const schema = z.object({
          assignedEmployeeId: z.string().min(1),
          reason: z.string().min(1),
          shiftId: z.string().min(1).nullable().optional(),
          expectedVersion: z.number().int().optional(),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
        }

        const scope = await resolveDataScope(req.user!);
        await assertCanAccessTask(scope, req.params.id);

        const task = await reassignCleaningTask({
          taskId: req.params.id,
          assignedEmployeeId: parsed.data.assignedEmployeeId,
          reason: parsed.data.reason,
          shiftId: parsed.data.shiftId,
          expectedVersion: parsed.data.expectedVersion,
          actorEmployeeId: req.user!.employeeId,
        });

        return res.json(task);
      } catch (err) {
        return next(err);
      }
    },
  );

  router.get(
    "/employees/housekeepers",
    requireAuth,
    requireAction("cleaning.reassign"),
    async (_req, res, next) => {
      try {
        const employees = await listActiveHousekeepers();
        return res.json(employees);
      } catch (err) {
        return next(err);
      }
    },
  );
}
