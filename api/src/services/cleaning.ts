import {
  CleaningStatus,
  InspectionResult,
  Prisma,
  SessionStatus,
  TaskStatus,
} from "@prisma/client";
import { prisma } from "../db";
import { ACTIVE_TASK_STATUSES } from "../constants";
import { AppError } from "../errors";
import { getFlags, getOperations } from "./settings";
import { publish } from "../events/bus";
import {
  sectorSnapshotForLocation,
  sectorSupervisorForSector,
} from "./dataScope";
import { recordAudit } from "./audit";

export { AppError };

const taskInclude = {
  location: { include: { floor: { include: { building: true } } } },
  assignedEmployee: true,
  sector: { select: { id: true, code: true, nameBg: true, nameEn: true } },
  sectorSupervisor: {
    select: { id: true, fullName: true, employeeNumber: true },
  },
  sessions: true,
  inspections: true,
} satisfies Prisma.CleaningTaskInclude;

export async function createCleaningTask(input: {
  locationId: string;
  hotelDate: string;
  priority?: "low" | "normal" | "high" | "urgent";
  assignedEmployeeId?: string;
  dueAt?: string;
  actorEmployeeId?: string;
}) {
  const location = await prisma.location.findUnique({
    where: { id: input.locationId },
  });
  if (!location) {
    throw new AppError(404, "not_found", "Room not found");
  }
  if (location.catalogStatus !== "active") {
    throw new AppError(400, "invalid_state", "Room is archived");
  }

  const hotelDate = new Date(`${input.hotelDate}T00:00:00.000Z`);

  const existing = await prisma.cleaningTask.findFirst({
    where: {
      locationId: input.locationId,
      hotelDate,
      status: { in: [...ACTIVE_TASK_STATUSES] },
    },
  });
  if (existing) {
    throw new AppError(409, "conflict", "Active cleaning task already exists for this room/date");
  }

  const sectorSnap = await sectorSnapshotForLocation(input.locationId);

  const task = await prisma.$transaction(async (tx) => {
    if (
      location.cleaningStatus === CleaningStatus.verified_clean ||
      location.cleaningStatus === CleaningStatus.pending_inspection
    ) {
      await tx.location.update({
        where: { id: location.id },
        data: { cleaningStatus: CleaningStatus.dirty },
      });
    }

    const created = await tx.cleaningTask.create({
      data: {
        locationId: input.locationId,
        sectorId: sectorSnap.sectorId,
        sectorSupervisorEmployeeId: sectorSnap.sectorSupervisorEmployeeId,
        hotelDate,
        priority: input.priority ?? "normal",
        assignedEmployeeId: input.assignedEmployeeId,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        status: TaskStatus.assigned,
      },
      include: taskInclude,
    });

    await recordAudit(tx, {
      actorEmployeeId: input.actorEmployeeId,
      action: "cleaning.task.create",
      entityType: "cleaning_task",
      entityId: created.id,
      locationId: created.locationId,
      after: {
        status: created.status,
        priority: created.priority,
        assignedEmployeeId: created.assignedEmployeeId,
        hotelDate: input.hotelDate,
      },
      summary: `Created cleaning task for ${created.location.number}`,
    });

    return created;
  });

  publish("cleaning.changed", {
    locationId: task.locationId,
    taskId: task.id,
  });
  return task;
}

