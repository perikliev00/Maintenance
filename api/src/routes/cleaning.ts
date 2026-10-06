import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, requireAction } from "../middleware/auth";
import { isOwner } from "../permissions";
import {
  AppError,
  cancelCleaningSession,
  completeCleaningSession,
  createCleaningTask,
  inspectCleaningTask,
  listOverdueSessions,
  reassignCleaningTask,
  startCleaningTask,
} from "../services/cleaning";
import { getCleaningResults } from "../services/cleaningResults";
import { getFlags } from "../services/settings";
import {
  assertCanAccessLocation,
  assertCanAccessSession,
  assertCanAccessTask,
  resolveDataScope,
  sessionTaskWhere,
  taskWhere,
} from "../services/dataScope";
import { Role } from "@prisma/client";

export const cleaningRouter = Router();

cleaningRouter.get("/tasks", requireAuth, requireAction("rooms.view"), async (req, res, next) => {
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

    const tasks = await prisma.cleaningTask.findMany({
      where,
      include: {
        location: { include: { floor: { include: { building: true } } } },
        assignedEmployee: true,
        shift: {
          select: {
            id: true,
            code: true,
            nameBg: true,
            nameEn: true,
            startTime: true,
            endTime: true,
          },
        },
        sector: { select: { id: true, code: true, nameBg: true, nameEn: true } },
        sectorSupervisor: {
          select: { id: true, fullName: true, employeeNumber: true },
        },
        sessions: true,
        inspections: true,
      },
      orderBy: [{ hotelDate: "desc" }, { createdAt: "desc" }],
    });

    return res.json(tasks);
  } catch (err) {
    return next(err);
  }
});

cleaningRouter.post(
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

cleaningRouter.post(
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

cleaningRouter.post(
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

cleaningRouter.post(
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

cleaningRouter.post(
  "/sessions/:id/complete",
  requireAuth,
  requireAction("cleaning.complete"),
  async (req, res, next) => {
    try {
      const schema = z.object({
        commandId: z.string().uuid(),
        notes: z.string().optional(),
        expectedVersion: z.number().int().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
      }

      const scope = await resolveDataScope(req.user!);
      await assertCanAccessSession(scope, req.params.id);

      const result = await completeCleaningSession({
        sessionId: req.params.id,
        employeeId: req.user!.employeeId,
        commandId: parsed.data.commandId,
        notes: parsed.data.notes,
        expectedVersion: parsed.data.expectedVersion,
        bypassSessionOwnerCheck: isOwner(req.user!.role),
      });

      return res.json(result);
    } catch (err) {
      return next(err);
    }
  },
);

cleaningRouter.post(
  "/sessions/:id/cancel",
  requireAuth,
  requireAction("cleaning.review_overdue"),
  async (req, res, next) => {
    try {
      const schema = z.object({
        commandId: z.string().uuid(),
        notes: z.string().optional(),
        expectedVersion: z.number().int().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
      }

      const scope = await resolveDataScope(req.user!);
      await assertCanAccessSession(scope, req.params.id);

      const result = await cancelCleaningSession({
        sessionId: req.params.id,
        employeeId: req.user!.employeeId,
        commandId: parsed.data.commandId,
        notes: parsed.data.notes,
        expectedVersion: parsed.data.expectedVersion,
        // Reviewers cancel abandoned sessions owned by others.
        bypassSessionOwnerCheck: true,
      });

      return res.json(result);
    } catch (err) {
      return next(err);
    }
  },
);

cleaningRouter.get(
  "/sessions/review",
  requireAuth,
  requireAction("cleaning.review_overdue"),
  async (req, res, next) => {
    try {
      const scope = await resolveDataScope(req.user!);
      const sessions = await listOverdueSessions(sessionTaskWhere(scope));
      return res.json(sessions);
    } catch (err) {
      return next(err);
    }
  },
);

cleaningRouter.get(
  "/employees/housekeepers",
  requireAuth,
  requireAction("cleaning.reassign"),
  async (_req, res) => {
    const employees = await prisma.employee.findMany({
      where: { user: { role: "housekeeper", isActive: true } },
      select: { id: true, fullName: true, employeeNumber: true },
      orderBy: { fullName: "asc" },
    });
    return res.json(employees);
  },
);

cleaningRouter.get(
  "/results",
  requireAuth,
  requireAction("cleaning.results_view"),
  async (req, res, next) => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const serviceTypeEnum = z.enum([
        "stayover",
        "departure",
        "arrival",
        "common_area",
      ]);
      const schema = z.object({
        from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .default(today),
        to: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .default(today),
        page: z.coerce.number().int().min(1).optional().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
        serviceType: z
          .union([
            serviceTypeEnum,
            z.string().transform((s) => s.split(",").map((x) => x.trim())),
          ])
          .optional(),
      });
      const parsed = schema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({
          error: "validation",
          details: parsed.error.flatten(),
        });
      }
      if (parsed.data.from > parsed.data.to) {
        return res.status(400).json({
          error: "validation",
          message: "`from` must be on or before `to`",
        });
      }

      const rawTypes = parsed.data.serviceType;
      let serviceTypes: Array<
        "stayover" | "departure" | "arrival" | "common_area"
      > | undefined;
      if (rawTypes !== undefined) {
        const list = Array.isArray(rawTypes) ? rawTypes : [rawTypes];
        const checked = z.array(serviceTypeEnum).safeParse(list);
        if (!checked.success) {
          return res.status(400).json({
            error: "validation",
            details: checked.error.flatten(),
          });
        }
        serviceTypes = checked.data;
      }

      const scope = await resolveDataScope(req.user!);
      const result = await getCleaningResults({
        from: parsed.data.from,
        to: parsed.data.to,
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
        serviceTypes,
        sessionWhere: sessionTaskWhere(scope),
        taskWhere: taskWhere(scope),
      });
      return res.json(result);
    } catch (err) {
      return next(err);
    }
  },
);

cleaningRouter.use((err: unknown, _req: any, res: any, next: any) => {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: err.code,
      message: err.message,
      details: err.details,
    });
  }
  return next(err);
});
