/**
 * Cleaning ops helpers: overdue running sessions and intentional mark-dirty.
 */
// Prisma enums/client for sessions, locations, and scoped queries.
import { CleaningStatus, Prisma, SessionStatus } from "@prisma/client";
// Module dependency import.
import { prisma } from "../../db";
// Which task statuses count as active work on mark-dirty reload.
import { ACTIVE_TASK_STATUSES, OPEN_TICKET_STATUSES } from "../../constants";
// Module dependency import.
import { AppError } from "../../errors";
// Live room board refresh after intentional dirty bump.
import { publish } from "../../events/bus";
// Overdue threshold minutes from operations settings.
import { getOperations } from "../settings";
// Module dependency import.
import { recordAudit } from "../audit";
import {
  createNotifications,
  recipientsForLocationOps,
} from "../notifications";
// Cycle bump + rebind helper shared with daily-plan effects.
import { bumpDirtyAndRebindWork } from "./cycles";

/**
 * List running sessions older than `ops.overdueSessionMinutes`, optionally
 * narrowed by data-scope `scopeWhere`.
 */
export async function listOverdueSessions(scopeWhere?: Prisma.CleaningSessionWhereInput) {
  // Overdue threshold comes from operations settings (not a hardcoded constant).
  const operations = await getOperations();
  // Local binding for this step.
  const overdueMinutes = operations.overdueSessionMinutes;
  // Sessions that started at or before this instant are overdue.
  const cutoff = new Date(Date.now() - overdueMinutes * 60 * 1000);
  // Running sessions that started at or before the cutoff; optional data-scope.
  const sessions = await prisma.cleaningSession.findMany({
    where: {
      status: SessionStatus.running,
      startedAt: { lte: cutoff },
      ...(scopeWhere ?? {}),
    },
    include: {
      // Assignee display for overdue banner.
      employee: true,
      task: {
        include: {
          // Room/building context for ops triage.
          location: { include: { floor: { include: { building: true } } } },
        },
      },
    },
    // Oldest overdue first — prioritize longest-running sessions.
    orderBy: { startedAt: "asc" },
  });

  // Flatten into the overdue banner DTO with live elapsed minutes.
  return sessions.map((s) => {
    // Elapsed minutes computed at read time (not stored).
    const elapsedMinutes = Math.floor(
      (Date.now() - s.startedAt.getTime()) / 60000,
    );
    // Return result to caller.
    return {
      // Session primary key for ops follow-up actions.
      sessionId: s.id,
      // Parent cleaning task id.
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

/**
 * Force a room dirty: bump cleaning cycle, rebind active work, audit + notify.
 * Awaiting-inspection tasks stay on the old cycle so a stale approve cannot
 * restore verified_clean after this bump.
 */
export async function markRoomDirty(
  locationId: string,
  actorEmployeeId?: string,
) {
  // Pre-load for audit before/after and 404 when missing.
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  // Guard / branch on preconditions.
  if (!location) {
    // Fail closed with structured AppError.
    throw new AppError(404, "not_found", "Room not found");
  }
  // Atomic bump + audit so a partial dirty never lands without a trail.
  const updated = await prisma.$transaction(async (tx) => {
    // Bump cycle, force dirty, rebind active work.
    const nextCycle = await bumpDirtyAndRebindWork(tx, locationId);
    // Reload with live-board includes for the API response.
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
            status: { in: [...OPEN_TICKET_STATUSES] },
            blocksRoom: true,
          },
          take: 5,
          orderBy: { openedAt: "desc" },
        },
      },
    });
    // Audit status/cycle before vs after the bump.
    await recordAudit({
      actorEmployeeId,
      action: "location.mark_dirty",
      entityType: "location",
      entityId: locationId,
      locationId,
      // Snapshot before bump for compliance review.
      before: {
        cleaningStatus: location.cleaningStatus,
        cleaningCycle: location.cleaningCycle,
      },
      // Authoritative dirty + new cycle after bump.
      after: {
        cleaningStatus: CleaningStatus.dirty,
        cleaningCycle: nextCycle,
      },
      summary: `Marked ${row.number} dirty`,
    }, tx);
    // Return result to caller.
    return row;
  });
  // Notify live room boards of the status change.
  publish("location.changed", { locationId: updated.id });
  {
    // Notify staff who can create cleaning work for this location's scope.
    const recipients = await recipientsForLocationOps(
      locationId,
      "cleaning.create",
    );
    // Await async persistence or side effect.
    await createNotifications({
      type: "location.marked_dirty",
      title: "Room marked dirty",
      body: `Room ${updated.number} needs cleaning`,
      entityType: "location",
      entityId: locationId,
      locationId,
      actorEmployeeId: actorEmployeeId ?? null,
      recipientEmployeeIds: recipients,
      // Dedupe includes updatedAt so repeat dirty bumps notify again.
      dedupeKey: `location.marked_dirty:${locationId}:${updated.updatedAt.toISOString()}`,
      payload: {
        panel: "rooms",
        locationId,
        locationNumber: updated.number,
      },
    });
  }
  // Return result to caller.
  return updated;
}
