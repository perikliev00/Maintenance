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
// Side-effect or default import required by this module.
import {
  // Carry this field through the payload or query.
  createNotifications,
  // Carry this field through the payload or query.
  recipientsForLocationOps,
// Execute: } from "../notifications";
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
    // Restrict the query to the relevant rows only.
    where: {
      // Carry this field through the payload or query.
      status: SessionStatus.running,
      // Carry this field through the payload or query.
      startedAt: { lte: cutoff },
      // Field value required by this payload or query.
      AND: [scopeWhere ?? {}, { task: { location: { catalogStatus: "active" } } }],
    },
    // Eager-load relations needed by the API response shape.
    include: {
      // Assignee display for overdue banner.
      employee: true,
      // Open nested structure for the next related fields.
      task: {
        // Eager-load relations needed by the API response shape.
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
      // Execute: (Date.now() - s.startedAt.getTime()) / 60000,
      (Date.now() - s.startedAt.getTime()) / 60000,
    );
    // Return result to caller.
    return {
      // Session primary key for ops follow-up actions.
      sessionId: s.id,
      // Parent cleaning task id.
      taskId: s.taskId,
      // Carry this field through the payload or query.
      startedAt: s.startedAt,
      // Carry this field through the payload or query.
      elapsedMinutes,
      // Open nested structure for the next related fields.
      employee: {
        // Carry this field through the payload or query.
        id: s.employee.id,
        // Carry this field through the payload or query.
        fullName: s.employee.fullName,
        // Carry this field through the payload or query.
        employeeNumber: s.employee.employeeNumber,
      },
      // Open nested structure for the next related fields.
      room: {
        // Carry this field through the payload or query.
        id: s.task.location.id,
        // Carry this field through the payload or query.
        number: s.task.location.number,
        // Carry this field through the payload or query.
        buildingCode: s.task.location.floor.building.code,
        // Carry this field through the payload or query.
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
  // Carry this field through the payload or query.
  locationId: string,
  // Parameter/field in the surrounding signature or type.
  actorEmployeeId?: string,
// Begin block/object for the following statements.
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
      // Restrict the query to the relevant rows only.
      where: { id: locationId },
      // Eager-load relations needed by the API response shape.
      include: {
        // Field value required by this payload or query.
        floor: { include: { building: true } },
        // Open nested structure for the next related fields.
        cleaningTasks: {
          // Restrict the query to the relevant rows only.
          where: { status: { in: [...ACTIVE_TASK_STATUSES] } },
          // Eager-load relations needed by the API response shape.
          include: {
            // Field value required by this payload or query.
            assignedEmployee: true,
            // Open nested structure for the next related fields.
            sessions: {
              // Eager-load relations needed by the API response shape.
              include: { employee: true },
              // Stable sort so list pages stay deterministic.
              orderBy: { startedAt: "desc" },
            },
            // Open nested structure for the next related fields.
            inspections: {
              // Eager-load relations needed by the API response shape.
              include: { inspector: true },
              // Stable sort so list pages stay deterministic.
              orderBy: { inspectedAt: "desc" },
              // Field value required by this payload or query.
              take: 1,
            },
          },
          // Stable sort so list pages stay deterministic.
          orderBy: { createdAt: "desc" },
          // Field value required by this payload or query.
          take: 1,
        },
        // Open nested structure for the next related fields.
        maintenanceTickets: {
          // Restrict the query to the relevant rows only.
          where: {
            // Carry this field through the payload or query.
            status: { in: [...OPEN_TICKET_STATUSES] },
            // Field value required by this payload or query.
            blocksRoom: true,
          },
          // Field value required by this payload or query.
          take: 5,
          // Stable sort so list pages stay deterministic.
          orderBy: { openedAt: "desc" },
        },
      },
    });
    // Audit status/cycle before vs after the bump.
    await recordAudit({
      // Carry this field through the payload or query.
      actorEmployeeId,
      // Field value required by this payload or query.
      action: "location.mark_dirty",
      // Field value required by this payload or query.
      entityType: "location",
      // Carry this field through the payload or query.
      entityId: locationId,
      // Carry this field through the payload or query.
      locationId,
      // Snapshot before bump for compliance review.
      before: {
        // Carry this field through the payload or query.
        cleaningStatus: location.cleaningStatus,
        // Carry this field through the payload or query.
        cleaningCycle: location.cleaningCycle,
      },
      // Authoritative dirty + new cycle after bump.
      after: {
        // Carry this field through the payload or query.
        cleaningStatus: CleaningStatus.dirty,
        // Carry this field through the payload or query.
        cleaningCycle: nextCycle,
      },
      // Field value required by this payload or query.
      summary: `Marked ${row.number} dirty`,
    // Execute: }, tx);
    }, tx);
    // Return result to caller.
    return row;
  });
  // Notify live room boards of the status change.
  publish("location.changed", { locationId: updated.id });
  // Begin block/object for the following statements.
  {
    // Notify staff who can create cleaning work for this location's scope.
    const recipients = await recipientsForLocationOps(
      // Carry this field through the payload or query.
      locationId,
      // Execute: "cleaning.create",
      "cleaning.create",
    );
    // Await async persistence or side effect.
    await createNotifications({
      // Field value required by this payload or query.
      type: "location.marked_dirty",
      // Field value required by this payload or query.
      title: "Room marked dirty",
      // Field value required by this payload or query.
      body: `Room ${updated.number} needs cleaning`,
      // Field value required by this payload or query.
      entityType: "location",
      // Carry this field through the payload or query.
      entityId: locationId,
      // Carry this field through the payload or query.
      locationId,
      // Field value required by this payload or query.
      actorEmployeeId: actorEmployeeId ?? null,
      // Carry this field through the payload or query.
      recipientEmployeeIds: recipients,
      // Dedupe includes updatedAt so repeat dirty bumps notify again.
      dedupeKey: `location.marked_dirty:${locationId}:${updated.updatedAt.toISOString()}`,
      // Open nested structure for the next related fields.
      payload: {
        // Field value required by this payload or query.
        panel: "rooms",
        // Carry this field through the payload or query.
        locationId,
        // Carry this field through the payload or query.
        locationNumber: updated.number,
      },
    });
  }
  // Return result to caller.
  return updated;
}
