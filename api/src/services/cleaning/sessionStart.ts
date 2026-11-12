/**
 * Start a cleaning session for a task (idempotent on commandId).
 */
import { CleaningStatus, SessionStatus, TaskStatus } from "@prisma/client";
// Import ../../db for cleaning/sessionStart.ts.
import { prisma } from "../../db";
// Import ../assignees for cleaning/sessionStart.ts.
import { assertActiveWorkStarter } from "../assignees";
// Import ../../errors for cleaning/sessionStart.ts.
import { AppError } from "../../errors";
// Import ../../events/bus for cleaning/sessionStart.ts.
import { publish } from "../../events/bus";
// Import ../audit for cleaning/sessionStart.ts.
import { recordAudit } from "../audit";
// Import ../cleaningTasksQuery for cleaning/sessionStart.ts.
import { taskInclude } from "../cleaningTasksQuery";
// Side-effect or default import required by this module.
import {
  // Carry this field through the payload or query.
  assertTaskVersion,
  // Carry this field through the payload or query.
  claimTaskStatus,
  // Carry this field through the payload or query.
  taskConflictDetails,
// Execute: } from "./claims";
} from "./claims";
// Import ./cycles for cleaning/sessionStart.ts.
import { ensureTaskCycleForStart } from "./cycles";
// Import ./locationStatus for cleaning/sessionStart.ts.
import { applyLocationCleaningStatusIfCurrent } from "./locationStatus";
// Import ./locks for cleaning/sessionStart.ts.
import { lockTask } from "./locks";
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
// Import ./prismaConflicts for cleaning/sessionStart.ts.
import { isP2002, mapStartUniqueConflict } from "./prismaConflicts";
// Side-effect or default import required by this module.
import {
  // Carry this field through the payload or query.
  sessionWithTaskInclude,
  // Carry this field through the payload or query.
  startSessionPayloadMatches,
// Execute: } from "./sessionShared";
} from "./sessionShared";

/**
 * Start a cleaning session for a task. Idempotent on `commandId`.
 * Binds the task to the current cleaning cycle when unbound or stale.
 */
