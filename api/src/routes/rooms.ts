import { Router } from "express";
import { TaskStatus } from "@prisma/client";
import { prisma } from "../db";
import { requireAuth, requireAction } from "../middleware/auth";
import { computeReadiness } from "../services/readiness";
import { AppError, markRoomDirty } from "../services/cleaning";
import { ACTIVE_TASK_STATUSES, OPEN_TICKET_STATUSES } from "../constants";

export const roomsRouter = Router();

const roomInclude = {
  floor: { include: { building: true } },
  cleaningTasks: {
    where: { status: { in: ACTIVE_TASK_STATUSES } },
    include: {
      assignedEmployee: true,
      sessions: {
        include: { employee: true },
        orderBy: { startedAt: "desc" as const },
      },
      inspections: {
        include: { inspector: true },
        orderBy: { inspectedAt: "desc" as const },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" as const },
    take: 1,
  },
  maintenanceTickets: {
    where: {
      status: { in: OPEN_TICKET_STATUSES },
      blocksRoom: true,
    },
    take: 5,
    orderBy: { openedAt: "desc" as const },
  },
};

type SessionRow = {
  id: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  notes: string | null;
  employeeId: string;
  employee: { id: string; fullName: string; employeeNumber: string };
};

type InspectionRow = {
  id: string;
  result: string;
  findings: string | null;
  inspectedAt: Date;
  inspector: { id: string; fullName: string; employeeNumber: string };
};

export function mapRoom(location: {
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
    dueAt: Date | null;
    version: number;
    reassignReason: string | null;
    assignedEmployee: { id: string; fullName: string; employeeNumber: string } | null;
    sessions: SessionRow[];
    inspections?: InspectionRow[];
  }>;
  maintenanceTickets?: Array<{
    id: string;
    title: string;
    category: string;
    priority: string;
    status: string;
    blocksRoom: boolean;
  }>;
}) {
  const blockingTickets = location.maintenanceTickets ?? [];
  const { readiness, reasons } = computeReadiness({
    ...location,
    hasBlockingTicket: blockingTickets.length > 0,
  });
  const activeTask = location.cleaningTasks?.[0] ?? null;
  const runningSession =
    activeTask?.sessions.find((s) => s.status === "running") ?? null;
  const lastCompletedSession =
    activeTask?.sessions.find((s) => s.status === "completed") ?? null;
  const lastInspection = activeTask?.inspections?.[0] ?? null;

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
    blockingIssues: blockingTickets.map((t) => ({
      id: t.id,
      title: t.title,
      category: t.category,
      priority: t.priority,
      status: t.status,
    })),
    activeTask: activeTask
      ? {
          id: activeTask.id,
          status: activeTask.status,
          priority: activeTask.priority,
          dueAt: activeTask.dueAt,
          version: activeTask.version,
          reassignReason: activeTask.reassignReason,
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
          lastCompletedSession: lastCompletedSession
            ? {
                id: lastCompletedSession.id,
                finishedAt: lastCompletedSession.finishedAt,
                notes: lastCompletedSession.notes,
                employee: {
                  id: lastCompletedSession.employee.id,
                  fullName: lastCompletedSession.employee.fullName,
                  employeeNumber: lastCompletedSession.employee.employeeNumber,
                },
              }
            : null,
          lastInspection: lastInspection
            ? {
                id: lastInspection.id,
                result: lastInspection.result,
                findings: lastInspection.findings,
                inspectedAt: lastInspection.inspectedAt,
                inspector: {
                  id: lastInspection.inspector.id,
                  fullName: lastInspection.inspector.fullName,
                  employeeNumber: lastInspection.inspector.employeeNumber,
                },
              }
            : null,
        }
      : null,
  };
}

roomsRouter.get("/", requireAuth, async (_req, res) => {
  const locations = await prisma.location.findMany({
    where: { catalogStatus: "active" },
    include: roomInclude,
    orderBy: [{ floor: { number: "asc" } }, { number: "asc" }],
  });

  return res.json(locations.map(mapRoom));
});

roomsRouter.get("/:id", requireAuth, async (req, res) => {
  const location = await prisma.location.findUnique({
    where: { id: req.params.id },
    include: roomInclude,
  });
  if (!location) {
    return res.status(404).json({ error: "not_found", message: "Room not found" });
  }
  return res.json(mapRoom(location));
});

roomsRouter.post(
  "/:id/mark-dirty",
  requireAuth,
  requireAction("rooms.mark_dirty"),
  async (req, res, next) => {
    try {
      const location = await markRoomDirty(req.params.id);
      return res.json(mapRoom(location));
    } catch (err) {
      return next(err);
    }
  },
);
