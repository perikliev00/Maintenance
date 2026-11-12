/**
 * Cleaning-task helpers used when plan entries create or link work.
 */
import {
  // Carry this field through the payload or query.
  DailyPlanCategory,
  // Carry this field through the payload or query.
  LocationKind,
  // Carry this field through the payload or query.
  Priority,
  // Carry this field through the payload or query.
  Prisma,
  // Carry this field through the payload or query.
  TaskStatus,
// Execute: } from "@prisma/client";
} from "@prisma/client";
// Import ../../constants for dailyPlanEffects/tasks.ts.
import { ACTIVE_TASK_STATUSES } from "../../constants";
// Import ../assignees for dailyPlanEffects/tasks.ts.
import { assertActiveCleaningAssignee } from "../assignees";
// Side-effect or default import required by this module.
import {
  // Carry this field through the payload or query.
  deriveCleaningServiceType,
  // Carry this field through the payload or query.
  resolveCycleForNewTask,
// Execute: } from "../cleaning";
} from "../cleaning";
// Import ../db/prismaErrors for dailyPlanEffects/tasks.ts.
import { isP2002 } from "../db/prismaErrors";
// Import ../dataScope for dailyPlanEffects/tasks.ts.
import { sectorSnapshotForLocation } from "../dataScope";
// Type-only import from ./types used by dailyPlanEffects/tasks.ts.
import type { Tx } from "./types";

/** Numeric order so plan effects only bump priority upward. */
export const PRIORITY_RANK: Record<Priority, number> = {
  // Field value required by this payload or query.
  low: 0,
  // Field value required by this payload or query.
  normal: 1,
  // Field value required by this payload or query.
  high: 2,
  // Field value required by this payload or query.
  urgent: 3,
};

/**
 * Connect assignee/shift onto an update payload only when the task lacks them
 * (does not overwrite an existing assignment).
 */
export function connectAssigneeAndShift(
  // Fields written by this create/update.
  data: Prisma.CleaningTaskUpdateInput,
  // Field value required by this payload or query.
  task: { assignedEmployeeId: string | null; shiftId: string | null },
  // Parameter/field in the surrounding signature or type.
  assignedEmployeeId?: string,
  // Parameter/field in the surrounding signature or type.
  shiftId?: string | null,
// Begin block/object for the following statements.
) {
  // Fill assignee only if the task is currently unassigned.
  if (assignedEmployeeId && !task.assignedEmployeeId) {
    // Execute: data.assignedEmployee = { connect: { id: assignedEmployeeId } };
    data.assignedEmployee = { connect: { id: assignedEmployeeId } };
  }
  // Fill shift only if the task has no shift yet.
  if (shiftId && !task.shiftId) {
    // Execute: data.shift = { connect: { id: shiftId } };
    data.shift = { connect: { id: shiftId } };
  }
}

/**
 * Create a cleaning task with sector snapshot + derived service type.
 * On unique race, return the existing active task for the room/date.
 */
