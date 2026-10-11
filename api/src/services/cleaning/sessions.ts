import { CleaningStatus, SessionStatus, TaskStatus } from "@prisma/client";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { publish } from "../../events/bus";
import { getFlags, getOperations } from "../settings";
import { recordAudit } from "../audit";
import {
  createNotifications,
  recipientsForLocationOps,
} from "../notifications";
import { taskInclude } from "../cleaningTasksQuery";
import {
  assertTaskVersion,
  claimRunningSession,
  claimTaskStatus,
  taskConflictDetails,
} from "./claims";
import { ensureTaskCycleForStart } from "./cycles";
import { applyLocationCleaningStatusIfCurrent } from "./locationStatus";
import { lockSession, lockTask } from "./locks";
import { isP2002, mapStartUniqueConflict } from "./prismaConflicts";

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
        task.status !== TaskStatus.in_progress
      ) {
        throw new AppError(
          409,
          "invalid_state",
          `Cannot start task in status ${task.status}`,
          taskConflictDetails(task, input.expectedVersion),
        );
      }
      assertTaskVersion(task, input.expectedVersion);
      if (
        !input.bypassAssigneeCheck &&
        task.assignedEmployeeId &&
        task.assignedEmployeeId !== input.employeeId
      ) {
        throw new AppError(
          409,
          "assignee_conflict",
          "Task was reassigned to another employee",
          taskConflictDetails(task, input.expectedVersion),
        );
      }

      // Bind unbound/future-planned tasks; reject hotelDate still in the future.
      const cleaningCycle = await ensureTaskCycleForStart(tx, task);

      const runningOnTask = await tx.cleaningSession.findFirst({
        where: { taskId: task.id, status: SessionStatus.running },
      });
      if (runningOnTask) {
        throw new AppError(409, "conflict", "Task already has a running session");
      }

      // DB always enforces one running session per employee (partial unique index).
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

      await claimTaskStatus(
        tx,
        task.id,
        [TaskStatus.assigned, TaskStatus.rework, TaskStatus.in_progress],
        {
          status: TaskStatus.in_progress,
          assignedEmployeeId: input.employeeId,
        },
        input.expectedVersion,
      );

      const updatedTask = await tx.cleaningTask.findUniqueOrThrow({
        where: { id: task.id },
        include: taskInclude,
      });

      await applyLocationCleaningStatusIfCurrent(
        tx,
        task.locationId,
        cleaningCycle,
        CleaningStatus.in_progress,
        { requireCurrent: true },
      );

      await recordAudit({
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
      }, tx);

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
    if (isP2002(err)) {
      const again = await prisma.cleaningSession.findUnique({
        where: { startCommandId: input.commandId },
        include: { task: { include: taskInclude } },
      });
      if (again) {
        return { session: again, task: again.task, idempotent: true };
      }
      mapStartUniqueConflict(err);
    }
    throw err;
  }
}

