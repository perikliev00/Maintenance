/**
 * Start a cleaning session for a task (idempotent on commandId).
 */
import { CleaningStatus, SessionStatus, TaskStatus } from "@prisma/client";
import { prisma } from "../../db";
import { assertActiveWorkStarter } from "../assignees";
import { AppError } from "../../errors";
import { publish } from "../../events/bus";
import { recordAudit } from "../audit";
import { taskInclude } from "../cleaningTasksQuery";
import {
  assertTaskVersion,
  claimTaskStatus,
  taskConflictDetails,
} from "./claims";
import { ensureTaskCycleForStart } from "./cycles";
import { applyLocationCleaningStatusIfCurrent } from "./locationStatus";
import { lockTask } from "./locks";
import {
  loadCleaningCommandInTx,
  loadCleaningCommandPreTx,
  replayCleaningCommandOnP2002,
} from "./commandReplay";
import { isP2002, mapStartUniqueConflict } from "./prismaConflicts";
import {
  sessionWithTaskInclude,
  startSessionPayloadMatches,
} from "./sessionShared";

/**
 * Start a cleaning session for a task. Idempotent on `commandId`.
 * Binds the task to the current cleaning cycle when unbound or stale.
 */
export async function startCleaningTask(input: {
  taskId: string;
  employeeId: string;
  /** Idempotency key for offline start retries (unique startCommandId). */
  commandId: string;
  expectedVersion?: number;
  /** Owner may start a task assigned to someone else. */
  bypassAssigneeCheck?: boolean;
}) {
  const existingByCommand = await loadCleaningCommandPreTx(
    () =>
      prisma.cleaningSession.findUnique({
        where: { startCommandId: input.commandId },
        include: sessionWithTaskInclude,
      }),
    (row) => startSessionPayloadMatches(row, input),
  );
  if (existingByCommand) {
    return {
      session: existingByCommand,
      task: existingByCommand.task,
      idempotent: true,
    };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Lock the starter before the task. Reassignment locks affected users
      // before the task too, so the shared User -> CleaningTask order prevents
      // a start/reassign lock cycle.
      await assertActiveWorkStarter(input.employeeId, tx);
      await lockTask(tx, input.taskId);

      const replay = await loadCleaningCommandInTx(
        tx,
        (t) =>
          t.cleaningSession.findUnique({
            where: { startCommandId: input.commandId },
            include: sessionWithTaskInclude,
          }),
        (row) => startSessionPayloadMatches(row, input),
      );
      if (replay) {
        return { session: replay, task: replay.task, idempotent: true };
      }

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

      const cleaningCycle = await ensureTaskCycleForStart(tx, task);

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
        throw new AppError(
          409,
          "conflict",
          "Employee already has a running session",
        );
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

      await recordAudit(
        {
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
        },
        tx,
      );

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
    const again = await replayCleaningCommandOnP2002(
      err,
      () =>
        prisma.cleaningSession.findUnique({
          where: { startCommandId: input.commandId },
          include: sessionWithTaskInclude,
        }),
      (row) => startSessionPayloadMatches(row, input),
    );
    if (again) {
      return { session: again, task: again.task, idempotent: true };
    }
    if (isP2002(err)) {
      mapStartUniqueConflict(err);
    }
    throw err;
  }
}
