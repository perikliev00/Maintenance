/**
 * Complete a running cleaning session (idempotent on commandId).
 */
import {
  CleaningStatus,
  SessionStatus,
  TaskStatus,
  // Local structural type for this module's contracts.
  type CleaningSession,
  // Local structural type for this module's contracts.
  type CleaningTask,
  // Local structural type for this module's contracts.
  type Prisma,
// Execute: } from "@prisma/client";
} from "@prisma/client";
// Import ../../db for cleaning/sessionComplete.ts.
import { prisma } from "../../db";
// Import ../../events/bus for cleaning/sessionComplete.ts.
import { publish } from "../../events/bus";
// Import ../settings for cleaning/sessionComplete.ts.
import { getFlags, getOperations } from "../settings";
// Import ../audit for cleaning/sessionComplete.ts.
import { recordAudit } from "../audit";
// Import ../notifications for cleaning/sessionComplete.ts.
import { recipientsForLocationOps } from "../notifications";
// Side-effect or default import required by this module.
import {
  deliverCleaningInspectionNotice,
  enqueueCleaningInspectionNotice,
// Execute: } from "./notificationOutbox";
} from "./notificationOutbox";
// Import ../cleaningTasksQuery for cleaning/sessionComplete.ts.
import { taskInclude } from "../cleaningTasksQuery";
// Import ./claims for cleaning/sessionComplete.ts.
import { claimRunningSession, claimTaskStatus } from "./claims";
// Import ./locationStatus for cleaning/sessionComplete.ts.
import { applyLocationCleaningStatusIfCurrent } from "./locationStatus";
// Import ../locations/reconcileCleaningStatus for cleaning/sessionComplete.ts.
import { healOrphanIfTaskCycleCurrent } from "../locations/reconcileCleaningStatus";
// Side-effect or default import required by this module.
import {
  loadCleaningCommandInTx,
  loadCleaningCommandPreTx,
  replayCleaningCommandOnP2002,
// Execute: } from "./commandReplay";
} from "./commandReplay";
// Side-effect or default import required by this module.
import {
  loadRunningSessionForTerminalCommand,
  peekAndLockSession,
  sessionCommandPayloadMatches,
  sessionWithTaskInclude,
// Execute: } from "./sessionShared";
} from "./sessionShared";
import type { Tx } from "../db/types";

// Local structural type for this module's contracts.
type CompleteInput = {
  sessionId: string;
  employeeId: string;
  commandId: string;
  // Parameter/field in the surrounding signature or type.
  notes?: string;
  // Parameter/field in the surrounding signature or type.
  expectedVersion?: number;
  /** Owner may complete a session started by someone else. */
  bypassSessionOwnerCheck?: boolean;
};

// Local structural type for this module's contracts.
type TaskWithIncludes = Prisma.CleaningTaskGetPayload<{
  // Eager-load relations needed by the API response shape.
  include: typeof taskInclude;
// Execute: }>;
}>;