export async function startCleaningTask(input: {
  taskId: string;
  employeeId: string;
  commandId: string;
  expectedVersion?: number;
  /** Owner may start a task assigned to someone else. */
  bypassAssigneeCheck?: boolean;
}) {
  const existingByCommand = await prisma.cleaningSession.findUnique({
    where: { startCommandId: input.commandId },
    include: { task: { include: taskInclude } },
  });
  if (existingByCommand) {
    return { session: existingByCommand, task: existingByCommand.task, idempotent: true };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const task = await tx.cleaningTask.findUnique({
        where: { id: input.taskId },
      });
      if (!task) {
        throw new AppError(404, "not_found", "Task not found");
      }
      if (
        task.status !== TaskStatus.assigned &&
        task.status !== TaskStatus.rework &&
        task.status !== TaskStatus.in_progress
      ) {
        throw new AppError(409, "invalid_state", `Cannot start task in status ${task.status}`);
      }
      if (
        input.expectedVersion !== undefined &&
        task.version !== input.expectedVersion
      ) {
        throw new AppError(409, "version_conflict", "Task was updated by another user");
      }
      if (
        !input.bypassAssigneeCheck &&
        task.assignedEmployeeId &&
        task.assignedEmployeeId !== input.employeeId
      ) {
        throw new AppError(403, "forbidden", "Task is assigned to another employee");
      }

      const runningOnTask = await tx.cleaningSession.findFirst({
        where: { taskId: task.id, status: SessionStatus.running },
      });
      if (runningOnTask) {
        throw new AppError(409, "conflict", "Task already has a running session");
      }

      const flags = await getFlags();
      if (flags.one_active_session_per_employee) {
        const runningByEmployee = await tx.cleaningSession.findFirst({
          where: { employeeId: input.employeeId, status: SessionStatus.running },
        });
        if (runningByEmployee) {
          throw new AppError(409, "conflict", "Employee already has a running session");
        }
      }

      const session = await tx.cleaningSession.create({
        data: {
          taskId: task.id,
          employeeId: input.employeeId,
          startedAt: new Date(),
          status: SessionStatus.running,
          startCommandId: input.commandId,
        },
      });

      const updatedTask = await tx.cleaningTask.update({
        where: { id: task.id },
        data: {
          status: TaskStatus.in_progress,
          assignedEmployeeId: input.employeeId,
          version: { increment: 1 },
        },
        include: taskInclude,
      });

      await tx.location.update({
        where: { id: task.locationId },
        data: { cleaningStatus: CleaningStatus.in_progress },
      });

      await recordAudit(tx, {
        actorEmployeeId: input.employeeId,
        action: "cleaning.task.start",
        entityType: "cleaning_task",
        entityId: task.id,
        locationId: task.locationId,
        before: { status: task.status },
        after: {
          status: TaskStatus.in_progress,
          sessionId: session.id,
        },
        summary: `Started cleaning ${updatedTask.location.number}`,
      });

      return { session, task: updatedTask, idempotent: false };
    });
    if (!result.idempotent) {
      publish("cleaning.changed", {
        locationId: result.task.locationId,
        taskId: result.task.id,
      });
    }
    return result;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const again = await prisma.cleaningSession.findUnique({
        where: { startCommandId: input.commandId },
        include: { task: { include: taskInclude } },
      });
      if (again) {
        return { session: again, task: again.task, idempotent: true };
      }
    }
    throw err;
  }
}

