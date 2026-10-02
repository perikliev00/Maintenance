import {
  CleaningStatus,
  Prisma,
  SessionStatus,
  TaskStatus,
} from "@prisma/client";
import { prisma } from "../db";

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

export async function createCleaningTask(input: {
  locationId: string;
  hotelDate: string;
  priority?: "low" | "normal" | "high" | "urgent";
  assignedEmployeeId?: string;
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
      status: { in: [TaskStatus.assigned, TaskStatus.in_progress] },
    },
  });
  if (existing) {
    throw new AppError(409, "conflict", "Active cleaning task already exists for this room/date");
  }

  return prisma.$transaction(async (tx) => {
    if (location.cleaningStatus === CleaningStatus.verified_clean) {
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
        status: TaskStatus.assigned,
      },
      include: {
        location: {
          include: {
            floor: { include: { building: true } },
          },
        },
        assignedEmployee: true,
        sessions: true,
      },
    });
  });
}

export async function startCleaningTask(input: {
  taskId: string;
  employeeId: string;
  commandId: string;
  expectedVersion?: number;
}) {
  const existingByCommand = await prisma.cleaningSession.findUnique({
    where: { startCommandId: input.commandId },
    include: {
      task: {
        include: {
          location: { include: { floor: { include: { building: true } } } },
          assignedEmployee: true,
          sessions: true,
        },
      },
    },
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
      if (task.assignedEmployeeId && task.assignedEmployeeId !== input.employeeId) {
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
        include: {
          location: { include: { floor: { include: { building: true } } } },
          assignedEmployee: true,
          sessions: true,
        },
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
        include: {
          task: {
            include: {
              location: { include: { floor: { include: { building: true } } } },
              assignedEmployee: true,
              sessions: true,
            },
          },
        },
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
}) {
  const existingByCommand = await prisma.cleaningSession.findUnique({
    where: { completeCommandId: input.commandId },
    include: {
      task: {
        include: {
          location: { include: { floor: { include: { building: true } } } },
          assignedEmployee: true,
          sessions: true,
        },
      },
    },
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
      if (session.employeeId !== input.employeeId) {
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
          completeCommandId: input.commandId,
        },
      });

      const updatedTask = await tx.cleaningTask.update({
        where: { id: session.taskId },
        data: {
          status: TaskStatus.completed,
          version: { increment: 1 },
        },
        include: {
          location: { include: { floor: { include: { building: true } } } },
          assignedEmployee: true,
          sessions: true,
        },
      });

      // Temporary until inspection exists in a later step
      await tx.location.update({
        where: { id: updatedTask.locationId },
        data: { cleaningStatus: CleaningStatus.verified_clean },
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
        include: {
          task: {
            include: {
              location: { include: { floor: { include: { building: true } } } },
              assignedEmployee: true,
              sessions: true,
            },
          },
        },
      });
      if (again) {
        return { session: again, task: again.task, idempotent: true };
      }
    }
    throw err;
  }
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
        where: { status: { in: [TaskStatus.assigned, TaskStatus.in_progress] } },
        include: { assignedEmployee: true, sessions: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
}