export async function createTaskWithSectorSnapshot(
  // Carry this field through the payload or query.
  tx: Tx,
  // Fields written by this create/update.
  data: {
    // Carry this field through the payload or query.
    locationId: string;
    // Carry this field through the payload or query.
    hotelDate: Date;
    // Carry this field through the payload or query.
    priority: Priority;
    // Parameter/field in the surrounding signature or type.
    assignedEmployeeId?: string;
    // Parameter/field in the surrounding signature or type.
    shiftId?: string | null;
    // Carry this field through the payload or query.
    locationKind: LocationKind;
    // Carry this field through the payload or query.
    planCategory: DailyPlanCategory;
  },
// Begin block/object for the following statements.
) {
  // Analytics/work-type from room kind + plan category (departure vs stayover, etc.).
  const serviceType = deriveCleaningServiceType({
    // Carry this field through the payload or query.
    locationKind: data.locationKind,
    // Carry this field through the payload or query.
    planCategory: data.planCategory,
  });
  // Bind task to the location's current cleaning cycle generation.
  // resolveCycleForNewTask locks Location — re-check active task under that lock
  // so a concurrent winner that already committed is visible before we insert.
  const cleaningCycle = await resolveCycleForNewTask(
    // Carry this field through the payload or query.
    tx,
    // Execute: data.locationId,
    data.locationId,
    // Execute: data.hotelDate,
    data.hotelDate,
  );
  // Snapshot after Location lock so concurrent membership moves are visible.
  const snap = await sectorSnapshotForLocation(data.locationId, tx);
  // Load preexisting needed for the next decision or write.
  const preexisting = await tx.cleaningTask.findFirst({
    // Restrict the query to the relevant rows only.
    where: {
      // Carry this field through the payload or query.
      locationId: data.locationId,
      // Carry this field through the payload or query.
      hotelDate: data.hotelDate,
      // Carry this field through the payload or query.
      status: { in: [...ACTIVE_TASK_STATUSES] },
    },
  });
  // Branch when this condition holds for the domain rule.
  if (preexisting) {
    // Return the computed result to the caller.
    return preexisting;
  }
  // Isolate fallible work so conflicts can be mapped cleanly.
  try {
    // Await and return the operation result to the caller.
    return await tx.cleaningTask.create({
      // Fields written by this create/update.
      data: {
        // Carry this field through the payload or query.
        locationId: data.locationId,
        // Carry this field through the payload or query.
        hotelDate: data.hotelDate,
        // Carry this field through the payload or query.
        priority: data.priority,
        // Carry this field through the payload or query.
        assignedEmployeeId: data.assignedEmployeeId,
        // Field value required by this payload or query.
        shiftId: data.shiftId ?? null,
        // Carry this field through the payload or query.
        status: TaskStatus.assigned,
        // Carry this field through the payload or query.
        serviceType,
        // Carry this field through the payload or query.
        sectorId: snap.sectorId,
        // Carry this field through the payload or query.
        sectorSupervisorEmployeeId: snap.sectorSupervisorEmployeeId,
        // Carry this field through the payload or query.
        cleaningCycle,
      },
    });
  // Begin block/object for the following statements.
  } catch (err) {
    // Concurrent create hit the partial unique (one active task per room/date).
    // Prefer the under-lock re-check above; this path is belt-and-suspenders when
    // the peer commit lands between findFirst and create (same lock holder).
    if (isP2002(err)) {
      // Load existing needed for the next decision or write.
      const existing = await tx.cleaningTask.findFirst({
        // Restrict the query to the relevant rows only.
        where: {
          // Carry this field through the payload or query.
          locationId: data.locationId,
          // Carry this field through the payload or query.
          hotelDate: data.hotelDate,
          // Carry this field through the payload or query.
          status: { in: [...ACTIVE_TASK_STATUSES] },
        },
      });
      // Branch when this condition holds for the domain rule.
      if (existing) {
        // Return the computed result to the caller.
        return existing;
      }
    }
    // Non-unique errors (or unique without a recoverable row) propagate.
    throw err;
  }
}

/**
 * Link an active cleaning task or create a high-priority departure task,
 * reusing assignee/shift when the task is unbound.
 */