export async function startCleaningTask(input: {
  // Carry this field through the payload or query.
  taskId: string;
  // Carry this field through the payload or query.
  employeeId: string;
  /** Idempotency key for offline start retries (unique startCommandId). */
  commandId: string;
  // Parameter/field in the surrounding signature or type.
  expectedVersion?: number;
  /** Owner may start a task assigned to someone else. */
  bypassAssigneeCheck?: boolean;
// Begin block/object for the following statements.
}) {
  // Load existingByCommand needed for the next decision or write.
  const existingByCommand = await loadCleaningCommandPreTx(
    // Execute: () =>
    () =>
      // Begin block/object for the following statements.
      prisma.cleaningSession.findUnique({
        // Restrict the query to the relevant rows only.
        where: { startCommandId: input.commandId },
        // Eager-load relations needed by the API response shape.
        include: sessionWithTaskInclude,
      }),
    // Execute: (row) => startSessionPayloadMatches(row, input),
    (row) => startSessionPayloadMatches(row, input),
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
      // Lock the starter before the task. Reassignment locks affected users
      // before the task too, so the shared User -> CleaningTask order prevents
      // a start/reassign lock cycle.
      await assertActiveWorkStarter(input.employeeId, tx);
      // Await side effect or helper before continuing.
      await lockTask(tx, input.taskId);

      // Load replay needed for the next decision or write.
      const replay = await loadCleaningCommandInTx(
        // Carry this field through the payload or query.
        tx,
        // Execute: (t) =>
        (t) =>
          // Begin block/object for the following statements.
          t.cleaningSession.findUnique({
            // Restrict the query to the relevant rows only.
            where: { startCommandId: input.commandId },
            // Eager-load relations needed by the API response shape.
            include: sessionWithTaskInclude,
          }),
        // Execute: (row) => startSessionPayloadMatches(row, input),
        (row) => startSessionPayloadMatches(row, input),
      );
      // Branch when this condition holds for the domain rule.
      if (replay) {
        // Early return of a terminal empty/boolean result.
        return { session: replay, task: replay.task, idempotent: true };
      }

      // Load task needed for the next decision or write.
      const task = await tx.cleaningTask.findUnique({
        // Restrict the query to the relevant rows only.
        where: { id: input.taskId },
      });
      // Guard: handle missing/invalid state before continuing.
      if (!task) {
        // Abort with an HTTP-mapped AppError or rethrow.
        throw new AppError(404, "not_found", "Task not found");
      }
      // Branch when this condition holds for the domain rule.
      if (
        // Execute: task.status !== TaskStatus.assigned &&
        task.status !== TaskStatus.assigned &&
        // Execute: task.status !== TaskStatus.rework &&
        task.status !== TaskStatus.rework &&
        // Execute: task.status !== TaskStatus.in_progress
        task.status !== TaskStatus.in_progress
      // Begin block/object for the following statements.
      ) {
        // Abort with an HTTP-mapped AppError or rethrow.
        throw new AppError(
          // Execute: 409,
          409,
          // Execute: "invalid_state",
          "invalid_state",
          // Execute: `Cannot start task in status ${task.status}`,
          `Cannot start task in status ${task.status}`,
          // Execute: taskConflictDetails(task, input.expectedVersion),
          taskConflictDetails(task, input.expectedVersion),
        );
      }
      // Execute: assertTaskVersion(task, input.expectedVersion);
      assertTaskVersion(task, input.expectedVersion);
      // Branch when this condition holds for the domain rule.
      if (
        // Execute: !input.bypassAssigneeCheck &&
        !input.bypassAssigneeCheck &&
        // Execute: task.assignedEmployeeId &&
        task.assignedEmployeeId &&
        // Execute: task.assignedEmployeeId !== input.employeeId
        task.assignedEmployeeId !== input.employeeId
      // Begin block/object for the following statements.
      ) {
        // Abort with an HTTP-mapped AppError or rethrow.
        throw new AppError(
          // Execute: 409,
          409,
          // Execute: "assignee_conflict",
          "assignee_conflict",
          // Execute: "Task was reassigned to another employee",
          "Task was reassigned to another employee",
          // Execute: taskConflictDetails(task, input.expectedVersion),
          taskConflictDetails(task, input.expectedVersion),
        );
      }

      // Load cleaningCycle needed for the next decision or write.
      const cleaningCycle = await ensureTaskCycleForStart(tx, task);

      // Load runningOnTask needed for the next decision or write.
      const runningOnTask = await tx.cleaningSession.findFirst({
        // Restrict the query to the relevant rows only.
        where: { taskId: task.id, status: SessionStatus.running },
      });
      // Branch when this condition holds for the domain rule.
      if (runningOnTask) {
        // Abort with an HTTP-mapped AppError or rethrow.
        throw new AppError(409, "conflict", "Task already has a running session");
      }

      // Load runningByEmployee needed for the next decision or write.
      const runningByEmployee = await tx.cleaningSession.findFirst({
        // Restrict the query to the relevant rows only.
        where: { employeeId: input.employeeId, status: SessionStatus.running },
      });
      // Branch when this condition holds for the domain rule.
      if (runningByEmployee) {
        // Abort with an HTTP-mapped AppError or rethrow.
        throw new AppError(
          // Execute: 409,
          409,
          // Execute: "conflict",
          "conflict",
          // Execute: "Employee already has a running session",
          "Employee already has a running session",
        );
      }

      // Load session needed for the next decision or write.
      const session = await tx.cleaningSession.create({
        // Fields written by this create/update.
        data: {
          // Carry this field through the payload or query.
          taskId: task.id,
          // Carry this field through the payload or query.
          employeeId: input.employeeId,
          // Carry this field through the payload or query.
          startedAt: new Date(),
          // Carry this field through the payload or query.
          status: SessionStatus.running,
          // Carry this field through the payload or query.
          startCommandId: input.commandId,
        },
      });

      // Await side effect or helper before continuing.
      await claimTaskStatus(
        // Carry this field through the payload or query.
        tx,
        // Execute: task.id,
        task.id,
        // Execute: [TaskStatus.assigned, TaskStatus.rework, TaskStatus.in_progress],
        [TaskStatus.assigned, TaskStatus.rework, TaskStatus.in_progress],
        // Begin block/object for the following statements.
        {
          // Carry this field through the payload or query.
          status: TaskStatus.in_progress,
          // Carry this field through the payload or query.
          assignedEmployeeId: input.employeeId,
        },
        // Execute: input.expectedVersion,
        input.expectedVersion,
      );

      // Load updatedTask needed for the next decision or write.
      const updatedTask = await tx.cleaningTask.findUniqueOrThrow({
        // Restrict the query to the relevant rows only.
        where: { id: task.id },
        // Eager-load relations needed by the API response shape.
        include: taskInclude,
      });

      // Await side effect or helper before continuing.
      await applyLocationCleaningStatusIfCurrent(
        // Carry this field through the payload or query.
        tx,
        // Execute: task.locationId,
        task.locationId,
        // Carry this field through the payload or query.
        cleaningCycle,
        // Execute: CleaningStatus.in_progress,
        CleaningStatus.in_progress,
        // Execute: { requireCurrent: true },
        { requireCurrent: true },
      );

      // Await side effect or helper before continuing.
      await recordAudit(
        // Begin block/object for the following statements.
        {
          // Carry this field through the payload or query.
          actorEmployeeId: input.employeeId,
          // Field value required by this payload or query.
          action: "cleaning.task.start",
          // Field value required by this payload or query.
          entityType: "cleaning_task",
          // Carry this field through the payload or query.
          entityId: task.id,
          // Carry this field through the payload or query.
          locationId: task.locationId,
          // Carry this field through the payload or query.
          before: { status: task.status },
          // Open nested structure for the next related fields.
          after: {
            // Carry this field through the payload or query.
            status: TaskStatus.in_progress,
            // Carry this field through the payload or query.
            sessionId: session.id,
          },
          // Field value required by this payload or query.
          summary: `Started cleaning ${updatedTask.location.number}`,
        },
        // Carry this field through the payload or query.
        tx,
      );

      // Early return of a terminal empty/boolean result.
      return { session, task: updatedTask, idempotent: false };
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
          where: { startCommandId: input.commandId },
          // Eager-load relations needed by the API response shape.
          include: sessionWithTaskInclude,
        }),
      // Execute: (row) => startSessionPayloadMatches(row, input),
      (row) => startSessionPayloadMatches(row, input),
    );
    // Branch when this condition holds for the domain rule.
    if (again) {
      // Early return of a terminal empty/boolean result.
      return { session: again, task: again.task, idempotent: true };
    }
    // Conflict/stale path: map domain race to a safe response.
    if (isP2002(err)) {
      // Execute: mapStartUniqueConflict(err);
      mapStartUniqueConflict(err);
    }
    // Abort with an HTTP-mapped AppError or rethrow.
    throw err;
  }
}
