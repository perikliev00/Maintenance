/**
 * Create and reassign cleaning tasks with cycle allocation, sector snapshot,
 * assignee checks, and optimistic version claims on reassign.
 */
// Task/session enums and unchecked update input types.
import {
  CleaningServiceType,
  Prisma,
  Role,
  SessionStatus,
  TaskStatus,
// Execute: } from "@prisma/client";
} from "@prisma/client";
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
// Side-effect or default import required by this module.
import {
  assertReassignAvailability,
  evaluateEmployeeAvailability,
// Execute: } from "../housekeepers";
} from "../housekeepers";
// Module dependency import.
import { taskInclude } from "../cleaningTasksQuery";
// Module dependency import.
import { assertActiveShiftId } from "../shifts";
// Module dependency import.
import { assertTaskVersion, claimTaskStatus } from "./claims";
// Import ./cycles for cleaning/tasks.ts.
import { resolveCycleForNewTask } from "./cycles";
// Import ./deriveServiceType for cleaning/tasks.ts.
import { deriveCleaningServiceType } from "./deriveServiceType";
// Import ./locks for cleaning/tasks.ts.
import { lockTask, lockLocation } from "./locks";
// Import ./prismaConflicts for cleaning/tasks.ts.
import { isP2002, mapCreateTaskUniqueConflict } from "./prismaConflicts";
// Import ../dailyPlanEffects/hotelDate for cleaning/tasks.ts.
import { parseHotelDate } from "../dailyPlanEffects/hotelDate";
// Import ../liveAccessLocks for cleaning/tasks.ts.
import { lockEmployeesForLiveAccess } from "../liveAccessLocks";

/**
 * Create an assigned cleaning task for a room/date.
 * Enforces one active task per room/date; future hotel dates stay unbound (cycle 0).
 */
