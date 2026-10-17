/**
 * Cleaning session lifecycle: start (idempotent on commandId), complete, cancel.
 * Enforces one running session per task and per employee via DB unique indexes.
 */
// Location/task/session enums for lifecycle transitions.
import { CleaningStatus, SessionStatus, TaskStatus } from "@prisma/client";
// Module dependency import.
import { prisma } from "../../db";
// Module dependency import.
import { AppError } from "../../errors";
// Module dependency import.
import { publish } from "../../events/bus";
// Inspection requirement flag + overdue minutes for complete path.
import { getFlags, getOperations } from "../settings";
// Module dependency import.
import { recordAudit } from "../audit";
// Module dependency import.
import {
  // Side effect: events / audit / notifications.
  createNotifications,
  recipientsForLocationOps,
} from "../notifications";
// Module dependency import.
import { taskInclude } from "../cleaningTasksQuery";
// Module dependency import.
import {
  assertTaskVersion,
  claimRunningSession,
  claimTaskStatus,
  taskConflictDetails,
} from "./claims";
// Module dependency import.
import { ensureTaskCycleForStart } from "./cycles";
// Module dependency import.
import { applyLocationCleaningStatusIfCurrent } from "./locationStatus";
// Module dependency import.
import { lockSession, lockTask } from "./locks";
// Module dependency import.
import { assertCleaningCommandPayloadMatch } from "./idempotency";
// Module dependency import.
import { isP2002, mapStartUniqueConflict } from "./prismaConflicts";

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
  // Idempotency: same startCommandId returns the existing session.
  const existingByCommand = await prisma.cleaningSession.findUnique({
    where: { startCommandId: input.commandId },
    include: { task: { include: taskInclude } },
  });
  // Replay: prior successful start with this commandId — return as-is.
  if (existingByCommand) {
    // Same commandId with a different task or employee is not a replay.
    assertCleaningCommandPayloadMatch(
      existingByCommand.taskId === input.taskId &&
        existingByCommand.employeeId === input.employeeId,
    );
    // Return result to caller.
    return { session: existingByCommand, task: existingByCommand.task, idempotent: true };
  }

  try {
    // Serialize start against concurrent session/task mutations on this task.
    const result = await prisma.$transaction(async (tx) => {
      // Row lock so parallel starts cannot both pass the running-session checks.
      await lockTask(tx, input.taskId);

      // Load the task after the lock for a consistent snapshot.
      const task = await tx.cleaningTask.findUnique({
        where: { id: input.taskId },
      });
      // Missing task id — client stale or deleted.
      if (!task) {
        // Fail closed with structured AppError.
        throw new AppError(404, "not_found", "Task not found");
      }
      // Only assigned / rework / in_progress may start a session.
      if (
        task.status !== TaskStatus.assigned &&
        task.status !== TaskStatus.rework &&
        task.status !== TaskStatus.in_progress
      ) {
        // Fail closed with structured AppError.
        throw new AppError(
          409,
          "invalid_state",
          `Cannot start task in status ${task.status}`,
          taskConflictDetails(task, input.expectedVersion),
        );
      }
      // Offline clients: reject when expectedVersion is stale.
      assertTaskVersion(task, input.expectedVersion);
      // Non-owners cannot start someone else's assignment.
      if (
        !input.bypassAssigneeCheck &&
        task.assignedEmployeeId &&
        task.assignedEmployeeId !== input.employeeId
      ) {
        // Fail closed with structured AppError.
        throw new AppError(
          409,
          "assignee_conflict",
          "Task was reassigned to another employee",
          taskConflictDetails(task, input.expectedVersion),
        );
      }

      // Bind unbound/future-planned tasks; reject hotelDate still in the future.
      const cleaningCycle = await ensureTaskCycleForStart(tx, task);

      // Reject if another running session already owns this task.
      const runningOnTask = await tx.cleaningSession.findFirst({
        where: { taskId: task.id, status: SessionStatus.running },
      });
      // Guard / branch on preconditions.
      if (runningOnTask) {
        // Fail closed with structured AppError.
        throw new AppError(409, "conflict", "Task already has a running session");
      }

      // DB always enforces one running session per employee (partial unique index).
      const runningByEmployee = await tx.cleaningSession.findFirst({
        where: { employeeId: input.employeeId, status: SessionStatus.running },
      });
      // Guard / branch on preconditions.
      if (runningByEmployee) {
        // Fail closed with structured AppError.
        throw new AppError(409, "conflict", "Employee already has a running session");
      }

      // Insert the running session keyed by startCommandId for idempotency.
      const session = await tx.cleaningSession.create({
        data: {
          taskId: task.id,
          employeeId: input.employeeId,
          startedAt: new Date(),
          status: SessionStatus.running,
          // Unique idempotency key for offline start retries.
          startCommandId: input.commandId,
        },
      });

      // Claim task → in_progress and pin assignee to the starter.
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

      // Reload with includes for the API / event payload.
      const updatedTask = await tx.cleaningTask.findUniqueOrThrow({
        where: { id: task.id },
        include: taskInclude,
      });

      // Mirror in_progress onto the location only if this cycle is still current.
      await applyLocationCleaningStatusIfCurrent(
        tx,
        task.locationId,
        cleaningCycle,
        CleaningStatus.in_progress,
        { requireCurrent: true },
      );

      // Audit the start transition with before/after status.
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

      // Return result to caller.
      return { session, task: updatedTask, idempotent: false };
    });
    // Fresh start (not idempotent replay) — notify live listeners.
    if (!result.idempotent) {
      publish("cleaning.changed", {
        locationId: result.task.locationId,
        taskId: result.task.id,
      });
    }
    // Return result to caller.
    return result;
  } catch (err) {
    // Unique race on startCommandId / running indexes — treat as idempotent or map.
    if (isP2002(err)) {
      // Another txn won the insert; re-read by commandId.
      const again = await prisma.cleaningSession.findUnique({
        where: { startCommandId: input.commandId },
        include: { task: { include: taskInclude } },
      });
      // Guard / branch on preconditions.
      if (again) {
        // Concurrent winner must match this task/employee or it is a collision.
        assertCleaningCommandPayloadMatch(
          again.taskId === input.taskId && again.employeeId === input.employeeId,
        );
        // Return result to caller.
        return { session: again, task: again.task, idempotent: true };
      }
      // Non-idempotent unique conflict (e.g. employee already running).
      mapStartUniqueConflict(err);
    }
    // Step in workflow.
    throw err;
  }
}

