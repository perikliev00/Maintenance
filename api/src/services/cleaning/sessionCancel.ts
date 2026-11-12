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

/**
 * Cancel a running session (idempotent on `commandId`) and revert the task
 * toward an assignable state when no other running session remains.
 */
export async function cancelCleaningSession(input: {
  sessionId: string;
  employeeId: string;
  /** Idempotency key stored on session.cancelCommandId. */
  commandId: string;
  // Parameter/field in the surrounding signature or type.
  notes?: string;
  // Parameter/field in the surrounding signature or type.
  expectedVersion?: number;
  /** Reviewer / owner may cancel a session started by someone else. */
  bypassSessionOwnerCheck?: boolean;
}) {
  // Load existingByCommand needed for the next decision or write.
  const existingByCommand = await loadCleaningCommandPreTx(
    // Execute: () =>
    () =>
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
        await loadRunningSessionForTerminalCommand(tx, input, "cancelled");

      await claimRunningSession(tx, session.id, {
        status: SessionStatus.cancelled,
        finishedAt,
        notes: input.notes?.trim() || null,
        cancelCommandId: input.commandId,
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
        await claimTaskStatus(
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
        updatedTask = await tx.cleaningTask.findUniqueOrThrow({
          // Restrict the query to the relevant rows only.
          where: { id: task.id },
          // Eager-load relations needed by the API response shape.
          include: taskInclude,
        });

        // Load locationUpdated needed for the next decision or write.
        const locationUpdated = await applyLocationCleaningStatusIfCurrent(
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
          await healOrphanIfTaskCycleCurrent(
            tx,
            // Execute: task.locationId,
            task.locationId,
            // Execute: task.cleaningCycle,
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
          // Open nested structure for the next related fields.
          after: {
            taskStatus: updatedTask.status,
            notes: input.notes?.trim() || null,
          },
          summary: `Cancelled cleaning session for ${updatedTask.location.number}`,
        },
        tx,
      );

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
    return result;
  } catch (err) {
    // Load again needed for the next decision or write.
    const again = await replayCleaningCommandOnP2002(
      err,
      // Execute: () =>
      () =>
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