export async function completeCleaningSession(input: {
  sessionId: string;
  employeeId: string;
  commandId: string;
  notes?: string;
  /** Owner may complete a session started by someone else. */
  bypassSessionOwnerCheck?: boolean;
}) {
  const existingByCommand = await prisma.cleaningSession.findUnique({
    where: { completeCommandId: input.commandId },
    include: { task: { include: taskInclude } },
  });
  if (existingByCommand) {
    return { session: existingByCommand, task: existingByCommand.task, idempotent: true };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const session = await tx.cleaningSession.findUnique({
        where: { id: input.sessionId },
      });
      if (!session) {
        throw new AppError(404, "not_found", "Session not found");
      }
      if (
        !input.bypassSessionOwnerCheck &&
        session.employeeId !== input.employeeId
      ) {
        throw new AppError(403, "forbidden", "Session belongs to another employee");
      }
      if (session.status === SessionStatus.completed) {
        throw new AppError(409, "invalid_state", "Session already completed");
      }
      if (session.status !== SessionStatus.running) {
        throw new AppError(409, "invalid_state", `Cannot complete session in status ${session.status}`);
      }

      const finishedAt = new Date();
      if (finishedAt < session.startedAt) {
        throw new AppError(400, "invalid_time", "Finish time before start time");
      }

      const updatedSession = await tx.cleaningSession.update({
        where: { id: session.id },
        data: {
          status: SessionStatus.completed,
          finishedAt,
          notes: input.notes?.trim() || null,
          completeCommandId: input.commandId,
        },
      });

      const flags = await getFlags();
      if (flags.require_inspection) {
        const updatedTask = await tx.cleaningTask.update({
          where: { id: session.taskId },
          data: {
            status: TaskStatus.awaiting_inspection,
            version: { increment: 1 },
          },
          include: taskInclude,
        });

        await tx.location.update({
          where: { id: updatedTask.locationId },
          data: { cleaningStatus: CleaningStatus.pending_inspection },
        });

        await recordAudit(tx, {
          actorEmployeeId: input.employeeId,
          action: "cleaning.session.complete",
          entityType: "cleaning_session",
          entityId: updatedSession.id,
          locationId: updatedTask.locationId,
          after: {
            taskStatus: TaskStatus.awaiting_inspection,
            notes: input.notes?.trim() || null,
          },
          summary: `Completed cleaning ${updatedTask.location.number}`,
        });

        return { session: updatedSession, task: updatedTask, idempotent: false };
      }

      const updatedTask = await tx.cleaningTask.update({
        where: { id: session.taskId },
        data: {
          status: TaskStatus.completed,
          version: { increment: 1 },
        },
        include: taskInclude,
      });

      await tx.location.update({
        where: { id: updatedTask.locationId },
        data: { cleaningStatus: CleaningStatus.verified_clean },
      });

      await recordAudit(tx, {
        actorEmployeeId: input.employeeId,
        action: "cleaning.session.complete",
        entityType: "cleaning_session",
        entityId: updatedSession.id,
        locationId: updatedTask.locationId,
        after: {
          taskStatus: TaskStatus.completed,
          notes: input.notes?.trim() || null,
        },
        summary: `Completed cleaning ${updatedTask.location.number}`,
      });

      return { session: updatedSession, task: updatedTask, idempotent: false };
    });
    if (!result.idempotent) {
      publish("cleaning.changed", {
        locationId: result.task.locationId,
        taskId: result.task.id,
      });
    }
    return result;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const again = await prisma.cleaningSession.findUnique({
        where: { completeCommandId: input.commandId },
        include: { task: { include: taskInclude } },
      });
      if (again) {
        return { session: again, task: again.task, idempotent: true };
      }
    }
    throw err;
  }
}