export async function createCleaningTask(input: {
  locationId: string;
  /** Hotel calendar day (YYYY-MM-DD) for one-active-task-per-room/date. */
  hotelDate: string;
  // Parameter/field in the surrounding signature or type.
  priority?: "low" | "normal" | "high" | "urgent";
  // Parameter/field in the surrounding signature or type.
  assignedEmployeeId?: string;
  // Parameter/field in the surrounding signature or type.
  shiftId?: string | null;
  // Parameter/field in the surrounding signature or type.
  dueAt?: string;
  // Parameter/field in the surrounding signature or type.
  serviceType?: CleaningServiceType;
  // Parameter/field in the surrounding signature or type.
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

  // Isolate fallible work so conflicts can be mapped cleanly.
  try {
    // Serialize create against concurrent tasks for the same location.
    const task = await prisma.$transaction(async (tx) => {
      // Await async persistence or side effect.
      await lockLocation(tx, input.locationId);

      // Snapshot after Location lock so concurrent membership moves are visible.
      const sectorSnap = await sectorSnapshotForLocation(input.locationId, tx);

      // Load location after lock for catalog/kind checks.
      const location = await tx.location.findUnique({
        // Restrict the query to the relevant rows only.
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
        // Restrict the query to the relevant rows only.
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
          // Execute: 409,
          409,
          // Execute: "conflict",
          "conflict",
          // Execute: "Active cleaning task already exists for this room/date",
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
        // Execute: location.id,
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
        // Fields written by this create/update.
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
        // Eager-load relations needed by the API response shape.
        include: taskInclude,
      });

      // Audit create with key assignment fields.
      await recordAudit({
        actorEmployeeId: input.actorEmployeeId,
        action: "cleaning.task.create",
        entityType: "cleaning_task",
        entityId: created.id,
        locationId: created.locationId,
        // Open nested structure for the next related fields.
        after: {
          status: created.status,
          serviceType: created.serviceType,
          priority: created.priority,
          assignedEmployeeId: created.assignedEmployeeId,
          shiftId: created.shiftId,
          hotelDate: input.hotelDate,
        },
        summary: `Created cleaning task for ${created.location.number}`,
      // Execute: }, tx);
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
        // Open nested structure for the next related fields.
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
      // Execute: mapCreateTaskUniqueConflict(err);
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
  // Parameter/field in the surrounding signature or type.
  shiftId?: string | null;
  // Parameter/field in the surrounding signature or type.
  expectedVersion?: number;
  // Parameter/field in the surrounding signature or type.
  actorEmployeeId?: string;
  /** Actor role for availability override authorization. */
  actorRole?: Role;
  /** Explicit override when replacement is not currently available. */
  forceDespiteAvailability?: boolean;
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
    // User locks before task lock (deadlock-safe vs SSE FOR SHARE).
    const preview = await tx.cleaningTask.findUnique({
      // Restrict the query to the relevant rows only.
      where: { id: input.taskId },
      // Project only the columns the caller needs.
      select: { assignedEmployeeId: true },
    });
    // Guard: handle missing/invalid state before continuing.
    if (!preview) {
      // Abort with an HTTP-mapped AppError or rethrow.
      throw new AppError(404, "not_found", "Task not found");
    }
    await lockEmployeesForLiveAccess(tx, [
      // Execute: preview.assignedEmployeeId,
      preview.assignedEmployeeId,
      // Execute: input.assignedEmployeeId,
      input.assignedEmployeeId,
    ]);
    await lockTask(tx, input.taskId);

    // Load task after lock for status/version checks.
    const task = await tx.cleaningTask.findUnique({
      // Restrict the query to the relevant rows only.
      where: { id: input.taskId },
    });
    // Guard / branch on preconditions.
    if (!task) {
      // Fail closed with structured AppError.
      throw new AppError(404, "not_found", "Task not found");
    }
    // Assignee changed under us to someone we did not lock — fail closed.
    if (
      // Execute: task.assignedEmployeeId &&
      task.assignedEmployeeId &&
      // Execute: task.assignedEmployeeId !== preview.assignedEmployeeId &&
      task.assignedEmployeeId !== preview.assignedEmployeeId &&
      // Execute: task.assignedEmployeeId !== input.assignedEmployeeId
      task.assignedEmployeeId !== input.assignedEmployeeId
    ) {
      // Abort with an HTTP-mapped AppError or rethrow.
      throw new AppError(
        // Execute: 409,
        409,
        // Execute: "conflict",
        "conflict",
        // Execute: "Task assignee changed concurrently; retry",
        "Task assignee changed concurrently; retry",
      );
    }
    // Only idle/review states may be reassigned (not in_progress).
    if (
      // Execute: task.status !== TaskStatus.assigned &&
      task.status !== TaskStatus.assigned &&
      // Execute: task.status !== TaskStatus.rework &&
      task.status !== TaskStatus.rework &&
      // Execute: task.status !== TaskStatus.awaiting_inspection
      task.status !== TaskStatus.awaiting_inspection
    ) {
      // Fail closed with structured AppError.
      throw new AppError(
        // Execute: 409,
        409,
        // Execute: "invalid_state",
        "invalid_state",
        // Execute: `Cannot reassign task in status ${task.status}`,
        `Cannot reassign task in status ${task.status}`,
      );
    }
    // Offline clients: reject when expectedVersion is stale.
    assertTaskVersion(task, input.expectedVersion);

    // Block reassign while a cleaner is actively working the task.
    const running = await tx.cleaningSession.findFirst({
      // Restrict the query to the relevant rows only.
      where: { taskId: task.id, status: SessionStatus.running },
    });
    // Guard / branch on preconditions.
    if (running) {
      // Fail closed with structured AppError.
      throw new AppError(
        // Execute: 409,
        409,
        // Execute: "conflict",
        "conflict",
        // Execute: "Cannot reassign while a session is running",
        "Cannot reassign while a session is running",
      );
    }

    // Re-check after task lock so a concurrent block/role change cannot slip in.
    await assertActiveCleaningAssignee(input.assignedEmployeeId, tx);

    // Server-authoritative availability (stale frontend list is never trusted).
    const availability = await evaluateEmployeeAvailability(
      // Execute: input.assignedEmployeeId,
      input.assignedEmployeeId,
      // Execute: { db: tx },
      { db: tx },
    );
    assertReassignAvailability({
      availability,
      forceDespiteAvailability: input.forceDespiteAvailability === true,
      actorRole: input.actorRole,
    });

    // Build the claim payload: new assignee + trimmed reason.
    const data: Prisma.CleaningTaskUncheckedUpdateManyInput = {
      assignedEmployeeId: input.assignedEmployeeId,
      // Persist trimmed reason on the task row for UI/history.
      reassignReason: input.reason.trim(),
    };
    // Only overwrite shift when the caller supplied a shiftId argument.
    if (shiftId !== undefined) {
      // Execute: data.shiftId = shiftId;
      data.shiftId = shiftId;
    }

    // Historical snapshots are frozen at create time (P1-62). Do not backfill
    // null sectorId / sectorSupervisorEmployeeId from live membership on reassign
    // — null is a valid historical state (unassigned room or no primary).

    // Conditional claim bumps version and applies assignee/shift/reason.
    await claimTaskStatus(
      tx,
      // Execute: task.id,
      task.id,
      // Begin list of values/items for this step.
      [
        // Execute: TaskStatus.assigned,
        TaskStatus.assigned,
        // Execute: TaskStatus.rework,
        TaskStatus.rework,
        // Supervisors may reassign while awaiting inspection.
        TaskStatus.awaiting_inspection,
      ],
      data,
      // Execute: input.expectedVersion,
      input.expectedVersion,
    );

    // Reload with includes for the API / notification payload.
    const result = await tx.cleaningTask.findUniqueOrThrow({
      // Restrict the query to the relevant rows only.
      where: { id: task.id },
      // Eager-load relations needed by the API response shape.
      include: taskInclude,
    });

    const forced =
      // Execute: input.forceDespiteAvailability === true &&
      input.forceDespiteAvailability === true &&
      // Execute: availability != null &&
      availability != null &&
      // Execute: availability.availabilityStatus !== "available";
      availability.availabilityStatus !== "available";

    // Audit before/after assignee and shift.
    await recordAudit({
      actorEmployeeId: input.actorEmployeeId,
      action: "cleaning.task.reassign",
      entityType: "cleaning_task",
      entityId: result.id,
      locationId: result.locationId,
      reason: input.reason,
      // Open nested structure for the next related fields.
      before: {
        assignedEmployeeId: task.assignedEmployeeId,
        shiftId: task.shiftId,
      },
      // Open nested structure for the next related fields.
      after: {
        assignedEmployeeId: input.assignedEmployeeId,
        shiftId: result.shiftId,
        // Continue the previous expression with this clause.
        ...(forced
          ? {
              availabilityOverride: true,
              availabilityStatus: availability.availabilityStatus,
              availabilityReasons: availability.availabilityReasons,
            }
          // Continue the previous expression with this clause.
          : {}),
      },
      summary: forced
        // Continue the previous expression with this clause.
        ? `Reassigned cleaning ${result.location.number} (availability override)`
        // Continue the previous expression with this clause.
        : `Reassigned cleaning ${result.location.number}`,
    // Execute: }, tx);
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
    // Open nested structure for the next related fields.
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