/**
 * Complete a running session (idempotent on `commandId`). Moves the task to
 * awaiting_inspection or completed depending on inspection flags / auto-accept.
 */
export async function completeCleaningSession(input: {
  sessionId: string;
  employeeId: string;
  commandId: string;
  notes?: string;
  expectedVersion?: number;
  /** Owner may complete a session started by someone else. */
  bypassSessionOwnerCheck?: boolean;
}) {
  // Idempotency: same completeCommandId returns the existing completion.
  const existingByCommand = await prisma.cleaningSession.findUnique({
    where: { completeCommandId: input.commandId },
    include: { task: { include: taskInclude } },
  });
  // Replay: prior successful complete with this commandId.
  if (existingByCommand) {
    // Same session + same completing actor (owner bypass is a distinct actor).
    // Legacy rows without completeActorEmployeeId fall back to session starter.
    const priorActor =
      existingByCommand.completeActorEmployeeId ?? existingByCommand.employeeId;
    assertCleaningCommandPayloadMatch(
      existingByCommand.id === input.sessionId &&
        priorActor === input.employeeId,
    );
    // Return result to caller.
    return { session: existingByCommand, task: existingByCommand.task, idempotent: true };
  }

  try {
    // Serialize complete against concurrent session/task mutations.
    const result = await prisma.$transaction(async (tx) => {
      // Peek session to discover taskId before locking.
      const sessionPeek = await tx.cleaningSession.findUnique({
        where: { id: input.sessionId },
      });
      // Guard / branch on preconditions.
      if (!sessionPeek) {
        // Fail closed with structured AppError.
        throw new AppError(404, "not_found", "Session not found");
      }

      // Lock order: task → session → location writes
      await lockTask(tx, sessionPeek.taskId);
      // Await async persistence or side effect.
      await lockSession(tx, sessionPeek.id);

      // Re-read after locks for a consistent status/owner snapshot.
      const session = await tx.cleaningSession.findUniqueOrThrow({
        where: { id: input.sessionId },
      });
      // Non-owners cannot complete another employee's session.
      if (
        !input.bypassSessionOwnerCheck &&
        session.employeeId !== input.employeeId
      ) {
        // Attach task conflict details when the parent task still exists.
        const taskPeek = await tx.cleaningTask.findUnique({
          where: { id: session.taskId },
        });
        // Fail closed with structured AppError.
        throw new AppError(
          409,
          "assignee_conflict",
          "Session belongs to another employee",
          taskPeek
            ? taskConflictDetails(taskPeek, input.expectedVersion)
            : undefined,
        );
      }
      // Already completed — not an idempotent commandId match path.
      if (session.status === SessionStatus.completed) {
        // Fail closed with structured AppError.
        throw new AppError(409, "invalid_state", "Session already completed");
      }
      // Cancelled / other terminal states cannot be completed.
      if (session.status !== SessionStatus.running) {
        // Fail closed with structured AppError.
        throw new AppError(
          409,
          "invalid_state",
          `Cannot complete session in status ${session.status}`,
        );
      }

      // Load parent task for version check and cycle soft-guard.
      const task = await tx.cleaningTask.findUniqueOrThrow({
        where: { id: session.taskId },
      });
      assertTaskVersion(task, input.expectedVersion);

      // Wall-clock finish; reject inverted clocks.
      const finishedAt = new Date();
      // Guard / branch on preconditions.
      if (finishedAt < session.startedAt) {
        // Fail closed with structured AppError.
        throw new AppError(400, "invalid_time", "Finish time before start time");
      }

      // Overdue threshold from operations settings.
      const operations = await getOperations();
      // Local binding for this step.
      const durationMinutes =
        (finishedAt.getTime() - session.startedAt.getTime()) / 60000;
      // Normalize anomalyFlags JSON to a string array.
      const existingFlags = Array.isArray(session.anomalyFlags)
        ? (session.anomalyFlags as string[]).filter(
            (f): f is string => typeof f === "string",
          )
        : [];
      // Tag overdue once when duration exceeds the configured minutes.
      const anomalyFlags =
        durationMinutes >= operations.overdueSessionMinutes &&
        !existingFlags.includes("overdue")
          ? [...existingFlags, "overdue"]
          : existingFlags;

      // Conditional claim: only a running session can complete.
      await claimRunningSession(tx, session.id, {
        status: SessionStatus.completed,
        finishedAt,
        notes: input.notes?.trim() || null,
        completeCommandId: input.commandId,
        completeActorEmployeeId: input.employeeId,
        anomalyFlags,
      });

      // Reload completed session row for the response.
      const updatedSession = await tx.cleaningSession.findUniqueOrThrow({
        where: { id: session.id },
      });

      // Inspection flag decides awaiting_inspection vs completed / verified_clean.
      // Feature flag: inspection gate vs auto-accept on complete.
      const flags = await getFlags();
      const nextTaskStatus = flags.require_inspection
        ? TaskStatus.awaiting_inspection
        : TaskStatus.completed;
      // Mirror task terminal status onto location cleaningStatus when current.
      const nextCleaningStatus = flags.require_inspection
        ? CleaningStatus.pending_inspection
        : CleaningStatus.verified_clean;

      // Claim task from in_progress; set completedAt only when auto-accepted.
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

      // Reload task with includes for notifications / publish.
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

      // Audit completion with resulting task status and notes.
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

      // Return result to caller.
      return { session: updatedSession, task: updatedTask, idempotent: false };
    });
    // Fresh complete — publish and optionally notify inspectors.
    if (!result.idempotent) {
      publish("cleaning.changed", {
        locationId: result.task.locationId,
        taskId: result.task.id,
      });
      // Only when inspection is required and task landed in awaiting_inspection.
      if (result.task.status === TaskStatus.awaiting_inspection) {
        // Ops staff with cleaning.inspect for this location's scope.
        const recipients = await recipientsForLocationOps(
          result.task.locationId,
          "cleaning.inspect",
        );
        // Also notify the sector supervisor snapshotted on the task.
        if (result.task.sectorSupervisorEmployeeId) {
          recipients.push(result.task.sectorSupervisorEmployeeId);
        }
        // Await async persistence or side effect.
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
            // Deep-link inspectors to cleaning panel.
            panel: "cleaning",
            taskId: result.task.id,
            locationId: result.task.locationId,
            locationNumber: result.task.location.number,
          },
        });
      }
    }
    // Return result to caller.
    return result;
  } catch (err) {
    // Unique race on completeCommandId — treat as idempotent replay.
    if (isP2002(err)) {
      // Await async query or service call.
      const again = await prisma.cleaningSession.findUnique({
        where: { completeCommandId: input.commandId },
        include: { task: { include: taskInclude } },
      });
      // Guard / branch on preconditions.
      if (again) {
        // Concurrent winner must match session + completing actor.
        const priorActor =
          again.completeActorEmployeeId ?? again.employeeId;
        assertCleaningCommandPayloadMatch(
          again.id === input.sessionId && priorActor === input.employeeId,
        );
        // Return result to caller.
        return { session: again, task: again.task, idempotent: true };
      }
    }
    // Step in workflow.
    throw err;
  }
}

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
  // Idempotency: same cancelCommandId returns the existing cancellation.
  const existingByCommand = await prisma.cleaningSession.findUnique({
    where: { cancelCommandId: input.commandId },
    include: { task: { include: taskInclude } },
  });
  // Replay: prior successful cancel with this commandId.
  if (existingByCommand) {
    // Same session + same cancelling actor (reviewer bypass is a distinct actor).
    // Legacy rows without cancelActorEmployeeId fall back to session starter.
    const priorActor =
      existingByCommand.cancelActorEmployeeId ?? existingByCommand.employeeId;
    assertCleaningCommandPayloadMatch(
      existingByCommand.id === input.sessionId &&
        priorActor === input.employeeId,
    );
    // Return result to caller.
    return { session: existingByCommand, task: existingByCommand.task, idempotent: true };
  }

  try {
    // Serialize cancel against concurrent session/task mutations.
    const result = await prisma.$transaction(async (tx) => {
      // Peek session to discover taskId before locking.
      const sessionPeek = await tx.cleaningSession.findUnique({
        where: { id: input.sessionId },
      });
      // Guard / branch on preconditions.
      if (!sessionPeek) {
        // Fail closed with structured AppError.
        throw new AppError(404, "not_found", "Session not found");
      }

      // Lock order: task → session (same as complete).
      await lockTask(tx, sessionPeek.taskId);
      // Await async persistence or side effect.
      await lockSession(tx, sessionPeek.id);

      // Re-read after locks for a consistent status/owner snapshot.
      const session = await tx.cleaningSession.findUniqueOrThrow({
        where: { id: input.sessionId },
      });
      // Non-owners cannot cancel another employee's session unless bypassed.
      if (
        !input.bypassSessionOwnerCheck &&
        session.employeeId !== input.employeeId
      ) {
        // Await async query or service call.
        const taskPeek = await tx.cleaningTask.findUnique({
          where: { id: session.taskId },
        });
        // Fail closed with structured AppError.
        throw new AppError(
          409,
          "assignee_conflict",
          "Session belongs to another employee",
          taskPeek
            ? taskConflictDetails(taskPeek, input.expectedVersion)
            : undefined,
        );
      }
      // Already cancelled — not an idempotent commandId match path.
      if (session.status === SessionStatus.cancelled) {
        // Fail closed with structured AppError.
        throw new AppError(409, "invalid_state", "Session already cancelled");
      }
      // Completed / other states cannot be cancelled.
      if (session.status !== SessionStatus.running) {
        // Fail closed with structured AppError.
        throw new AppError(
          409,
          "invalid_state",
          `Cannot cancel session in status ${session.status}`,
        );
      }

      // Load parent task for version check and possible revert.
      const task = await tx.cleaningTask.findUniqueOrThrow({
        where: { id: session.taskId },
      });
      assertTaskVersion(task, input.expectedVersion);

      // Wall-clock finish; reject inverted clocks.
      const finishedAt = new Date();
      // Guard / branch on preconditions.
      if (finishedAt < session.startedAt) {
        // Fail closed with structured AppError.
        throw new AppError(400, "invalid_time", "Finish time before start time");
      }

      // Conditional claim: only a running session can cancel.
      await claimRunningSession(tx, session.id, {
        status: SessionStatus.cancelled,
        finishedAt,
        notes: input.notes?.trim() || null,
        cancelCommandId: input.commandId,
        cancelActorEmployeeId: input.employeeId,
      });

      // Reload cancelled session row for the response.
      const updatedSession = await tx.cleaningSession.findUniqueOrThrow({
        where: { id: session.id },
      });

      // Default task snapshot if we do not need to revert status.
      let updatedTask = await tx.cleaningTask.findUniqueOrThrow({
        where: { id: task.id },
        include: taskInclude,
      });

      // At most one running session per task (DB invariant) — cancel always reverts.
      if (task.status === TaskStatus.in_progress) {
        // Revert task to assigned so it can be started again.
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

      // Audit cancellation with resulting task status and notes.
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

      // Return result to caller.
      return { session: updatedSession, task: updatedTask, idempotent: false };
    });
    // Fresh cancel — notify live listeners.
    if (!result.idempotent) {
      publish("cleaning.changed", {
        locationId: result.task.locationId,
        taskId: result.task.id,
      });
    }
    // Return result to caller.
    return result;
  } catch (err) {
    // Unique race on cancelCommandId — treat as idempotent replay.
    if (isP2002(err)) {
      // Await async query or service call.
      const again = await prisma.cleaningSession.findUnique({
        where: { cancelCommandId: input.commandId },
        include: { task: { include: taskInclude } },
      });
      // Guard / branch on preconditions.
      if (again) {
        // Concurrent winner must match session + cancelling actor.
        const priorActor =
          again.cancelActorEmployeeId ?? again.employeeId;
        assertCleaningCommandPayloadMatch(
          again.id === input.sessionId && priorActor === input.employeeId,
        );
        // Return result to caller.
        return { session: again, task: again.task, idempotent: true };
      }
    }
    // Step in workflow.
    throw err;
  }
}