export async function cancelCleaningSession(input: {
  sessionId: string;
  employeeId: string;
  commandId: string;
  notes?: string;
  /** Reviewer / owner may cancel a session started by someone else. */
  bypassSessionOwnerCheck?: boolean;
}) {
  const existingByCommand = await prisma.cleaningSession.findUnique({
    where: { cancelCommandId: input.commandId },
    include: { task: { include: taskInclude } },
  });
  if (existingByCommand) {
    return { session: existingByCommand, task: existingByCommand.task, idempotent: true };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const session = await tx.cleaningSession.findUnique({
        where: { id: input.sessionId },
      });
      if (!session) {
        throw new AppError(404, "not_found", "Session not found");
      }
      if (
        !input.bypassSessionOwnerCheck &&
        session.employeeId !== input.employeeId
      ) {
        throw new AppError(403, "forbidden", "Session belongs to another employee");
      }
      if (session.status === SessionStatus.cancelled) {
        throw new AppError(409, "invalid_state", "Session already cancelled");
      }
      if (session.status !== SessionStatus.running) {
        throw new AppError(
          409,
          "invalid_state",
          `Cannot cancel session in status ${session.status}`,
        );
      }

      const finishedAt = new Date();
      if (finishedAt < session.startedAt) {
        throw new AppError(400, "invalid_time", "Finish time before start time");
      }

      const updatedSession = await tx.cleaningSession.update({
        where: { id: session.id },
        data: {
          status: SessionStatus.cancelled,
          finishedAt,
          notes: input.notes?.trim() || null,
          cancelCommandId: input.commandId,
        },
      });

      const task = await tx.cleaningTask.findUnique({
        where: { id: session.taskId },
      });
      if (!task) {
        throw new AppError(404, "not_found", "Task not found");
      }

      let updatedTask = await tx.cleaningTask.findUniqueOrThrow({
        where: { id: task.id },
        include: taskInclude,
      });

      if (task.status === TaskStatus.in_progress) {
        const otherRunning = await tx.cleaningSession.findFirst({
          where: {
            taskId: task.id,
            status: SessionStatus.running,
            id: { not: session.id },
          },
        });
        if (!otherRunning) {
          updatedTask = await tx.cleaningTask.update({
            where: { id: task.id },
            data: {
              status: TaskStatus.assigned,
              version: { increment: 1 },
            },
            include: taskInclude,
          });

          const location = await tx.location.findUnique({
            where: { id: task.locationId },
          });
          if (location?.cleaningStatus === CleaningStatus.in_progress) {
            await tx.location.update({
              where: { id: task.locationId },
              data: { cleaningStatus: CleaningStatus.dirty },
            });
          }
        }
      }

      await recordAudit(tx, {
        actorEmployeeId: input.employeeId,
        action: "cleaning.session.cancel",
        entityType: "cleaning_session",
        entityId: updatedSession.id,
        locationId: updatedTask.locationId,
        after: {
          taskStatus: updatedTask.status,
          notes: input.notes?.trim() || null,
        },
        summary: `Cancelled cleaning session for ${updatedTask.location.number}`,
      });

      return { session: updatedSession, task: updatedTask, idempotent: false };
    });
    if (!result.idempotent) {
      publish("cleaning.changed", {
        locationId: result.task.locationId,
        taskId: result.task.id,
      });
    }
    return result;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const again = await prisma.cleaningSession.findUnique({
        where: { cancelCommandId: input.commandId },
        include: { task: { include: taskInclude } },
      });
      if (again) {
        return { session: again, task: again.task, idempotent: true };
      }
    }
    throw err;
  }
}

export async function inspectCleaningTask(input: {
  taskId: string;
  inspectorEmployeeId: string;
  commandId: string;
  result: "approved" | "rejected";
  findings?: string;
}) {
  const existing = await prisma.inspection.findUnique({
    where: { commandId: input.commandId },
    include: { task: { include: taskInclude } },
  });
  if (existing) {
    return { inspection: existing, task: existing.task, idempotent: true };
  }

  if (input.result === "rejected" && !input.findings?.trim()) {
    throw new AppError(400, "validation", "Findings/reason required when rejecting");
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const task = await tx.cleaningTask.findUnique({
        where: { id: input.taskId },
      });
      if (!task) {
        throw new AppError(404, "not_found", "Task not found");
      }
      if (task.status !== TaskStatus.awaiting_inspection) {
        throw new AppError(
          409,
          "invalid_state",
          `Cannot inspect task in status ${task.status}`,
        );
      }

      const inspection = await tx.inspection.create({
        data: {
          taskId: task.id,
          inspectorEmployeeId: input.inspectorEmployeeId,
          inspectedAt: new Date(),
          result:
            input.result === "approved"
              ? InspectionResult.approved
              : InspectionResult.rejected,
          findings: input.findings?.trim() || null,
          commandId: input.commandId,
        },
      });

      if (input.result === "approved") {
        const updatedTask = await tx.cleaningTask.update({
          where: { id: task.id },
          data: {
            status: TaskStatus.completed,
            version: { increment: 1 },
          },
          include: taskInclude,
        });
        await tx.location.update({
          where: { id: task.locationId },
          data: { cleaningStatus: CleaningStatus.verified_clean },
        });
        await recordAudit(tx, {
          actorEmployeeId: input.inspectorEmployeeId,
          action: "cleaning.inspect",
          entityType: "inspection",
          entityId: inspection.id,
          locationId: task.locationId,
          reason: input.findings,
          after: { result: "approved", taskId: task.id },
          summary: `Approved cleaning ${updatedTask.location.number}`,
        });
        return { inspection, task: updatedTask, idempotent: false };
      }

      const updatedTask = await tx.cleaningTask.update({
        where: { id: task.id },
        data: {
          status: TaskStatus.rework,
          version: { increment: 1 },
        },
        include: taskInclude,
      });
      await tx.location.update({
        where: { id: task.locationId },
        data: { cleaningStatus: CleaningStatus.dirty },
      });
      await recordAudit(tx, {
        actorEmployeeId: input.inspectorEmployeeId,
        action: "cleaning.inspect",
        entityType: "inspection",
        entityId: inspection.id,
        locationId: task.locationId,
        reason: input.findings,
        after: { result: "rejected", taskId: task.id },
        summary: `Rejected cleaning ${updatedTask.location.number}${
          input.findings?.trim() ? ` — ${input.findings.trim()}` : ""
        }`,
      });
      return { inspection, task: updatedTask, idempotent: false };
    });
    if (!result.idempotent) {
      publish("cleaning.changed", {
        locationId: result.task.locationId,
        taskId: result.task.id,
      });
    }
    return result;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const again = await prisma.inspection.findUnique({
        where: { commandId: input.commandId },
        include: { task: { include: taskInclude } },
      });
      if (again) {
        return { inspection: again, task: again.task, idempotent: true };
      }
    }
    throw err;
  }
}

