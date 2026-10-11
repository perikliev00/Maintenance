import { CleaningServiceType, Prisma, SessionStatus, TaskStatus } from "@prisma/client";
import { prisma } from "../../db";
import { ACTIVE_TASK_STATUSES } from "../../constants";
import { AppError } from "../../errors";
import { publish } from "../../events/bus";
import {
  sectorSnapshotForLocation,
  sectorSupervisorForSector,
} from "../dataScope";
import { recordAudit } from "../audit";
import { createNotifications } from "../notifications";
import { assertActiveCleaningAssignee } from "../assignees";
import { taskInclude } from "../cleaningTasksQuery";
import { assertActiveShiftId } from "../shifts";
import { assertTaskVersion, claimTaskStatus } from "./claims";
import { resolveCycleForNewTask } from "./cycles";
import { deriveCleaningServiceType } from "./deriveServiceType";
import { lockTask, lockLocation } from "./locks";
import { isP2002, mapCreateTaskUniqueConflict } from "./prismaConflicts";

export async function createCleaningTask(input: {
  locationId: string;
  hotelDate: string;
  priority?: "low" | "normal" | "high" | "urgent";
  assignedEmployeeId?: string;
  shiftId?: string | null;
  dueAt?: string;
  serviceType?: CleaningServiceType;
  actorEmployeeId?: string;
}) {
  const hotelDate = new Date(`${input.hotelDate}T00:00:00.000Z`);
  const sectorSnap = await sectorSnapshotForLocation(input.locationId);
  const shiftId = await assertActiveShiftId(input.shiftId);

  if (input.assignedEmployeeId) {
    await assertActiveCleaningAssignee(input.assignedEmployeeId);
  }

  try {
    const task = await prisma.$transaction(async (tx) => {
      await lockLocation(tx, input.locationId);

      const location = await tx.location.findUnique({
        where: { id: input.locationId },
      });
      if (!location) {
        throw new AppError(404, "not_found", "Room not found");
      }
      if (location.catalogStatus !== "active") {
        throw new AppError(400, "invalid_state", "Room is archived");
      }

      const existing = await tx.cleaningTask.findFirst({
        where: {
          locationId: input.locationId,
          hotelDate,
          status: { in: [...ACTIVE_TASK_STATUSES] },
        },
      });
      if (existing) {
        throw new AppError(
          409,
          "conflict",
          "Active cleaning task already exists for this room/date",
        );
      }

      const cleaningCycle = await resolveCycleForNewTask(
        tx,
        location.id,
        hotelDate,
      );

      const serviceType = deriveCleaningServiceType({
        locationKind: location.kind,
        serviceType: input.serviceType,
      });

      const created = await tx.cleaningTask.create({
        data: {
          locationId: input.locationId,
          sectorId: sectorSnap.sectorId,
          sectorSupervisorEmployeeId: sectorSnap.sectorSupervisorEmployeeId,
          hotelDate,
          serviceType,
          priority: input.priority ?? "normal",
          assignedEmployeeId: input.assignedEmployeeId,
          shiftId: shiftId ?? null,
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          status: TaskStatus.assigned,
          cleaningCycle,
        },
        include: taskInclude,
      });

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

      return created;
    });

    publish("cleaning.changed", {
      locationId: task.locationId,
      taskId: task.id,
    });
    if (task.assignedEmployeeId) {
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
    return task;
  } catch (err) {
    if (isP2002(err)) {
      mapCreateTaskUniqueConflict(err);
    }
    throw err;
  }
}

export async function reassignCleaningTask(input: {
  taskId: string;
  assignedEmployeeId: string;
  reason: string;
  shiftId?: string | null;
  expectedVersion?: number;
  actorEmployeeId?: string;
}) {
  if (!input.reason.trim()) {
    throw new AppError(400, "validation", "Reassign reason is required");
  }

  await assertActiveCleaningAssignee(input.assignedEmployeeId);

  const shiftId = await assertActiveShiftId(input.shiftId);

  const updated = await prisma.$transaction(async (tx) => {
    await lockTask(tx, input.taskId);

    const task = await tx.cleaningTask.findUnique({
      where: { id: input.taskId },
    });
    if (!task) {
      throw new AppError(404, "not_found", "Task not found");
    }
    if (
      task.status !== TaskStatus.assigned &&
      task.status !== TaskStatus.rework &&
      task.status !== TaskStatus.awaiting_inspection
    ) {
      throw new AppError(
        409,
        "invalid_state",
        `Cannot reassign task in status ${task.status}`,
      );
    }
    assertTaskVersion(task, input.expectedVersion);

    const running = await tx.cleaningSession.findFirst({
      where: { taskId: task.id, status: SessionStatus.running },
    });
    if (running) {
      throw new AppError(
        409,
        "conflict",
        "Cannot reassign while a session is running",
      );
    }

    const data: Prisma.CleaningTaskUncheckedUpdateManyInput = {
      assignedEmployeeId: input.assignedEmployeeId,
      reassignReason: input.reason.trim(),
    };
    if (shiftId !== undefined) {
      data.shiftId = shiftId;
    }

    // Backfill sector snapshot only when missing — do not overwrite history.
    if (!task.sectorId) {
      const snap = await sectorSnapshotForLocation(task.locationId, tx);
      if (snap.sectorId) {
        data.sectorId = snap.sectorId;
        if (snap.sectorSupervisorEmployeeId) {
          data.sectorSupervisorEmployeeId = snap.sectorSupervisorEmployeeId;
        }
      }
    } else if (!task.sectorSupervisorEmployeeId) {
      const supervisorId = await sectorSupervisorForSector(task.sectorId, tx);
      if (supervisorId) {
        data.sectorSupervisorEmployeeId = supervisorId;
      }
    }

    await claimTaskStatus(
      tx,
      task.id,
      [
        TaskStatus.assigned,
        TaskStatus.rework,
        TaskStatus.awaiting_inspection,
      ],
      data,
      input.expectedVersion,
    );

    const result = await tx.cleaningTask.findUniqueOrThrow({
      where: { id: task.id },
      include: taskInclude,
    });

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

    return result;
  });

  publish("cleaning.changed", {
    locationId: updated.locationId,
    taskId: updated.id,
  });
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
  return updated;
}
