/**
 * Complete a running cleaning session (idempotent on commandId).
 */
import {
  CleaningStatus,
  SessionStatus,
  TaskStatus,
  type CleaningSession,
  type CleaningTask,
  type Prisma,
} from "@prisma/client";
import { prisma } from "../../db";
import { publish } from "../../events/bus";
import { getFlags, getOperations } from "../settings";
import { recordAudit } from "../audit";
import { recipientsForLocationOps } from "../notifications";
import {
  deliverCleaningInspectionNotice,
  enqueueCleaningInspectionNotice,
} from "./notificationOutbox";
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
import type { Tx } from "../db/types";

type CompleteInput = {
  sessionId: string;
  employeeId: string;
  commandId: string;
  notes?: string;
  expectedVersion?: number;
  /** Owner may complete a session started by someone else. */
  bypassSessionOwnerCheck?: boolean;
};

type TaskWithIncludes = Prisma.CleaningTaskGetPayload<{
  include: typeof taskInclude;
}>;

async function deliverCompleteNoticeIfReplay(commandId: string): Promise<void> {
  try {
    await deliverCleaningInspectionNotice(commandId);
  } catch {
    // Intent remains undelivered; later replay / flush repairs.
  }
}

/** Load and assert the session is completable under the current terminal command. */
async function assertCompletable(tx: Tx, input: CompleteInput) {
  return loadRunningSessionForTerminalCommand(tx, input, "completed");
}

/** Claim session completion and advance task + location cleaning status. */
async function writeCompletion(
  tx: Tx,
  input: CompleteInput,
  session: CleaningSession & { startedAt: Date },
  task: CleaningTask,
  finishedAt: Date,
): Promise<{
  updatedSession: CleaningSession;
  updatedTask: TaskWithIncludes;
  nextTaskStatus: TaskStatus;
}> {
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
    completeActorEmployeeId: input.employeeId,
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

  const locationUpdated = await applyLocationCleaningStatusIfCurrent(
    tx,
    updatedTask.locationId,
    task.cleaningCycle,
    nextCleaningStatus,
  );
  if (!locationUpdated) {
    await healOrphanIfTaskCycleCurrent(
      tx,
      updatedTask.locationId,
      task.cleaningCycle,
    );
  }

  return { updatedSession, updatedTask, nextTaskStatus };
}

/** Enqueue inspection notice when the task entered awaiting_inspection. */
async function enqueueInspectionNotice(
  tx: Tx,
  input: CompleteInput,
  updatedTask: TaskWithIncludes,
  nextTaskStatus: TaskStatus,
): Promise<void> {
  if (nextTaskStatus !== TaskStatus.awaiting_inspection) return;

  const recipients = await recipientsForLocationOps(
    updatedTask.locationId,
    "cleaning.inspect",
  );
  if (updatedTask.sectorSupervisorEmployeeId) {
    recipients.push(updatedTask.sectorSupervisorEmployeeId);
  }
  await enqueueCleaningInspectionNotice(tx, input.commandId, {
    type: "cleaning.needs_inspection",
    title: "Inspection needed",
    body: `Room ${updatedTask.location.number} awaiting inspection`,
    entityType: "cleaning_task",
    entityId: updatedTask.id,
    locationId: updatedTask.locationId,
    actorEmployeeId: input.employeeId,
    recipientEmployeeIds: recipients,
    dedupeKey: `cleaning.needs_inspection:${updatedTask.id}`,
    payload: {
      panel: "rooms",
      taskId: updatedTask.id,
      locationId: updatedTask.locationId,
      locationNumber: updatedTask.location.number,
    },
  });
}

/**
 * Complete a running session (idempotent on `commandId`). Moves the task to
 * awaiting_inspection or completed depending on inspection flags / auto-accept.
 */
export async function completeCleaningSession(input: CompleteInput) {
  const existingByCommand = await loadCleaningCommandPreTx(
    () =>
      prisma.cleaningSession.findUnique({
        where: { completeCommandId: input.commandId },
        include: sessionWithTaskInclude,
      }),
    (row) => sessionCommandPayloadMatches(row, input, "complete"),
  );
  if (existingByCommand) {
    await deliverCompleteNoticeIfReplay(input.commandId);
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
            where: { completeCommandId: input.commandId },
            include: sessionWithTaskInclude,
          }),
        (row) => sessionCommandPayloadMatches(row, input, "complete"),
      );
      if (replay) {
        return { session: replay, task: replay.task, idempotent: true };
      }

      const { session, task, finishedAt } = await assertCompletable(tx, input);
      const { updatedSession, updatedTask, nextTaskStatus } =
        await writeCompletion(tx, input, session, task, finishedAt);

      await recordAudit(
        {
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
        },
        tx,
      );

      await enqueueInspectionNotice(tx, input, updatedTask, nextTaskStatus);

      return { session: updatedSession, task: updatedTask, idempotent: false };
    });

    if (!result.idempotent) {
      publish("cleaning.changed", {
        locationId: result.task.locationId,
        taskId: result.task.id,
      });
    }
    try {
      await deliverCleaningInspectionNotice(input.commandId);
    } catch {
      // Intent remains undelivered; replay / flushCleaningNotificationOutbox repairs.
    }
    return result;
  } catch (err) {
    const again = await replayCleaningCommandOnP2002(
      err,
      () =>
        prisma.cleaningSession.findUnique({
          where: { completeCommandId: input.commandId },
          include: sessionWithTaskInclude,
        }),
      (row) => sessionCommandPayloadMatches(row, input, "complete"),
    );
    if (again) {
      await deliverCompleteNoticeIfReplay(input.commandId);
      return { session: again, task: again.task, idempotent: true };
    }
    throw err;
  }
}