export async function linkOrCreateDepartureTask(
  // Carry this field through the payload or query.
  tx: Tx,
  // Open nested structure for the next related fields.
  input: {
    // Carry this field through the payload or query.
    locationId: string;
    // Carry this field through the payload or query.
    locationKind: LocationKind;
    // Carry this field through the payload or query.
    hotelDate: Date;
    // Parameter/field in the surrounding signature or type.
    assignedEmployeeId?: string;
    // Parameter/field in the surrounding signature or type.
    shiftId?: string | null;
    // Parameter/field in the surrounding signature or type.
    existingCleaningTaskId?: string | null;
  },
// Begin block/object for the following statements.
): Promise<string | null> {
  // Capture assignedEmployeeId for subsequent checks or writes.
  const assignedEmployeeId = input.assignedEmployeeId;
  // A deferred departure can outlive the assignee's eligibility.
  if (assignedEmployeeId) {
    // Await side effect or helper before continuing.
    await assertActiveCleaningAssignee(assignedEmployeeId, tx);
  }
  // Capture shiftId for subsequent checks or writes.
  const shiftId = input.shiftId;

  // Prefer the task already linked on the plan entry, if still active.
  if (input.existingCleaningTaskId) {
    // Load existing needed for the next decision or write.
    const existing = await tx.cleaningTask.findFirst({
      // Restrict the query to the relevant rows only.
      where: {
        // Carry this field through the payload or query.
        id: input.existingCleaningTaskId,
        // Carry this field through the payload or query.
        status: { in: [...ACTIVE_TASK_STATUSES] },
      },
    });
    // Branch when this condition holds for the domain rule.
    if (existing) {
      // Execute: const data: Prisma.CleaningTaskUpdateInput = {};
      const data: Prisma.CleaningTaskUpdateInput = {};
      // Departure work should be at least high priority.
      if (PRIORITY_RANK[existing.priority] < PRIORITY_RANK[Priority.high]) {
        // Execute: data.priority = Priority.high;
        data.priority = Priority.high;
      }
      // Attach plan assignee/shift only when the task is unbound.
      connectAssigneeAndShift(data, existing, assignedEmployeeId, shiftId);
      // Branch when this condition holds for the domain rule.
      if (Object.keys(data).length) {
        // Persist the mutation inside the current transaction/context.
        await tx.cleaningTask.update({ where: { id: existing.id }, data });
      }
      // Return the computed result to the caller.
      return existing.id;
    }
  }

  // Fall back to any active task for this room/date (may not be linked yet).
  const activeTask = await tx.cleaningTask.findFirst({
    // Restrict the query to the relevant rows only.
    where: {
      // Carry this field through the payload or query.
      locationId: input.locationId,
      // Carry this field through the payload or query.
      hotelDate: input.hotelDate,
      // Carry this field through the payload or query.
      status: { in: [...ACTIVE_TASK_STATUSES] },
    },
  });

  // Branch when this condition holds for the domain rule.
  if (activeTask) {
    // Execute: const data: Prisma.CleaningTaskUpdateInput = {};
    const data: Prisma.CleaningTaskUpdateInput = {};
    // Same priority/assignee fill as the linked-task path.
    if (PRIORITY_RANK[activeTask.priority] < PRIORITY_RANK[Priority.high]) {
      // Execute: data.priority = Priority.high;
      data.priority = Priority.high;
    }
    // Execute: connectAssigneeAndShift(data, activeTask, assignedEmployeeId, shiftId);
    connectAssigneeAndShift(data, activeTask, assignedEmployeeId, shiftId);
    // Branch when this condition holds for the domain rule.
    if (Object.keys(data).length) {
      // Persist the mutation inside the current transaction/context.
      await tx.cleaningTask.update({ where: { id: activeTask.id }, data });
    }
    // Return the computed result to the caller.
    return activeTask.id;
  }

  // No active task — create a high-priority departure task with sector snapshot.
  const created = await createTaskWithSectorSnapshot(tx, {
    // Carry this field through the payload or query.
    locationId: input.locationId,
    // Carry this field through the payload or query.
    hotelDate: input.hotelDate,
    // Carry this field through the payload or query.
    priority: Priority.high,
    // Carry this field through the payload or query.
    assignedEmployeeId,
    // Carry this field through the payload or query.
    shiftId,
    // Carry this field through the payload or query.
    locationKind: input.locationKind,
    // Carry this field through the payload or query.
    planCategory: DailyPlanCategory.departure,
  });
  // Return the computed result to the caller.
  return created.id;
}
