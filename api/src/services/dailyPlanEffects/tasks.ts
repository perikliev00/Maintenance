/**
 * Cleaning-task helpers used when plan entries create or link work.
 */
import {
  DailyPlanCategory,
  LocationKind,
  Priority,
  Prisma,
  TaskStatus,
} from "@prisma/client";
import { ACTIVE_TASK_STATUSES } from "../../constants";
import {
  deriveCleaningServiceType,
  resolveCycleForNewTask,
} from "../cleaning";
import { sectorSnapshotForLocation } from "../dataScope";
import type { Tx } from "./types";

/** Numeric order so plan effects only bump priority upward. */
export const PRIORITY_RANK: Record<Priority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  urgent: 3,
};

/**
 * Connect assignee/shift onto an update payload only when the task lacks them
 * (does not overwrite an existing assignment).
 */
export function connectAssigneeAndShift(
  data: Prisma.CleaningTaskUpdateInput,
  task: { assignedEmployeeId: string | null; shiftId: string | null },
  assignedEmployeeId?: string,
  shiftId?: string | null,
) {
  // Fill assignee only if the task is currently unassigned.
  if (assignedEmployeeId && !task.assignedEmployeeId) {
    data.assignedEmployee = { connect: { id: assignedEmployeeId } };
  }
  // Fill shift only if the task has no shift yet.
  if (shiftId && !task.shiftId) {
    data.shift = { connect: { id: shiftId } };
  }
}

/**
 * Create a cleaning task with sector snapshot + derived service type.
 * On unique race, return the existing active task for the room/date.
 */
export async function createTaskWithSectorSnapshot(
  tx: Tx,
  data: {
    locationId: string;
    hotelDate: Date;
    priority: Priority;
    assignedEmployeeId?: string;
    shiftId?: string | null;
    locationKind: LocationKind;
    planCategory: DailyPlanCategory;
  },
) {
  // Snapshot sector + supervisor at create time (stable if room later moves).
  const snap = await sectorSnapshotForLocation(data.locationId, tx);
  // Analytics/work-type from room kind + plan category (departure vs stayover, etc.).
  const serviceType = deriveCleaningServiceType({
    locationKind: data.locationKind,
    planCategory: data.planCategory,
  });
  // Bind task to the location's current cleaning cycle generation.
  const cleaningCycle = await resolveCycleForNewTask(
    tx,
    data.locationId,
    data.hotelDate,
  );
  try {
    return await tx.cleaningTask.create({
      data: {
        locationId: data.locationId,
        hotelDate: data.hotelDate,
        priority: data.priority,
        assignedEmployeeId: data.assignedEmployeeId,
        shiftId: data.shiftId ?? null,
        status: TaskStatus.assigned,
        serviceType,
        sectorId: snap.sectorId,
        sectorSupervisorEmployeeId: snap.sectorSupervisorEmployeeId,
        cleaningCycle,
      },
    });
  } catch (err) {
    // Concurrent create hit the partial unique (one active task per room/date).
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      // Return the winner of the race instead of failing the plan effect.
      const existing = await tx.cleaningTask.findFirst({
        where: {
          locationId: data.locationId,
          hotelDate: data.hotelDate,
          status: { in: [...ACTIVE_TASK_STATUSES] },
        },
      });
      if (existing) {
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
  tx: Tx,
  input: {
    locationId: string;
    locationKind: LocationKind;
    hotelDate: Date;
    assignedEmployeeId?: string;
    shiftId?: string | null;
    existingCleaningTaskId?: string | null;
  },
): Promise<string | null> {
  const assignedEmployeeId = input.assignedEmployeeId;
  const shiftId = input.shiftId;

  // Prefer the task already linked on the plan entry, if still active.
  if (input.existingCleaningTaskId) {
    const existing = await tx.cleaningTask.findFirst({
      where: {
        id: input.existingCleaningTaskId,
        status: { in: [...ACTIVE_TASK_STATUSES] },
      },
    });
    if (existing) {
      const data: Prisma.CleaningTaskUpdateInput = {};
      // Departure work should be at least high priority.
      if (PRIORITY_RANK[existing.priority] < PRIORITY_RANK[Priority.high]) {
        data.priority = Priority.high;
      }
      // Attach plan assignee/shift only when the task is unbound.
      connectAssigneeAndShift(data, existing, assignedEmployeeId, shiftId);
      if (Object.keys(data).length) {
        await tx.cleaningTask.update({ where: { id: existing.id }, data });
      }
      return existing.id;
    }
  }

  // Fall back to any active task for this room/date (may not be linked yet).
  const activeTask = await tx.cleaningTask.findFirst({
    where: {
      locationId: input.locationId,
      hotelDate: input.hotelDate,
      status: { in: [...ACTIVE_TASK_STATUSES] },
    },
  });

  if (activeTask) {
    const data: Prisma.CleaningTaskUpdateInput = {};
    // Same priority/assignee fill as the linked-task path.
    if (PRIORITY_RANK[activeTask.priority] < PRIORITY_RANK[Priority.high]) {
      data.priority = Priority.high;
    }
    connectAssigneeAndShift(data, activeTask, assignedEmployeeId, shiftId);
    if (Object.keys(data).length) {
      await tx.cleaningTask.update({ where: { id: activeTask.id }, data });
    }
    return activeTask.id;
  }

  // No active task — create a high-priority departure task with sector snapshot.
  const created = await createTaskWithSectorSnapshot(tx, {
    locationId: input.locationId,
    hotelDate: input.hotelDate,
    priority: Priority.high,
    assignedEmployeeId,
    shiftId,
    locationKind: input.locationKind,
    planCategory: DailyPlanCategory.departure,
  });
  return created.id;
}
