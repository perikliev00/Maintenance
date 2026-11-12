/**
 * Create and reassign cleaning tasks with cycle allocation, sector snapshot,
 * assignee checks, and optimistic version claims on reassign.
 */
// Task/session enums and unchecked update input types.
import {
  // Carry this field through the payload or query.
  CleaningServiceType,
  // Carry this field through the payload or query.
  Prisma,
  // Carry this field through the payload or query.
  Role,
  // Carry this field through the payload or query.
  SessionStatus,
  // Carry this field through the payload or query.
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
  // Carry this field through the payload or query.
  assertReassignAvailability,
  // Carry this field through the payload or query.
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
  // Carry this field through the payload or query.
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
// Begin block/object for the following statements.
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
          // Carry this field through the payload or query.
          locationId: input.locationId,
          // Carry this field through the payload or query.
          hotelDate,
          // Carry this field through the payload or query.
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
        // Await side effect or helper before continuing.
        await assertActiveCleaningAssignee(input.assignedEmployeeId, tx);
      }

      // Current cycle for today; future hotel dates stay unbound (cycle 0).
      const cleaningCycle = await resolveCycleForNewTask(
        // Carry this field through the payload or query.
        tx,
        // Execute: location.id,
        location.id,
        // Carry this field through the payload or query.
        hotelDate,
      );

      // Derive stayover/checkout/etc. from location kind + optional override.
      const serviceType = deriveCleaningServiceType({
        // Carry this field through the payload or query.
        locationKind: location.kind,
        // Carry this field through the payload or query.
        serviceType: input.serviceType,
      });

      // Persist the new assigned task with sector snapshot fields.
      const created = await tx.cleaningTask.create({
        // Fields written by this create/update.
        data: {
          // Carry this field through the payload or query.
          locationId: input.locationId,
          // Historical data-scope snapshot at create time.
          sectorId: sectorSnap.sectorId,
          // Carry this field through the payload or query.
          sectorSupervisorEmployeeId: sectorSnap.sectorSupervisorEmployeeId,
          // Carry this field through the payload or query.
          hotelDate,
          // Carry this field through the payload or query.
          serviceType,
          // Field value required by this payload or query.
          priority: input.priority ?? "normal",
          // Carry this field through the payload or query.
          assignedEmployeeId: input.assignedEmployeeId,
          // Field value required by this payload or query.
          shiftId: shiftId ?? null,
          // Field value required by this payload or query.
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          // Carry this field through the payload or query.
          status: TaskStatus.assigned,
          // Cycle 0 for future hotel dates; current cycle for today.
          cleaningCycle,
        },
        // Eager-load relations needed by the API response shape.
        include: taskInclude,
      });

      // Audit create with key assignment fields.
      await recordAudit({
        // Carry this field through the payload or query.
        actorEmployeeId: input.actorEmployeeId,
        // Field value required by this payload or query.
        action: "cleaning.task.create",
        // Field value required by this payload or query.
        entityType: "cleaning_task",
        // Carry this field through the payload or query.
        entityId: created.id,
        // Carry this field through the payload or query.
        locationId: created.locationId,
        // Open nested structure for the next related fields.
        after: {
          // Carry this field through the payload or query.
          status: created.status,
          // Carry this field through the payload or query.
          serviceType: created.serviceType,
          // Carry this field through the payload or query.
          priority: created.priority,
          // Carry this field through the payload or query.
          assignedEmployeeId: created.assignedEmployeeId,
          // Carry this field through the payload or query.
          shiftId: created.shiftId,
          // Carry this field through the payload or query.
          hotelDate: input.hotelDate,
        },
        // Field value required by this payload or query.
        summary: `Created cleaning task for ${created.location.number}`,
      // Execute: }, tx);
      }, tx);

      // Return result to caller.
      return created;
    });

    // Notify live boards of the new task.
    publish("cleaning.changed", {
      // Carry this field through the payload or query.
      locationId: task.locationId,
      // Carry this field through the payload or query.
      taskId: task.id,
    });
    // Notify the assignee when one was set at create time.
    if (task.assignedEmployeeId) {
      // Await async persistence or side effect.
      await createNotifications({
        // Field value required by this payload or query.
        type: "cleaning.assigned",
        // Field value required by this payload or query.
        title: "Cleaning task assigned",
        // Field value required by this payload or query.
        body: `Room ${task.location.number} assigned to you`,
        // Field value required by this payload or query.
        entityType: "cleaning_task",
        // Carry this field through the payload or query.
        entityId: task.id,
        // Carry this field through the payload or query.
        locationId: task.locationId,
        // Field value required by this payload or query.
        actorEmployeeId: input.actorEmployeeId ?? null,
        // Carry this field through the payload or query.
        recipientEmployeeIds: [task.assignedEmployeeId],
        // Field value required by this payload or query.
        dedupeKey: `cleaning.assigned:${task.id}:${task.assignedEmployeeId}`,
        // Open nested structure for the next related fields.
        payload: {
          // Field value required by this payload or query.
          panel: "mywork",
          // Carry this field through the payload or query.
          taskId: task.id,
          // Carry this field through the payload or query.
          locationId: task.locationId,
          // Carry this field through the payload or query.
          locationNumber: task.location.number,
        },
      });
    }
    // Return result to caller.
    return task;
  // Begin block/object for the following statements.
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
  // Carry this field through the payload or query.
  taskId: string;
  // Carry this field through the payload or query.
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
// Begin block/object for the following statements.
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
    // Await side effect or helper before continuing.
    await lockEmployeesForLiveAccess(tx, [
      // Execute: preview.assignedEmployeeId,
      preview.assignedEmployeeId,
      // Execute: input.assignedEmployeeId,
      input.assignedEmployeeId,
    ]);
    // Await side effect or helper before continuing.
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
    // Begin block/object for the following statements.
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
    // Begin block/object for the following statements.
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
    // Begin block/object for the following statements.
    assertReassignAvailability({
      // Carry this field through the payload or query.
      availability,
      // Field value required by this payload or query.
      forceDespiteAvailability: input.forceDespiteAvailability === true,
      // Carry this field through the payload or query.
      actorRole: input.actorRole,
    });

    // Build the claim payload: new assignee + trimmed reason.
    const data: Prisma.CleaningTaskUncheckedUpdateManyInput = {
      // Carry this field through the payload or query.
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
      // Carry this field through the payload or query.
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
      // Carry this field through the payload or query.
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

    // Capture forced for subsequent checks or writes.
    const forced =
      // Execute: input.forceDespiteAvailability === true &&
      input.forceDespiteAvailability === true &&
      // Execute: availability != null &&
      availability != null &&
      // Execute: availability.availabilityStatus !== "available";
      availability.availabilityStatus !== "available";

    // Audit before/after assignee and shift.
    await recordAudit({
      // Carry this field through the payload or query.
      actorEmployeeId: input.actorEmployeeId,
      // Field value required by this payload or query.
      action: "cleaning.task.reassign",
      // Field value required by this payload or query.
      entityType: "cleaning_task",
      // Carry this field through the payload or query.
      entityId: result.id,
      // Carry this field through the payload or query.
      locationId: result.locationId,
      // Carry this field through the payload or query.
      reason: input.reason,
      // Open nested structure for the next related fields.
      before: {
        // Carry this field through the payload or query.
        assignedEmployeeId: task.assignedEmployeeId,
        // Carry this field through the payload or query.
        shiftId: task.shiftId,
      },
      // Open nested structure for the next related fields.
      after: {
        // Carry this field through the payload or query.
        assignedEmployeeId: input.assignedEmployeeId,
        // Carry this field through the payload or query.
        shiftId: result.shiftId,
        // Continue the previous expression with this clause.
        ...(forced
          // Begin block/object for the following statements.
          ? {
              // Field value required by this payload or query.
              availabilityOverride: true,
              // Carry this field through the payload or query.
              availabilityStatus: availability.availabilityStatus,
              // Carry this field through the payload or query.
              availabilityReasons: availability.availabilityReasons,
            }
          // Continue the previous expression with this clause.
          : {}),
      },
      // Carry this field through the payload or query.
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
    // Carry this field through the payload or query.
    locationId: updated.locationId,
    // Carry this field through the payload or query.
    taskId: updated.id,
  });
  // Notify the new assignee (dedupe includes updatedAt for repeat reassigns).
  await createNotifications({
    // Field value required by this payload or query.
    type: "cleaning.assigned",
    // Field value required by this payload or query.
    title: "Cleaning task reassigned",
    // Field value required by this payload or query.
    body: `Room ${updated.location.number} assigned to you`,
    // Field value required by this payload or query.
    entityType: "cleaning_task",
    // Carry this field through the payload or query.
    entityId: updated.id,
    // Carry this field through the payload or query.
    locationId: updated.locationId,
    // Field value required by this payload or query.
    actorEmployeeId: input.actorEmployeeId ?? null,
    // Carry this field through the payload or query.
    recipientEmployeeIds: [input.assignedEmployeeId],
    // Field value required by this payload or query.
    dedupeKey: `cleaning.reassigned:${updated.id}:${input.assignedEmployeeId}:${updated.updatedAt.toISOString()}`,
    // Open nested structure for the next related fields.
    payload: {
      // Field value required by this payload or query.
      panel: "mywork",
      // Carry this field through the payload or query.
      taskId: updated.id,
      // Carry this field through the payload or query.
      locationId: updated.locationId,
      // Carry this field through the payload or query.
      locationNumber: updated.location.number,
    },
  });
  // Return result to caller.
  return updated;
}
