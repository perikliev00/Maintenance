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

export const PRIORITY_RANK: Record<Priority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  urgent: 3,
};

export function connectAssigneeAndShift(
  data: Prisma.CleaningTaskUpdateInput,
  task: { assignedEmployeeId: string | null; shiftId: string | null },
  assignedEmployeeId?: string,
  shiftId?: string | null,
) {
  if (assignedEmployeeId && !task.assignedEmployeeId) {
    data.assignedEmployee = { connect: { id: assignedEmployeeId } };
  }
  if (shiftId && !task.shiftId) {
    data.shift = { connect: { id: shiftId } };
  }
}

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
  const snap = await sectorSnapshotForLocation(data.locationId, tx);
  const serviceType = deriveCleaningServiceType({
    locationKind: data.locationKind,
    planCategory: data.planCategory,
  });
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
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
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

  if (input.existingCleaningTaskId) {
    const existing = await tx.cleaningTask.findFirst({
      where: {
        id: input.existingCleaningTaskId,
        status: { in: [...ACTIVE_TASK_STATUSES] },
      },
    });
    if (existing) {
      const data: Prisma.CleaningTaskUpdateInput = {};
      if (PRIORITY_RANK[existing.priority] < PRIORITY_RANK[Priority.high]) {
        data.priority = Priority.high;
      }
      connectAssigneeAndShift(data, existing, assignedEmployeeId, shiftId);
      if (Object.keys(data).length) {
        await tx.cleaningTask.update({ where: { id: existing.id }, data });
      }
      return existing.id;
    }
  }

  const activeTask = await tx.cleaningTask.findFirst({
    where: {
      locationId: input.locationId,
      hotelDate: input.hotelDate,
      status: { in: [...ACTIVE_TASK_STATUSES] },
    },
  });

  if (activeTask) {
    const data: Prisma.CleaningTaskUpdateInput = {};
    if (PRIORITY_RANK[activeTask.priority] < PRIORITY_RANK[Priority.high]) {
      data.priority = Priority.high;
    }
    connectAssigneeAndShift(data, activeTask, assignedEmployeeId, shiftId);
    if (Object.keys(data).length) {
      await tx.cleaningTask.update({ where: { id: activeTask.id }, data });
    }
    return activeTask.id;
  }

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