export async function reassignCleaningTask(input: {
  taskId: string;
  assignedEmployeeId: string;
  reason: string;
  expectedVersion?: number;
  actorEmployeeId?: string;
}) {
  if (!input.reason.trim()) {
    throw new AppError(400, "validation", "Reassign reason is required");
  }

  const employee = await prisma.employee.findUnique({
    where: { id: input.assignedEmployeeId },
    include: { user: true },
  });
  if (!employee || employee.user?.role !== "housekeeper") {
    throw new AppError(400, "validation", "Assignee must be an active housekeeper");
  }

  const updated = await prisma.$transaction(async (tx) => {
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
    if (
      input.expectedVersion !== undefined &&
      task.version !== input.expectedVersion
    ) {
      throw new AppError(409, "version_conflict", "Task was updated by another user");
    }

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

    const data: Prisma.CleaningTaskUpdateInput = {
      assignedEmployee: { connect: { id: input.assignedEmployeeId } },
      reassignReason: input.reason.trim(),
      version: { increment: 1 },
    };

    // Backfill sector snapshot only when missing — do not overwrite history.
    if (!task.sectorId) {
      const snap = await sectorSnapshotForLocation(task.locationId, tx);
      if (snap.sectorId) {
        data.sector = { connect: { id: snap.sectorId } };
        if (snap.sectorSupervisorEmployeeId) {
          data.sectorSupervisor = {
            connect: { id: snap.sectorSupervisorEmployeeId },
          };
        }
      }
    } else if (!task.sectorSupervisorEmployeeId) {
      const supervisorId = await sectorSupervisorForSector(task.sectorId, tx);
      if (supervisorId) {
        data.sectorSupervisor = { connect: { id: supervisorId } };
      }
    }

    const result = await tx.cleaningTask.update({
      where: { id: task.id },
      data,
      include: taskInclude,
    });

    await recordAudit(tx, {
      actorEmployeeId: input.actorEmployeeId,
      action: "cleaning.task.reassign",
      entityType: "cleaning_task",
      entityId: result.id,
      locationId: result.locationId,
      reason: input.reason,
      before: { assignedEmployeeId: task.assignedEmployeeId },
      after: { assignedEmployeeId: input.assignedEmployeeId },
      summary: `Reassigned cleaning ${result.location.number}`,
    });

    return result;
  });

  publish("cleaning.changed", {
    locationId: updated.locationId,
    taskId: updated.id,
  });
  return updated;
}

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
    const row = await tx.location.update({
      where: { id: locationId },
      data: { cleaningStatus: CleaningStatus.dirty },
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
    await recordAudit(tx, {
      actorEmployeeId,
      action: "location.mark_dirty",
      entityType: "location",
      entityId: locationId,
      locationId,
      before: { cleaningStatus: location.cleaningStatus },
      after: { cleaningStatus: CleaningStatus.dirty },
      summary: `Marked ${row.number} dirty`,
    });
    return row;
  });
  publish("location.changed", { locationId: updated.id });
  return updated;
}