export async function completeCleaningSession(input: {
  sessionId: string;
  employeeId: string;
  commandId: string;
  notes?: string;
  expectedVersion?: number;
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
      const sessionPeek = await tx.cleaningSession.findUnique({
        where: { id: input.sessionId },
      });
      if (!sessionPeek) {
        throw new AppError(404, "not_found", "Session not found");
      }

      // Lock order: task → session → location writes
      await lockTask(tx, sessionPeek.taskId);
      await lockSession(tx, sessionPeek.id);

      const session = await tx.cleaningSession.findUniqueOrThrow({
        where: { id: input.sessionId },
      });
      if (
        !input.bypassSessionOwnerCheck &&
        session.employeeId !== input.employeeId
      ) {
        const taskPeek = await tx.cleaningTask.findUnique({
          where: { id: session.taskId },
        });
        throw new AppError(
          409,
          "assignee_conflict",
          "Session belongs to another employee",
          taskPeek
            ? taskConflictDetails(taskPeek, input.expectedVersion)
            : undefined,
        );
      }
      if (session.status === SessionStatus.completed) {
        throw new AppError(409, "invalid_state", "Session already completed");
      }
      if (session.status !== SessionStatus.running) {
        throw new AppError(
          409,
          "invalid_state",
          `Cannot complete session in status ${session.status}`,
        );
      }

      const task = await tx.cleaningTask.findUniqueOrThrow({
        where: { id: session.taskId },
      });
      assertTaskVersion(task, input.expectedVersion);

      const finishedAt = new Date();
      if (finishedAt < session.startedAt) {
        throw new AppError(400, "invalid_time", "Finish time before start time");
      }

      const operations = await getOperations();
      const durationMinutes =
        (finishedAt.getTime() - session.startedAt.getTime()) / 60000;
      const existingFlags = Array.isArray(session.anomalyFlags)
        ? (session.anomalyFlags as string[]).filter(
            (f): f is string => typeof f === "string",
          )
        : [];
      const anomalyFlags =
        durationMinutes >= operations.overdueSessionMinutes &&
        !existingFlags.includes("overdue")
          ? [...existingFlags, "overdue"]
          : existingFlags;

      await claimRunningSession(tx, session.id, {
        status: SessionStatus.completed,
        finishedAt,
        notes: input.notes?.trim() || null,
        completeCommandId: input.commandId,
        anomalyFlags,
      });

      const updatedSession = await tx.cleaningSession.findUniqueOrThrow({
        where: { id: session.id },
      });

      const flags = await getFlags();
      const nextTaskStatus = flags.require_inspection
        ? TaskStatus.awaiting_inspection
        : TaskStatus.completed;
      const nextCleaningStatus = flags.require_inspection
        ? CleaningStatus.pending_inspection
        : CleaningStatus.verified_clean;

      await claimTaskStatus(
        tx,
        session.taskId,
        [TaskStatus.in_progress],
        {
          status: nextTaskStatus,
          ...(nextTaskStatus === TaskStatus.completed
            ? { completedAt: finishedAt }
            : {}),
        },
        input.expectedVersion,
      );

      const updatedTask = await tx.cleaningTask.findUniqueOrThrow({
        where: { id: session.taskId },
        include: taskInclude,
      });

      // Soft cycle guard: close the session even if superseded; never overwrite a newer cycle.
      await applyLocationCleaningStatusIfCurrent(
        tx,
        updatedTask.locationId,
        task.cleaningCycle,
        nextCleaningStatus,
      );

      await recordAudit({
        actorEmployeeId: input.employeeId,
        action: "cleaning.session.complete",
        entityType: "cleaning_session",
        entityId: updatedSession.id,
        locationId: updatedTask.locationId,
        after: {
          taskStatus: nextTaskStatus,
          completedAt:
            nextTaskStatus === TaskStatus.completed
              ? finishedAt.toISOString()
              : null,
          notes: input.notes?.trim() || null,
        },
        summary: `Completed cleaning ${updatedTask.location.number}`,
      }, tx);

      return { session: updatedSession, task: updatedTask, idempotent: false };
    });
    if (!result.idempotent) {
      publish("cleaning.changed", {
        locationId: result.task.locationId,
        taskId: result.task.id,
      });
      if (result.task.status === TaskStatus.awaiting_inspection) {
        const recipients = await recipientsForLocationOps(
          result.task.locationId,
          "cleaning.inspect",
        );
        if (result.task.sectorSupervisorEmployeeId) {
          recipients.push(result.task.sectorSupervisorEmployeeId);
        }
        await createNotifications({
          type: "cleaning.needs_inspection",
          title: "Inspection needed",
          body: `Room ${result.task.location.number} awaiting inspection`,
          entityType: "cleaning_task",
          entityId: result.task.id,
          locationId: result.task.locationId,
          actorEmployeeId: input.employeeId,
          recipientEmployeeIds: recipients,
          dedupeKey: `cleaning.needs_inspection:${result.task.id}`,
          payload: {
            panel: "cleaning",
            taskId: result.task.id,
            locationId: result.task.locationId,
            locationNumber: result.task.location.number,
          },
        });
      }
    }
    return result;
  } catch (err) {
    if (isP2002(err)) {
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
  expectedVersion?: number;
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
      const sessionPeek = await tx.cleaningSession.findUnique({
        where: { id: input.sessionId },
      });
      if (!sessionPeek) {
        throw new AppError(404, "not_found", "Session not found");
      }

      await lockTask(tx, sessionPeek.taskId);
      await lockSession(tx, sessionPeek.id);

      const session = await tx.cleaningSession.findUniqueOrThrow({
        where: { id: input.sessionId },
      });
      if (
        !input.bypassSessionOwnerCheck &&
        session.employeeId !== input.employeeId
      ) {
        const taskPeek = await tx.cleaningTask.findUnique({
          where: { id: session.taskId },
        });
        throw new AppError(
          409,
          "assignee_conflict",
          "Session belongs to another employee",
          taskPeek
            ? taskConflictDetails(taskPeek, input.expectedVersion)
            : undefined,
        );
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

      const task = await tx.cleaningTask.findUniqueOrThrow({
        where: { id: session.taskId },
      });
      assertTaskVersion(task, input.expectedVersion);

      const finishedAt = new Date();
      if (finishedAt < session.startedAt) {
        throw new AppError(400, "invalid_time", "Finish time before start time");
      }

      await claimRunningSession(tx, session.id, {
        status: SessionStatus.cancelled,
        finishedAt,
        notes: input.notes?.trim() || null,
        cancelCommandId: input.commandId,
      });

      const updatedSession = await tx.cleaningSession.findUniqueOrThrow({
        where: { id: session.id },
      });

      let updatedTask = await tx.cleaningTask.findUniqueOrThrow({
        where: { id: task.id },
        include: taskInclude,
      });

      // At most one running session per task (DB invariant) — cancel always reverts.
      if (task.status === TaskStatus.in_progress) {
        await claimTaskStatus(
          tx,
          task.id,
          [TaskStatus.in_progress],
          { status: TaskStatus.assigned },
          input.expectedVersion,
        );
        updatedTask = await tx.cleaningTask.findUniqueOrThrow({
          where: { id: task.id },
          include: taskInclude,
        });

        // Soft cycle guard: never overwrite a newer location cycle/status.
        await applyLocationCleaningStatusIfCurrent(
          tx,
          task.locationId,
          task.cleaningCycle,
          CleaningStatus.dirty,
          { onlyIfStatus: CleaningStatus.in_progress },
        );
      }

      await recordAudit({
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
      }, tx);

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
    if (isP2002(err)) {
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
