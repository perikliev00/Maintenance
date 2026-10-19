/**
 * Create and reassign cleaning tasks with cycle allocation, sector snapshot,
 * assignee checks, and optimistic version claims on reassign.
 */
// Task/session enums and unchecked update input types.
import { CleaningServiceType, Prisma, SessionStatus, TaskStatus } from "@prisma/client";
// Module dependency import.
import { prisma } from "../../db";
// Module dependency import.
import { ACTIVE_TASK_STATUSES } from "../../constants";
// Module dependency import.
import { AppError } from "../../errors";
// Module dependency import.
import { publish } from "../../events/bus";
// Module dependency import.
import { sectorSnapshotForLocation } from "../dataScope";
// Module dependency import.
import { recordAudit } from "../audit";
// Module dependency import.
import { createNotifications } from "../notifications";
// Validate assignee is active and cleaning-capable.
import { assertActiveCleaningAssignee } from "../assignees";
// Module dependency import.
import { taskInclude } from "../cleaningTasksQuery";
// Module dependency import.
import { assertActiveShiftId } from "../shifts";
// Module dependency import.
import { assertTaskVersion, claimTaskStatus } from "./claims";
import { resolveCycleForNewTask } from "./cycles";
import { deriveCleaningServiceType } from "./deriveServiceType";
import { lockTask, lockLocation } from "./locks";
import { isP2002, mapCreateTaskUniqueConflict } from "./prismaConflicts";
import { parseHotelDate } from "../dailyPlanEffects/hotelDate";

/**
 * Create an assigned cleaning task for a room/date.
 * Enforces one active task per room/date; future hotel dates stay unbound (cycle 0).
 */
