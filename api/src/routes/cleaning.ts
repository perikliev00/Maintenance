import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, requireRoles } from "../middleware/auth";
import {
  AppError,
  completeCleaningSession,
  createCleaningTask,
  startCleaningTask,
} from "../services/cleaning";

export const cleaningRouter = Router();

cleaningRouter.get("/tasks", requireAuth, async (req, res) => {
  const hotelDate = typeof req.query.hotelDate === "string" ? req.query.hotelDate : undefined;
  const where = hotelDate
    ? { hotelDate: new Date(`${hotelDate}T00:00:00.000Z`) }
    : {};

  const tasks = await prisma.cleaningTask.findMany({
    where,
    include: {
      location: { include: { floor: { include: { building: true } } } },
      assignedEmployee: true,
      sessions: true,
    },
    orderBy: [{ hotelDate: "desc" }, { createdAt: "desc" }],
  });

  return res.json(tasks);
});

cleaningRouter.post(
  "/tasks",
  requireAuth,
  requireRoles("reception", "supervisor"),
  async (req, res, next) => {
    try {
      const schema = z.object({
        locationId: z.string().min(1),
        hotelDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
        assignedEmployeeId: z.string().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
      }

      const task = await createCleaningTask(parsed.data);
      return res.status(201).json(task);
    } catch (err) {
      return next(err);
    }
  },
);

cleaningRouter.post(
  "/tasks/:id/start",
  requireAuth,
  requireRoles("housekeeper", "supervisor"),
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

      const result = await startCleaningTask({
        taskId: req.params.id,
        employeeId: req.user!.employeeId,
        commandId: parsed.data.commandId,
        expectedVersion: parsed.data.expectedVersion,
      });

      return res.status(result.idempotent ? 200 : 201).json(result);
    } catch (err) {
      return next(err);
    }
  },
);

cleaningRouter.post(
  "/sessions/:id/complete",
  requireAuth,
  requireRoles("housekeeper", "supervisor"),
  async (req, res, next) => {
    try {
      const schema = z.object({
        commandId: z.string().uuid(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
      }

      const result = await completeCleaningSession({
        sessionId: req.params.id,
        employeeId: req.user!.employeeId,
        commandId: parsed.data.commandId,
      });

      return res.status(result.idempotent ? 200 : 200).json(result);
    } catch (err) {
      return next(err);
    }
  },
);

cleaningRouter.get("/employees/housekeepers", requireAuth, async (_req, res) => {
  const employees = await prisma.employee.findMany({
    where: { user: { role: "housekeeper", isActive: true } },
    select: { id: true, fullName: true, employeeNumber: true },
    orderBy: { fullName: "asc" },
  });
  return res.json(employees);
});

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
