/**
 * Complete a running cleaning session (idempotent on commandId).
 */
import {
  // Carry this field through the payload or query.
  CleaningStatus,
  // Carry this field through the payload or query.
  SessionStatus,
  // Carry this field through the payload or query.
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
  // Carry this field through the payload or query.
  deliverCleaningInspectionNotice,
  // Carry this field through the payload or query.
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
  // Carry this field through the payload or query.
  loadCleaningCommandInTx,
  // Carry this field through the payload or query.
  loadCleaningCommandPreTx,
  // Field value required by this payload or query.
  replayCleaningCommandOnP2002,
// Execute: } from "./commandReplay";
} from "./commandReplay";
// Side-effect or default import required by this module.
import {
  // Carry this field through the payload or query.
  loadRunningSessionForTerminalCommand,
  // Carry this field through the payload or query.
  peekAndLockSession,
  // Carry this field through the payload or query.
  sessionCommandPayloadMatches,
  // Carry this field through the payload or query.
  sessionWithTaskInclude,
// Execute: } from "./sessionShared";
} from "./sessionShared";
// Type-only import from ../db/types used by cleaning/sessionComplete.ts.
import type { Tx } from "../db/types";

// Local structural type for this module's contracts.
type CompleteInput = {
  // Carry this field through the payload or query.
  sessionId: string;
  // Carry this field through the payload or query.
  employeeId: string;
  // Carry this field through the payload or query.
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
    // Await side effect or helper before continuing.
    await deliverCleaningInspectionNotice(commandId);
  // Begin block/object for the following statements.
  } catch {
    // Intent remains undelivered; later replay / flush repairs.
  }
}

/** Load and assert the session is completable under the current terminal command. */
async function assertCompletable(tx: Tx, input: CompleteInput) {
  // Return the computed result to the caller.
  return loadRunningSessionForTerminalCommand(tx, input, "completed");
}