export async function createCleaningTask(input: {
  locationId: string;
  /** Hotel calendar day (YYYY-MM-DD) for one-active-task-per-room/date. */
  hotelDate: string;
  priority?: "low" | "normal" | "high" | "urgent";
  assignedEmployeeId?: string;
  shiftId?: string | null;
  dueAt?: string;
  serviceType?: CleaningServiceType;
  actorEmployeeId?: string;
}) {
  // Parse YYYY-MM-DD as UTC midnight for the hotelDate column.
  const hotelDate = parseHotelDate(input.hotelDate);
  // Null/undefined shift ok; reject inactive shift ids.
  const shiftId = await assertActiveShiftId(input.shiftId);

  // Optional assignee must be an active employee with cleaning capability.
  if (input.assignedEmployeeId) {
    // Await async persistence or side effect.
    await assertActiveCleaningAssignee(input.assignedEmployeeId);
  }

  try {
    // Serialize create against concurrent tasks for the same location.
    const task = await prisma.$transaction(async (tx) => {
      // Await async persistence or side effect.
      await lockLocation(tx, input.locationId);

      // Snapshot after Location lock so concurrent membership moves are visible.
      const sectorSnap = await sectorSnapshotForLocation(input.locationId, tx);

      // Load location after lock for catalog/kind checks.
      const location = await tx.location.findUnique({
        where: { id: input.locationId },
      });
      // Guard / branch on preconditions.
      if (!location) {
        // Fail closed with structured AppError.
        throw new AppError(404, "not_found", "Room not found");
      }
      // Archived rooms cannot receive new cleaning work.
      if (location.catalogStatus !== "active") {
        // Fail closed with structured AppError.
        throw new AppError(400, "invalid_state", "Room is archived");
      }

      // Enforce one active task per room/date (also backed by unique index).
      const existing = await tx.cleaningTask.findFirst({
        where: {
          locationId: input.locationId,
          hotelDate,
          status: { in: [...ACTIVE_TASK_STATUSES] },
        },
      });
      // Guard / branch on preconditions.
      if (existing) {
        // Fail closed with structured AppError.
        throw new AppError(
          409,
          "conflict",
          "Active cleaning task already exists for this room/date",
        );
      }

      // Re-check after location lock so a concurrent block/role change cannot slip in.
      if (input.assignedEmployeeId) {
        await assertActiveCleaningAssignee(input.assignedEmployeeId, tx);
      }

      // Current cycle for today; future hotel dates stay unbound (cycle 0).
      const cleaningCycle = await resolveCycleForNewTask(
        tx,
        location.id,
        hotelDate,
      );

      // Derive stayover/checkout/etc. from location kind + optional override.
      const serviceType = deriveCleaningServiceType({
        locationKind: location.kind,
        serviceType: input.serviceType,
      });

      // Persist the new assigned task with sector snapshot fields.
      const created = await tx.cleaningTask.create({
        data: {
          locationId: input.locationId,
          // Historical data-scope snapshot at create time.
          sectorId: sectorSnap.sectorId,
          sectorSupervisorEmployeeId: sectorSnap.sectorSupervisorEmployeeId,
          hotelDate,
          serviceType,
          priority: input.priority ?? "normal",
          assignedEmployeeId: input.assignedEmployeeId,
          shiftId: shiftId ?? null,
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          status: TaskStatus.assigned,
          // Cycle 0 for future hotel dates; current cycle for today.
          cleaningCycle,
        },
        include: taskInclude,
      });

      // Audit create with key assignment fields.
      await recordAudit({
        actorEmployeeId: input.actorEmployeeId,
        action: "cleaning.task.create",
        entityType: "cleaning_task",
        entityId: created.id,
        locationId: created.locationId,
        after: {
          status: created.status,
          serviceType: created.serviceType,
          priority: created.priority,
          assignedEmployeeId: created.assignedEmployeeId,
          shiftId: created.shiftId,
          hotelDate: input.hotelDate,
        },
        summary: `Created cleaning task for ${created.location.number}`,
      }, tx);

      // Return result to caller.
      return created;
    });

    // Notify live boards of the new task.
    publish("cleaning.changed", {
      locationId: task.locationId,
      taskId: task.id,
    });
    // Notify the assignee when one was set at create time.
    if (task.assignedEmployeeId) {
      // Await async persistence or side effect.
      await createNotifications({
        type: "cleaning.assigned",
        title: "Cleaning task assigned",
        body: `Room ${task.location.number} assigned to you`,
        entityType: "cleaning_task",
        entityId: task.id,
        locationId: task.locationId,
        actorEmployeeId: input.actorEmployeeId ?? null,
        recipientEmployeeIds: [task.assignedEmployeeId],
        dedupeKey: `cleaning.assigned:${task.id}:${task.assignedEmployeeId}`,
        payload: {
          panel: "mywork",
          taskId: task.id,
          locationId: task.locationId,
          locationNumber: task.location.number,
        },
      });
    }
    // Return result to caller.
    return task;
  } catch (err) {
    // Map unique conflicts (active room/date) to AppError.
    if (isP2002(err)) {
      mapCreateTaskUniqueConflict(err);
    }
    // Step in workflow.
    throw err;
  }
}

/**
 * Reassign an eligible task (assigned/rework/awaiting_inspection) with a required
 * reason. Blocked while a session is running; bumps version via claimTaskStatus.
 */
