/**
 * Cancel a running cleaning session (idempotent on commandId).
 */
import { CleaningStatus, SessionStatus, TaskStatus } from "@prisma/client";
// Import ../../db for cleaning/sessionCancel.ts.
import { prisma } from "../../db";
// Import ../../events/bus for cleaning/sessionCancel.ts.
import { publish } from "../../events/bus";
// Import ../audit for cleaning/sessionCancel.ts.
import { recordAudit } from "../audit";
// Import ../cleaningTasksQuery for cleaning/sessionCancel.ts.
import { taskInclude } from "../cleaningTasksQuery";
// Import ./claims for cleaning/sessionCancel.ts.
import { claimRunningSession, claimTaskStatus } from "./claims";
// Import ./locationStatus for cleaning/sessionCancel.ts.
import { applyLocationCleaningStatusIfCurrent } from "./locationStatus";
// Import ../locations/reconcileCleaningStatus for cleaning/sessionCancel.ts.
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

/**
 * Cancel a running session (idempotent on `commandId`) and revert the task
 * toward an assignable state when no other running session remains.
 */
export async function cancelCleaningSession(input: {
  // Carry this field through the payload or query.
  sessionId: string;
  // Carry this field through the payload or query.
  employeeId: string;
  /** Idempotency key stored on session.cancelCommandId. */
  commandId: string;
  // Parameter/field in the surrounding signature or type.
  notes?: string;
  // Parameter/field in the surrounding signature or type.
  expectedVersion?: number;
  /** Reviewer / owner may cancel a session started by someone else. */
  bypassSessionOwnerCheck?: boolean;
// Begin block/object for the following statements.
}) {
  // Load existingByCommand needed for the next decision or write.
  const existingByCommand = await loadCleaningCommandPreTx(
    // Execute: () =>
    () =>
      // Begin block/object for the following statements.
      prisma.cleaningSession.findUnique({
        // Restrict the query to the relevant rows only.
        where: { cancelCommandId: input.commandId },
        // Eager-load relations needed by the API response shape.
        include: sessionWithTaskInclude,
      }),
    // Execute: (row) => sessionCommandPayloadMatches(row, input, "cancel"),
    (row) => sessionCommandPayloadMatches(row, input, "cancel"),
  );
  // Branch when this condition holds for the domain rule.
  if (existingByCommand) {
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
            where: { cancelCommandId: input.commandId },
            // Eager-load relations needed by the API response shape.
            include: sessionWithTaskInclude,
          }),
        // Execute: (row) => sessionCommandPayloadMatches(row, input, "cancel"),
        (row) => sessionCommandPayloadMatches(row, input, "cancel"),
      );
      // Branch when this condition holds for the domain rule.
      if (replay) {
        // Early return of a terminal empty/boolean result.
        return { session: replay, task: replay.task, idempotent: true };
      }

      // Execute: const { session, task, finishedAt } =
      const { session, task, finishedAt } =
        // Await side effect or helper before continuing.
        await loadRunningSessionForTerminalCommand(tx, input, "cancelled");

      // Await side effect or helper before continuing.
      await claimRunningSession(tx, session.id, {
        // Carry this field through the payload or query.
        status: SessionStatus.cancelled,
        // Carry this field through the payload or query.
        finishedAt,
        // Field value required by this payload or query.
        notes: input.notes?.trim() || null,
        // Carry this field through the payload or query.
        cancelCommandId: input.commandId,
        // Carry this field through the payload or query.
        cancelActorEmployeeId: input.employeeId,
      });

      // Load updatedSession needed for the next decision or write.
      const updatedSession = await tx.cleaningSession.findUniqueOrThrow({
        // Restrict the query to the relevant rows only.
        where: { id: session.id },
      });

      // Load updatedTask needed for the next decision or write.
      let updatedTask = await tx.cleaningTask.findUniqueOrThrow({
        // Restrict the query to the relevant rows only.
        where: { id: task.id },
        // Eager-load relations needed by the API response shape.
        include: taskInclude,
      });

      // Branch when this condition holds for the domain rule.
      if (task.status === TaskStatus.in_progress) {
        // Await side effect or helper before continuing.
        await claimTaskStatus(
          // Carry this field through the payload or query.
          tx,
          // Execute: task.id,
          task.id,
          // Execute: [TaskStatus.in_progress],
          [TaskStatus.in_progress],
          // Execute: { status: TaskStatus.assigned },
          { status: TaskStatus.assigned },
          // Execute: input.expectedVersion,
          input.expectedVersion,
        );
        // Begin block/object for the following statements.
        updatedTask = await tx.cleaningTask.findUniqueOrThrow({
          // Restrict the query to the relevant rows only.
          where: { id: task.id },
          // Eager-load relations needed by the API response shape.
          include: taskInclude,
        });

        // Load locationUpdated needed for the next decision or write.
        const locationUpdated = await applyLocationCleaningStatusIfCurrent(
          // Carry this field through the payload or query.
          tx,
          // Execute: task.locationId,
          task.locationId,
          // Execute: task.cleaningCycle,
          task.cleaningCycle,
          // Execute: CleaningStatus.dirty,
          CleaningStatus.dirty,
          // Execute: { onlyIfStatus: CleaningStatus.in_progress },
          { onlyIfStatus: CleaningStatus.in_progress },
        );
        // Guard: handle missing/invalid state before continuing.
        if (!locationUpdated) {
          // Await side effect or helper before continuing.
          await healOrphanIfTaskCycleCurrent(
            // Carry this field through the payload or query.
            tx,
            // Execute: task.locationId,
            task.locationId,
            // Execute: task.cleaningCycle,
            task.cleaningCycle,
          );
        }
      }

      // Await side effect or helper before continuing.
      await recordAudit(
        // Begin block/object for the following statements.
        {
          // Carry this field through the payload or query.
          actorEmployeeId: input.employeeId,
          // Field value required by this payload or query.
          action: "cleaning.session.cancel",
          // Field value required by this payload or query.
          entityType: "cleaning_session",
          // Carry this field through the payload or query.
          entityId: updatedSession.id,
          // Carry this field through the payload or query.
          locationId: updatedTask.locationId,
          // Open nested structure for the next related fields.
          after: {
            // Carry this field through the payload or query.
            taskStatus: updatedTask.status,
            // Field value required by this payload or query.
            notes: input.notes?.trim() || null,
          },
          // Field value required by this payload or query.
          summary: `Cancelled cleaning session for ${updatedTask.location.number}`,
        },
        // Carry this field through the payload or query.
        tx,
      );

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
          where: { cancelCommandId: input.commandId },
          // Eager-load relations needed by the API response shape.
          include: sessionWithTaskInclude,
        }),
      // Execute: (row) => sessionCommandPayloadMatches(row, input, "cancel"),
      (row) => sessionCommandPayloadMatches(row, input, "cancel"),
    );
    // Branch when this condition holds for the domain rule.
    if (again) {
      // Early return of a terminal empty/boolean result.
      return { session: again, task: again.task, idempotent: true };
    }
    // Abort with an HTTP-mapped AppError or rethrow.
    throw err;
  }
}
