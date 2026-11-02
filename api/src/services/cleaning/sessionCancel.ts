/**
 * Cancel a running cleaning session (idempotent on commandId).
 */
import { CleaningStatus, SessionStatus, TaskStatus } from "@prisma/client";
import { prisma } from "../../db";
import { publish } from "../../events/bus";
import { recordAudit } from "../audit";
import { taskInclude } from "../cleaningTasksQuery";
import { claimRunningSession, claimTaskStatus } from "./claims";
import { applyLocationCleaningStatusIfCurrent } from "./locationStatus";
import { healOrphanIfTaskCycleCurrent } from "../locations/reconcileCleaningStatus";
import {
  loadCleaningCommandInTx,
  loadCleaningCommandPreTx,
  replayCleaningCommandOnP2002,
} from "./commandReplay";
import {
  loadRunningSessionForTerminalCommand,
  peekAndLockSession,
  sessionCommandPayloadMatches,
  sessionWithTaskInclude,
} from "./sessionShared";

/**
 * Cancel a running session (idempotent on `commandId`) and revert the task
 * toward an assignable state when no other running session remains.
 */
export async function cancelCleaningSession(input: {
  sessionId: string;
  employeeId: string;
  /** Idempotency key stored on session.cancelCommandId. */
  commandId: string;
  notes?: string;
  expectedVersion?: number;
  /** Reviewer / owner may cancel a session started by someone else. */
  bypassSessionOwnerCheck?: boolean;
}) {
  const existingByCommand = await loadCleaningCommandPreTx(
    () =>
      prisma.cleaningSession.findUnique({
        where: { cancelCommandId: input.commandId },
        include: sessionWithTaskInclude,
      }),
    (row) => sessionCommandPayloadMatches(row, input, "cancel"),
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
      await peekAndLockSession(tx, input.sessionId);

      const replay = await loadCleaningCommandInTx(
        tx,
        (t) =>
          t.cleaningSession.findUnique({
            where: { cancelCommandId: input.commandId },
            include: sessionWithTaskInclude,
          }),
        (row) => sessionCommandPayloadMatches(row, input, "cancel"),
      );
      if (replay) {
        return { session: replay, task: replay.task, idempotent: true };
      }

      const { session, task, finishedAt } =
        await loadRunningSessionForTerminalCommand(tx, input, "cancelled");

      await claimRunningSession(tx, session.id, {
        status: SessionStatus.cancelled,
        finishedAt,
        notes: input.notes?.trim() || null,
        cancelCommandId: input.commandId,
        cancelActorEmployeeId: input.employeeId,
      });

      const updatedSession = await tx.cleaningSession.findUniqueOrThrow({
        where: { id: session.id },
      });

      let updatedTask = await tx.cleaningTask.findUniqueOrThrow({
        where: { id: task.id },
        include: taskInclude,
      });

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

        const locationUpdated = await applyLocationCleaningStatusIfCurrent(
          tx,
          task.locationId,
          task.cleaningCycle,
          CleaningStatus.dirty,
          { onlyIfStatus: CleaningStatus.in_progress },
        );
        if (!locationUpdated) {
          await healOrphanIfTaskCycleCurrent(
            tx,
            task.locationId,
            task.cleaningCycle,
          );
        }
      }

      await recordAudit(
        {
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
        },
        tx,
      );

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
    const again = await replayCleaningCommandOnP2002(
      err,
      () =>
        prisma.cleaningSession.findUnique({
          where: { cancelCommandId: input.commandId },
          include: sessionWithTaskInclude,
        }),
      (row) => sessionCommandPayloadMatches(row, input, "cancel"),
    );
    if (again) {
      return { session: again, task: again.task, idempotent: true };
    }
    throw err;
  }
}