export async function reassignCleaningTask(input: {
  taskId: string;
  assignedEmployeeId: string;
  /** Required audit note — stored on task.reassignReason. */
  reason: string;
  shiftId?: string | null;
  expectedVersion?: number;
  actorEmployeeId?: string;
}) {
  // Reason is required for audit / accountability.
  if (!input.reason.trim()) {
    // Fail closed with structured AppError.
    throw new AppError(400, "validation", "Reassign reason is required");
  }

  // New assignee must be an active cleaning-capable employee.
  await assertActiveCleaningAssignee(input.assignedEmployeeId);

  // Null/undefined shift ok; reject inactive shift ids.
  const shiftId = await assertActiveShiftId(input.shiftId);

  // Serialize reassign against concurrent session/task mutations.
  const updated = await prisma.$transaction(async (tx) => {
    // Await async persistence or side effect.
    await lockTask(tx, input.taskId);

    // Load task after lock for status/version checks.
    const task = await tx.cleaningTask.findUnique({
      where: { id: input.taskId },
    });
    // Guard / branch on preconditions.
    if (!task) {
      // Fail closed with structured AppError.
      throw new AppError(404, "not_found", "Task not found");
    }
    // Only idle/review states may be reassigned (not in_progress).
    if (
      task.status !== TaskStatus.assigned &&
      task.status !== TaskStatus.rework &&
      task.status !== TaskStatus.awaiting_inspection
    ) {
      // Fail closed with structured AppError.
      throw new AppError(
        409,
        "invalid_state",
        `Cannot reassign task in status ${task.status}`,
      );
    }
    // Offline clients: reject when expectedVersion is stale.
    assertTaskVersion(task, input.expectedVersion);

    // Block reassign while a cleaner is actively working the task.
    const running = await tx.cleaningSession.findFirst({
      where: { taskId: task.id, status: SessionStatus.running },
    });
    // Guard / branch on preconditions.
    if (running) {
      // Fail closed with structured AppError.
      throw new AppError(
        409,
        "conflict",
        "Cannot reassign while a session is running",
      );
    }

    // Re-check after task lock so a concurrent block/role change cannot slip in.
    await assertActiveCleaningAssignee(input.assignedEmployeeId, tx);

    // Build the claim payload: new assignee + trimmed reason.
    const data: Prisma.CleaningTaskUncheckedUpdateManyInput = {
      assignedEmployeeId: input.assignedEmployeeId,
      // Persist trimmed reason on the task row for UI/history.
      reassignReason: input.reason.trim(),
    };
    // Only overwrite shift when the caller supplied a shiftId argument.
    if (shiftId !== undefined) {
      data.shiftId = shiftId;
    }

    // Historical snapshots are frozen at create time (P1-62). Do not backfill
    // null sectorId / sectorSupervisorEmployeeId from live membership on reassign
    // — null is a valid historical state (unassigned room or no primary).

    // Conditional claim bumps version and applies assignee/shift/reason.
    await claimTaskStatus(
      tx,
      task.id,
      [
        TaskStatus.assigned,
        TaskStatus.rework,
        // Supervisors may reassign while awaiting inspection.
        TaskStatus.awaiting_inspection,
      ],
      data,
      input.expectedVersion,
    );

    // Reload with includes for the API / notification payload.
    const result = await tx.cleaningTask.findUniqueOrThrow({
      where: { id: task.id },
      include: taskInclude,
    });

    // Audit before/after assignee and shift.
    await recordAudit({
      actorEmployeeId: input.actorEmployeeId,
      action: "cleaning.task.reassign",
      entityType: "cleaning_task",
      entityId: result.id,
      locationId: result.locationId,
      reason: input.reason,
      before: {
        assignedEmployeeId: task.assignedEmployeeId,
        shiftId: task.shiftId,
      },
      after: {
        assignedEmployeeId: input.assignedEmployeeId,
        shiftId: result.shiftId,
      },
      summary: `Reassigned cleaning ${result.location.number}`,
    }, tx);

    // Return result to caller.
    return result;
  });

  // Notify live boards of the reassignment.
  publish("cleaning.changed", {
    locationId: updated.locationId,
    taskId: updated.id,
  });
  // Notify the new assignee (dedupe includes updatedAt for repeat reassigns).
  await createNotifications({
    type: "cleaning.assigned",
    title: "Cleaning task reassigned",
    body: `Room ${updated.location.number} assigned to you`,
    entityType: "cleaning_task",
    entityId: updated.id,
    locationId: updated.locationId,
    actorEmployeeId: input.actorEmployeeId ?? null,
    recipientEmployeeIds: [input.assignedEmployeeId],
    dedupeKey: `cleaning.reassigned:${updated.id}:${input.assignedEmployeeId}:${updated.updatedAt.toISOString()}`,
    payload: {
      panel: "mywork",
      taskId: updated.id,
      locationId: updated.locationId,
      locationNumber: updated.location.number,
    },
  });
  // Return result to caller.
  return updated;
}
