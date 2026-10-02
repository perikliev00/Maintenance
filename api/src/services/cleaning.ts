import {
  CleaningStatus,
  InspectionResult,
  Prisma,
  SessionStatus,
  TaskStatus,
} from "@prisma/client";
import { prisma } from "../db";
import { ACTIVE_TASK_STATUSES, OVERDUE_SESSION_MINUTES } from "../constants";

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

const taskInclude = {
  location: { include: { floor: { include: { building: true } } } },
  assignedEmployee: true,
  sessions: true,
  inspections: true,
} satisfies Prisma.CleaningTaskInclude;

export async function createCleaningTask(input: {
  locationId: string;
  hotelDate: string;
  priority?: "low" | "normal" | "high" | "urgent";
  assignedEmployeeId?: string;
  dueAt?: string;
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

  return prisma.$transaction(async (tx) => {
    if (
      location.cleaningStatus === CleaningStatus.verified_clean ||
      location.cleaningStatus === CleaningStatus.pending_inspection
    ) {
      await tx.location.update({
        where: { id: location.id },
        data: { cleaningStatus: CleaningStatus.dirty },
      });
    }

    return tx.cleaningTask.create({
      data: {
        locationId: input.locationId,
        hotelDate,
        priority: input.priority ?? "normal",
        assignedEmployeeId: input.assignedEmployeeId,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        status: TaskStatus.assigned,
      },
      include: taskInclude,
    });
  });
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
    return await prisma.$transaction(async (tx) => {
      const task = await tx.cleaningTask.findUnique({
        where: { id: input.taskId },
      });
      if (!task) {
        throw new AppError(404, "not_found", "Task not found");
      }
      if (task.status !== TaskStatus.assigned && task.status !== TaskStatus.in_progress) {
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

      const runningByEmployee = await tx.cleaningSession.findFirst({
        where: { employeeId: input.employeeId, status: SessionStatus.running },
      });
      if (runningByEmployee) {
        throw new AppError(409, "conflict", "Employee already has a running session");
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

      return { session, task: updatedTask, idempotent: false };
    });
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
    return await prisma.$transaction(async (tx) => {
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

      return { session: updatedSession, task: updatedTask, idempotent: false };
    });
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
    return await prisma.$transaction(async (tx) => {
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
        return { inspection, task: updatedTask, idempotent: false };
      }

      const updatedTask = await tx.cleaningTask.update({
        where: { id: task.id },
        data: {
          status: TaskStatus.assigned,
          version: { increment: 1 },
        },
        include: taskInclude,
      });
      await tx.location.update({
        where: { id: task.locationId },
        data: { cleaningStatus: CleaningStatus.dirty },
      });
      return { inspection, task: updatedTask, idempotent: false };
    });
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

  return prisma.$transaction(async (tx) => {
    const task = await tx.cleaningTask.findUnique({
      where: { id: input.taskId },
    });
    if (!task) {
      throw new AppError(404, "not_found", "Task not found");
    }
    if (
      task.status !== TaskStatus.assigned &&
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

    return tx.cleaningTask.update({
      where: { id: task.id },
      data: {
        assignedEmployeeId: input.assignedEmployeeId,
        reassignReason: input.reason.trim(),
        version: { increment: 1 },
      },
      include: taskInclude,
    });
  });
}

export async function listOverdueSessions() {
  const cutoff = new Date(Date.now() - OVERDUE_SESSION_MINUTES * 60 * 1000);
  const sessions = await prisma.cleaningSession.findMany({
    where: {
      status: SessionStatus.running,
      startedAt: { lte: cutoff },
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

export async function markRoomDirty(locationId: string) {
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location) {
    throw new AppError(404, "not_found", "Room not found");
  }
  return prisma.location.update({
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
}
