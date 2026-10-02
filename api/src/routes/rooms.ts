import { Router } from "express";
import { TaskStatus } from "@prisma/client";
import { prisma } from "../db";
import { requireAuth, requireRoles } from "../middleware/auth";
import { computeReadiness } from "../services/readiness";
import { AppError, markRoomDirty } from "../services/cleaning";

export const roomsRouter = Router();

function mapRoom(location: {
  id: string;
  number: string;
  catalogStatus: any;
  occupancy: any;
  cleaningStatus: any;
  serviceStatus: any;
  floor: { number: number; name: string; building: { name: string; code: string } };
  cleaningTasks?: Array<{
    id: string;
    status: TaskStatus;
    priority: string;
    version: number;
    assignedEmployee: { id: string; fullName: string; employeeNumber: string } | null;
    sessions: Array<{
      id: string;
      status: string;
      startedAt: Date;
      finishedAt: Date | null;
      employeeId: string;
    }>;
  }>;
}) {
  const { readiness, reasons } = computeReadiness(location);
  const activeTask = location.cleaningTasks?.[0] ?? null;
  const runningSession =
    activeTask?.sessions.find((s) => s.status === "running") ?? null;

  return {
    id: location.id,
    number: location.number,
    floor: location.floor.number,
    floorName: location.floor.name,
    building: location.floor.building.name,
    buildingCode: location.floor.building.code,
    catalogStatus: location.catalogStatus,
    occupancy: location.occupancy,
    cleaningStatus: location.cleaningStatus,
    serviceStatus: location.serviceStatus,
    readiness,
    readinessReasons: reasons,
    activeTask: activeTask
      ? {
          id: activeTask.id,
          status: activeTask.status,
          priority: activeTask.priority,
          version: activeTask.version,
          assignee: activeTask.assignedEmployee
            ? {
                id: activeTask.assignedEmployee.id,
                fullName: activeTask.assignedEmployee.fullName,
                employeeNumber: activeTask.assignedEmployee.employeeNumber,
              }
            : null,
          runningSession: runningSession
            ? {
                id: runningSession.id,
                startedAt: runningSession.startedAt,
                employeeId: runningSession.employeeId,
              }
            : null,
        }
      : null,
  };
}

roomsRouter.get("/", requireAuth, async (_req, res) => {
  const locations = await prisma.location.findMany({
    where: { catalogStatus: "active" },
    include: {
      floor: { include: { building: true } },
      cleaningTasks: {
        where: { status: { in: [TaskStatus.assigned, TaskStatus.in_progress] } },
        include: { assignedEmployee: true, sessions: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: [{ floor: { number: "asc" } }, { number: "asc" }],
  });

  return res.json(locations.map(mapRoom));
});

roomsRouter.get("/:id", requireAuth, async (req, res) => {
  const location = await prisma.location.findUnique({
    where: { id: req.params.id },
    include: {
      floor: { include: { building: true } },
      cleaningTasks: {
        where: { status: { in: [TaskStatus.assigned, TaskStatus.in_progress] } },
        include: { assignedEmployee: true, sessions: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  if (!location) {
    return res.status(404).json({ error: "not_found", message: "Room not found" });
  }
  return res.json(mapRoom(location));
});

roomsRouter.post(
  "/:id/mark-dirty",
  requireAuth,
  requireRoles("reception", "supervisor"),
  async (req, res, next) => {
    try {
      const location = await markRoomDirty(req.params.id);
      return res.json(mapRoom(location));
    } catch (err) {
      return next(err);
    }
  },
);

roomsRouter.use((err: unknown, _req: any, res: any, next: any) => {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: err.code,
      message: err.message,
      details: err.details,
    });
  }
  return next(err);
});