/** Claim session completion and advance task + location cleaning status. */
async function writeCompletion(
  // Carry this field through the payload or query.
  tx: Tx,
  // Carry this field through the payload or query.
  input: CompleteInput,
  // Carry this field through the payload or query.
  session: CleaningSession & { startedAt: Date },
  // Carry this field through the payload or query.
  task: CleaningTask,
  // Carry this field through the payload or query.
  finishedAt: Date,
// Begin block/object for the following statements.
): Promise<{
  // Carry this field through the payload or query.
  updatedSession: CleaningSession;
  // Carry this field through the payload or query.
  updatedTask: TaskWithIncludes;
  // Carry this field through the payload or query.
  nextTaskStatus: TaskStatus;
// Begin block/object for the following statements.
}> {
  // Load operations needed for the next decision or write.
  const operations = await getOperations();
  // Capture durationMinutes for subsequent checks or writes.
  const durationMinutes =
    // Execute: (finishedAt.getTime() - session.startedAt.getTime()) / 60000;
    (finishedAt.getTime() - session.startedAt.getTime()) / 60000;
  // Capture existingFlags for subsequent checks or writes.
  const existingFlags = Array.isArray(session.anomalyFlags)
    // Continue the previous expression with this clause.
    ? (session.anomalyFlags as string[]).filter(
        // Execute: (f): f is string => typeof f === "string",
        (f): f is string => typeof f === "string",
      )
    // Continue the previous expression with this clause.
    : [];
  // Capture anomalyFlags for subsequent checks or writes.
  const anomalyFlags =
    // Execute: durationMinutes >= operations.overdueSessionMinutes &&
    durationMinutes >= operations.overdueSessionMinutes &&
    // Execute: !existingFlags.includes("overdue")
    !existingFlags.includes("overdue")
      // Continue the previous expression with this clause.
      ? [...existingFlags, "overdue"]
      // Continue the previous expression with this clause.
      : existingFlags;

  // Await side effect or helper before continuing.
  await claimRunningSession(tx, session.id, {
    // Carry this field through the payload or query.
    status: SessionStatus.completed,
    // Carry this field through the payload or query.
    finishedAt,
    // Field value required by this payload or query.
    notes: input.notes?.trim() || null,
    // Carry this field through the payload or query.
    completeCommandId: input.commandId,
    // Carry this field through the payload or query.
    completeActorEmployeeId: input.employeeId,
    // Carry this field through the payload or query.
    anomalyFlags,
  });

  // Load updatedSession needed for the next decision or write.
  const updatedSession = await tx.cleaningSession.findUniqueOrThrow({
    // Restrict the query to the relevant rows only.
    where: { id: session.id },
  });

  // Load flags needed for the next decision or write.
  const flags = await getFlags();
  // Capture nextTaskStatus for subsequent checks or writes.
  const nextTaskStatus = flags.require_inspection
    // Continue the previous expression with this clause.
    ? TaskStatus.awaiting_inspection
    // Continue the previous expression with this clause.
    : TaskStatus.completed;
  // Capture nextCleaningStatus for subsequent checks or writes.
  const nextCleaningStatus = flags.require_inspection
    // Continue the previous expression with this clause.
    ? CleaningStatus.pending_inspection
    // Continue the previous expression with this clause.
    : CleaningStatus.verified_clean;

  // Await side effect or helper before continuing.
  await claimTaskStatus(
    // Carry this field through the payload or query.
    tx,
    // Execute: session.taskId,
    session.taskId,
    // Execute: [TaskStatus.in_progress],
    [TaskStatus.in_progress],
    // Begin block/object for the following statements.
    {
      // Carry this field through the payload or query.
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
    // Carry this field through the payload or query.
    tx,
    // Execute: updatedTask.locationId,
    updatedTask.locationId,
    // Execute: task.cleaningCycle,
    task.cleaningCycle,
    // Carry this field through the payload or query.
    nextCleaningStatus,
  );
  // Guard: handle missing/invalid state before continuing.
  if (!locationUpdated) {
    // Await side effect or helper before continuing.
    await healOrphanIfTaskCycleCurrent(
      // Carry this field through the payload or query.
      tx,
      // Execute: updatedTask.locationId,
      updatedTask.locationId,
      // Execute: task.cleaningCycle,
      task.cleaningCycle,
    );
  }

  // Return the computed result to the caller.
  return { updatedSession, updatedTask, nextTaskStatus };
}

/** Enqueue inspection notice when the task entered awaiting_inspection. */
async function enqueueInspectionNotice(
  // Carry this field through the payload or query.
  tx: Tx,
  // Carry this field through the payload or query.
  input: CompleteInput,
  // Carry this field through the payload or query.
  updatedTask: TaskWithIncludes,
  // Carry this field through the payload or query.
  nextTaskStatus: TaskStatus,
// Begin block/object for the following statements.
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
  // Await side effect or helper before continuing.
  await enqueueCleaningInspectionNotice(tx, input.commandId, {
    // Field value required by this payload or query.
    type: "cleaning.needs_inspection",
    // Field value required by this payload or query.
    title: "Inspection needed",
    // Field value required by this payload or query.
    body: `Room ${updatedTask.location.number} awaiting inspection`,
    // Field value required by this payload or query.
    entityType: "cleaning_task",
    // Carry this field through the payload or query.
    entityId: updatedTask.id,
    // Carry this field through the payload or query.
    locationId: updatedTask.locationId,
    // Carry this field through the payload or query.
    actorEmployeeId: input.employeeId,
    // Carry this field through the payload or query.
    recipientEmployeeIds: recipients,
    // Field value required by this payload or query.
    dedupeKey: `cleaning.needs_inspection:${updatedTask.id}`,
    // Open nested structure for the next related fields.
    payload: {
      // Field value required by this payload or query.
      panel: "rooms",
      // Carry this field through the payload or query.
      taskId: updatedTask.id,
      // Carry this field through the payload or query.
      locationId: updatedTask.locationId,
      // Carry this field through the payload or query.
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
      // Begin block/object for the following statements.
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
    // Await side effect or helper before continuing.
    await deliverCompleteNoticeIfReplay(input.commandId);
    // Return the computed result to the caller.
    return {
      // Carry this field through the payload or query.
      session: existingByCommand,
      // Carry this field through the payload or query.
      task: existingByCommand.task,
      // Field value required by this payload or query.
      idempotent: true,
    };
  }

  // Isolate fallible work so conflicts can be mapped cleanly.
  try {
    // Load result needed for the next decision or write.
    const result = await prisma.$transaction(async (tx) => {
      // Await side effect or helper before continuing.
      await peekAndLockSession(tx, input.sessionId);

      // Load replay needed for the next decision or write.
      const replay = await loadCleaningCommandInTx(
        // Carry this field through the payload or query.
        tx,
        // Execute: (t) =>
        (t) =>
          // Begin block/object for the following statements.
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
        // Await side effect or helper before continuing.
        await writeCompletion(tx, input, session, task, finishedAt);

      // Await side effect or helper before continuing.
      await recordAudit(
        // Begin block/object for the following statements.
        {
          // Carry this field through the payload or query.
          actorEmployeeId: input.employeeId,
          // Field value required by this payload or query.
          action: "cleaning.session.complete",
          // Field value required by this payload or query.
          entityType: "cleaning_session",
          // Carry this field through the payload or query.
          entityId: updatedSession.id,
          // Carry this field through the payload or query.
          locationId: updatedTask.locationId,
          // Open nested structure for the next related fields.
          after: {
            // Carry this field through the payload or query.
            taskStatus: nextTaskStatus,
            // Carry this field through the payload or query.
            completedAt:
              // Execute: nextTaskStatus === TaskStatus.completed
              nextTaskStatus === TaskStatus.completed
                // Continue the previous expression with this clause.
                ? finishedAt.toISOString()
                // Continue the previous expression with this clause.
                : null,
            // Field value required by this payload or query.
            notes: input.notes?.trim() || null,
          },
          // Field value required by this payload or query.
          summary: `Completed cleaning ${updatedTask.location.number}`,
        },
        // Carry this field through the payload or query.
        tx,
      );

      // Await side effect or helper before continuing.
      await enqueueInspectionNotice(tx, input, updatedTask, nextTaskStatus);

      // Early return of a terminal empty/boolean result.
      return { session: updatedSession, task: updatedTask, idempotent: false };
    });

    // Guard: handle missing/invalid state before continuing.
    if (!result.idempotent) {
      // Begin block/object for the following statements.
      publish("cleaning.changed", {
        // Carry this field through the payload or query.
        locationId: result.task.locationId,
        // Carry this field through the payload or query.
        taskId: result.task.id,
      });
    }
    // Isolate fallible work so conflicts can be mapped cleanly.
    try {
      // Await side effect or helper before continuing.
      await deliverCleaningInspectionNotice(input.commandId);
    // Begin block/object for the following statements.
    } catch {
      // Intent remains undelivered; replay / flushCleaningNotificationOutbox repairs.
    }
    // Return the computed result to the caller.
    return result;
  // Begin block/object for the following statements.
  } catch (err) {
    // Load again needed for the next decision or write.
    const again = await replayCleaningCommandOnP2002(
      // Carry this field through the payload or query.
      err,
      // Execute: () =>
      () =>
        // Begin block/object for the following statements.
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
      // Await side effect or helper before continuing.
      await deliverCompleteNoticeIfReplay(input.commandId);
      // Early return of a terminal empty/boolean result.
      return { session: again, task: again.task, idempotent: true };
    }
    // Abort with an HTTP-mapped AppError or rethrow.
    throw err;
  }
}
