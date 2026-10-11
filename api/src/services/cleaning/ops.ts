import { CleaningStatus, Prisma, SessionStatus } from "@prisma/client";
import { prisma } from "../../db";
import { ACTIVE_TASK_STATUSES } from "../../constants";
import { AppError } from "../../errors";
import { publish } from "../../events/bus";
import { getOperations } from "../settings";
import { recordAudit } from "../audit";
import {
  createNotifications,
  recipientsForLocationOps,
} from "../notifications";
import { bumpDirtyAndRebindWork } from "./cycles";

export async function listOverdueSessions(scopeWhere?: Prisma.CleaningSessionWhereInput) {
  const operations = await getOperations();
  const overdueMinutes = operations.overdueSessionMinutes;
  const cutoff = new Date(Date.now() - overdueMinutes * 60 * 1000);
  const sessions = await prisma.cleaningSession.findMany({
    where: {
      status: SessionStatus.running,
      startedAt: { lte: cutoff },
      ...(scopeWhere ?? {}),
    },
    include: {
      employee: true,
      task: {
        include: {
          location: { include: { floor: { include: { building: true } } } },
        },
      },
    },
    orderBy: { startedAt: "asc" },
  });

  return sessions.map((s) => {
    const elapsedMinutes = Math.floor(
      (Date.now() - s.startedAt.getTime()) / 60000,
    );
    return {
      sessionId: s.id,
      taskId: s.taskId,
      startedAt: s.startedAt,
      elapsedMinutes,
      employee: {
        id: s.employee.id,
        fullName: s.employee.fullName,
        employeeNumber: s.employee.employeeNumber,
      },
      room: {
        id: s.task.location.id,
        number: s.task.location.number,
        buildingCode: s.task.location.floor.building.code,
        floor: s.task.location.floor.number,
      },
    };
  });
}

export async function markRoomDirty(
  locationId: string,
  actorEmployeeId?: string,
) {
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location) {
    throw new AppError(404, "not_found", "Room not found");
  }
  const updated = await prisma.$transaction(async (tx) => {
    const nextCycle = await bumpDirtyAndRebindWork(tx, locationId);
    const row = await tx.location.findUniqueOrThrow({
      where: { id: locationId },
      include: {
        floor: { include: { building: true } },
        cleaningTasks: {
          where: { status: { in: [...ACTIVE_TASK_STATUSES] } },
          include: {
            assignedEmployee: true,
            sessions: {
              include: { employee: true },
              orderBy: { startedAt: "desc" },
            },
            inspections: {
              include: { inspector: true },
              orderBy: { inspectedAt: "desc" },
              take: 1,
            },
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        maintenanceTickets: {
          where: {
            status: { in: ["new", "in_progress"] },
            blocksRoom: true,
          },
          take: 5,
          orderBy: { openedAt: "desc" },
        },
      },
    });
    await recordAudit({
      actorEmployeeId,
      action: "location.mark_dirty",
      entityType: "location",
      entityId: locationId,
      locationId,
      before: {
        cleaningStatus: location.cleaningStatus,
        cleaningCycle: location.cleaningCycle,
      },
      after: {
        cleaningStatus: CleaningStatus.dirty,
        cleaningCycle: nextCycle,
      },
      summary: `Marked ${row.number} dirty`,
    }, tx);
    return row;
  });
  publish("location.changed", { locationId: updated.id });
  {
    const recipients = await recipientsForLocationOps(
      locationId,
      "cleaning.create",
    );
    await createNotifications({
      type: "location.marked_dirty",
      title: "Room marked dirty",
      body: `Room ${updated.number} needs cleaning`,
      entityType: "location",
      entityId: locationId,
      locationId,
      actorEmployeeId: actorEmployeeId ?? null,
      recipientEmployeeIds: recipients,
      dedupeKey: `location.marked_dirty:${locationId}:${updated.updatedAt.toISOString()}`,
      payload: {
        panel: "rooms",
        locationId,
        locationNumber: updated.number,
      },
    });
  }
  return updated;
}