// Local helper deliverCompleteNoticeIfReplay keeps the main flow readable.
async function deliverCompleteNoticeIfReplay(commandId: string): Promise<void> {
  // Isolate fallible work so conflicts can be mapped cleanly.
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
  // Load operations needed for the next decision or write.
  const operations = await getOperations();
  const durationMinutes =
    // Execute: (finishedAt.getTime() - session.startedAt.getTime()) / 60000;
    (finishedAt.getTime() - session.startedAt.getTime()) / 60000;
  const existingFlags = Array.isArray(session.anomalyFlags)
    // Continue the previous expression with this clause.
    ? (session.anomalyFlags as string[]).filter(
        // Execute: (f): f is string => typeof f === "string",
        (f): f is string => typeof f === "string",
      )
    // Continue the previous expression with this clause.
    : [];
  const anomalyFlags =
    // Execute: durationMinutes >= operations.overdueSessionMinutes &&
    durationMinutes >= operations.overdueSessionMinutes &&
    // Execute: !existingFlags.includes("overdue")
    !existingFlags.includes("overdue")
      // Continue the previous expression with this clause.
      ? [...existingFlags, "overdue"]
      // Continue the previous expression with this clause.
      : existingFlags;

  await claimRunningSession(tx, session.id, {
    status: SessionStatus.completed,
    finishedAt,
    notes: input.notes?.trim() || null,
    completeCommandId: input.commandId,
    completeActorEmployeeId: input.employeeId,
    anomalyFlags,
  });

  // Load updatedSession needed for the next decision or write.
  const updatedSession = await tx.cleaningSession.findUniqueOrThrow({
    // Restrict the query to the relevant rows only.
    where: { id: session.id },
  });

  // Load flags needed for the next decision or write.
  const flags = await getFlags();
  const nextTaskStatus = flags.require_inspection
    // Continue the previous expression with this clause.
    ? TaskStatus.awaiting_inspection
    // Continue the previous expression with this clause.
    : TaskStatus.completed;
  const nextCleaningStatus = flags.require_inspection
    // Continue the previous expression with this clause.
    ? CleaningStatus.pending_inspection
    // Continue the previous expression with this clause.
    : CleaningStatus.verified_clean;

  await claimTaskStatus(
    tx,
    // Execute: session.taskId,
    session.taskId,
    // Execute: [TaskStatus.in_progress],
    [TaskStatus.in_progress],
    {
      status: nextTaskStatus,
      // Continue the previous expression with this clause.
      ...(nextTaskStatus === TaskStatus.completed
        // Continue the previous expression with this clause.
        ? { completedAt: finishedAt }
        // Continue the previous expression with this clause.
        : {}),
    },
    // Execute: input.expectedVersion,
    input.expectedVersion,
  );

  // Load updatedTask needed for the next decision or write.
  const updatedTask = await tx.cleaningTask.findUniqueOrThrow({
    // Restrict the query to the relevant rows only.
    where: { id: session.taskId },
    // Eager-load relations needed by the API response shape.
    include: taskInclude,
  });

  // Load locationUpdated needed for the next decision or write.
  const locationUpdated = await applyLocationCleaningStatusIfCurrent(
    tx,
    // Execute: updatedTask.locationId,
    updatedTask.locationId,
    // Execute: task.cleaningCycle,
    task.cleaningCycle,
    nextCleaningStatus,
  );
  // Guard: handle missing/invalid state before continuing.
  if (!locationUpdated) {
    await healOrphanIfTaskCycleCurrent(
      tx,
      // Execute: updatedTask.locationId,
      updatedTask.locationId,
      // Execute: task.cleaningCycle,
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
  // Guard: handle missing/invalid state before continuing.
  if (nextTaskStatus !== TaskStatus.awaiting_inspection) return;

  // Load recipients needed for the next decision or write.
  const recipients = await recipientsForLocationOps(
    // Execute: updatedTask.locationId,
    updatedTask.locationId,
    // Execute: "cleaning.inspect",
    "cleaning.inspect",
  );
  // Branch when this condition holds for the domain rule.
  if (updatedTask.sectorSupervisorEmployeeId) {
    // Execute: recipients.push(updatedTask.sectorSupervisorEmployeeId);
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
    // Open nested structure for the next related fields.
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
  // Load existingByCommand needed for the next decision or write.
  const existingByCommand = await loadCleaningCommandPreTx(
    // Execute: () =>
    () =>
      prisma.cleaningSession.findUnique({
        // Restrict the query to the relevant rows only.
        where: { completeCommandId: input.commandId },
        // Eager-load relations needed by the API response shape.
        include: sessionWithTaskInclude,
      }),
    // Execute: (row) => sessionCommandPayloadMatches(row, input, "complete"),
    (row) => sessionCommandPayloadMatches(row, input, "complete"),
  );
  // Branch when this condition holds for the domain rule.
  if (existingByCommand) {
    await deliverCompleteNoticeIfReplay(input.commandId);
    return {
      session: existingByCommand,
      task: existingByCommand.task,
      idempotent: true,
    };
  }

  // Isolate fallible work so conflicts can be mapped cleanly.
  try {
    // Load result needed for the next decision or write.
    const result = await prisma.$transaction(async (tx) => {
      await peekAndLockSession(tx, input.sessionId);

      // Load replay needed for the next decision or write.
      const replay = await loadCleaningCommandInTx(
        tx,
        // Execute: (t) =>
        (t) =>
          t.cleaningSession.findUnique({
            // Restrict the query to the relevant rows only.
            where: { completeCommandId: input.commandId },
            // Eager-load relations needed by the API response shape.
            include: sessionWithTaskInclude,
          }),
        // Execute: (row) => sessionCommandPayloadMatches(row, input, "complete"),
        (row) => sessionCommandPayloadMatches(row, input, "complete"),
      );
      // Branch when this condition holds for the domain rule.
      if (replay) {
        // Early return of a terminal empty/boolean result.
        return { session: replay, task: replay.task, idempotent: true };
      }

      // Execute: const { session, task, finishedAt } = await assertCompletable(tx, input);
      const { session, task, finishedAt } = await assertCompletable(tx, input);
      // Execute: const { updatedSession, updatedTask, nextTaskStatus } =
      const { updatedSession, updatedTask, nextTaskStatus } =
        await writeCompletion(tx, input, session, task, finishedAt);

      await recordAudit(
        {
          actorEmployeeId: input.employeeId,
          action: "cleaning.session.complete",
          entityType: "cleaning_session",
          entityId: updatedSession.id,
          locationId: updatedTask.locationId,
          // Open nested structure for the next related fields.
          after: {
            taskStatus: nextTaskStatus,
            completedAt:
              // Execute: nextTaskStatus === TaskStatus.completed
              nextTaskStatus === TaskStatus.completed
                // Continue the previous expression with this clause.
                ? finishedAt.toISOString()
                // Continue the previous expression with this clause.
                : null,
            notes: input.notes?.trim() || null,
          },
          summary: `Completed cleaning ${updatedTask.location.number}`,
        },
        tx,
      );

      await enqueueInspectionNotice(tx, input, updatedTask, nextTaskStatus);

      // Early return of a terminal empty/boolean result.
      return { session: updatedSession, task: updatedTask, idempotent: false };
    });

    // Guard: handle missing/invalid state before continuing.
    if (!result.idempotent) {
      publish("cleaning.changed", {
        locationId: result.task.locationId,
        taskId: result.task.id,
      });
    }
    // Isolate fallible work so conflicts can be mapped cleanly.
    try {
      await deliverCleaningInspectionNotice(input.commandId);
    } catch {
      // Intent remains undelivered; replay / flushCleaningNotificationOutbox repairs.
    }
    return result;
  } catch (err) {
    // Load again needed for the next decision or write.
    const again = await replayCleaningCommandOnP2002(
      err,
      // Execute: () =>
      () =>
        prisma.cleaningSession.findUnique({
          // Restrict the query to the relevant rows only.
          where: { completeCommandId: input.commandId },
          // Eager-load relations needed by the API response shape.
          include: sessionWithTaskInclude,
        }),
      // Execute: (row) => sessionCommandPayloadMatches(row, input, "complete"),
      (row) => sessionCommandPayloadMatches(row, input, "complete"),
    );
    // Branch when this condition holds for the domain rule.
    if (again) {
      await deliverCompleteNoticeIfReplay(input.commandId);
      // Early return of a terminal empty/boolean result.
      return { session: again, task: again.task, idempotent: true };
    }
    // Abort with an HTTP-mapped AppError or rethrow.
    throw err;
  }
}
