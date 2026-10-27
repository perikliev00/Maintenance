/**
 * Inspection approve/reject for tasks in `awaiting_inspection`.
 * Approve → completed + verified_clean (if cycle current); reject → rework + dirty.
 * Idempotent on `commandId`.
 */
// Prisma enums + client for inspection rows and task transitions.
import { CleaningStatus, InspectionResult, TaskStatus } from "@prisma/client";
// Shared DB client (read idempotency outside txn when cheap).
import { prisma } from "../../db";
// HTTP-shaped domain errors for validation/state conflicts.
import { AppError } from "../../errors";
// Live room/task board refresh after a fresh inspect.
import { publish } from "../../events/bus";
// Immutable audit trail for approve/reject decisions.
import { recordAudit } from "../audit";
// Push inspect outcome to the assignee when present.
import { createNotifications } from "../notifications";
// Standard task graph for API responses.
import { taskInclude } from "../cleaningTasksQuery";
import {
  assertTaskVersion,
  claimTaskStatus,
} from "./claims";
import { assertTaskOwnsCleaningCycle } from "./cycles";
// Cycle-aware location status writes (never stomp newer cycles).
import { applyLocationCleaningStatusIfCurrent } from "./locationStatus";
// Row lock to serialize inspect vs reassign/start.
import { lockTask } from "./locks";
// Same commandId with different task/inspector/decision → conflict (P1-26).
import { assertCleaningCommandPayloadMatch } from "./idempotency";
// Map unique commandId races to idempotent replay.
import { isP2002 } from "./prismaConflicts";

/**
 * Record an inspection. Rejection requires findings. Location status updates
 * only apply when the task still owns the location's cleaning cycle.
 */
export async function inspectCleaningTask(input: {
  taskId: string;
  inspectorEmployeeId: string;
  commandId: string;
  result: "approved" | "rejected";
  findings?: string;
  expectedVersion?: number;
}) {
  // Map API union to persisted enum for replay payload checks.
  const expectedResult =
    input.result === "approved"
      ? InspectionResult.approved
      : InspectionResult.rejected;

  // Idempotency: same commandId returns the existing inspection.
  const existing = await prisma.inspection.findUnique({
    // Idempotency key from offline/sync clients.
    where: { commandId: input.commandId },
    // Return full task graph on replay.
    include: { task: { include: taskInclude } },
  });
  // Replay: prior successful inspect with this commandId.
  if (existing) {
    // Same commandId with different task, inspector, or decision is not a replay.
    assertCleaningCommandPayloadMatch(
      existing.taskId === input.taskId &&
        existing.inspectorEmployeeId === input.inspectorEmployeeId &&
        existing.result === expectedResult,
    );
    return { inspection: existing, task: existing.task, idempotent: true };
  }

  // Rejection without findings is not allowed (audit/accountability).
  if (input.result === "rejected" && !input.findings?.trim()) {
    throw new AppError(400, "validation", "Findings/reason required when rejecting");
  }

  try {
    // Serialize inspect against concurrent task status transitions.
    const result = await prisma.$transaction(async (tx) => {
      // Exclusive task row for inspect vs concurrent lifecycle ops.
      await lockTask(tx, input.taskId);

      const replay = await tx.inspection.findUnique({
        where: { commandId: input.commandId },
        include: { task: { include: taskInclude } },
      });
      if (replay) {
        assertCleaningCommandPayloadMatch(
          replay.taskId === input.taskId &&
          replay.inspectorEmployeeId === input.inspectorEmployeeId &&
          replay.result === expectedResult,
        );
        return { inspection: replay, task: replay.task, idempotent: true };
      }

      // Load task after lock for status/version checks.
      const task = await tx.cleaningTask.findUnique({
        where: { id: input.taskId },
      });
      // Stale task id from client or deleted row.
      if (!task) {
        throw new AppError(404, "not_found", "Task not found");
      }
      // Only awaiting_inspection may be inspected.
      if (task.status !== TaskStatus.awaiting_inspection) {
        throw new AppError(
          409,
          "invalid_state",
          `Cannot inspect task in status ${task.status}`,
        );
      }
      // Offline clients: reject when expectedVersion is stale.
      assertTaskVersion(task, input.expectedVersion);

      // Reject of a non-current cycle would leave task=rework while location
      // stays pending_inspection. Fail closed instead of creating that split.
      if (input.result === "rejected") {
        await assertTaskOwnsCleaningCycle(
          tx,
          task.locationId,
          task.cleaningCycle,
        );
      }

      // Persist the inspection row keyed by commandId for idempotency.
      const inspection = await tx.inspection.create({
        data: {
          // Parent task under inspection.
          taskId: task.id,
          // Reviewer identity for audit/notifications.
          inspectorEmployeeId: input.inspectorEmployeeId,
          // Wall-clock inspect moment (also used as completedAt on approve).
          inspectedAt: new Date(),
          // Map API union to persisted enum.
          result:
            input.result === "approved"
              ? InspectionResult.approved
              : InspectionResult.rejected,
          // Optional findings text (required on reject at API layer).
          findings: input.findings?.trim() || null,
          // Idempotency key — unique index prevents double inspect.
          commandId: input.commandId,
        },
      });

      // Approve path: complete task + verified_clean when cycle is current.
      if (input.result === "approved") {
        const completedAt = inspection.inspectedAt;
        // Claim awaiting_inspection → completed with completedAt stamp.
        await claimTaskStatus(
          tx,
          task.id,
          // Only awaiting_inspection may transition on approve.
          [TaskStatus.awaiting_inspection],
          { status: TaskStatus.completed, completedAt },
          input.expectedVersion,
        );
        // Reload with includes for the API / notification payload.
        const updatedTask = await tx.cleaningTask.findUniqueOrThrow({
          where: { id: task.id },
          include: taskInclude,
        });
        // Soft cycle guard: never overwrite a newer location cycle.
        const locationUpdated = await applyLocationCleaningStatusIfCurrent(
          tx,
          task.locationId,
          task.cleaningCycle,
          CleaningStatus.verified_clean,
        );
        // Audit note when location was left unchanged due to stale cycle.
        await recordAudit({
          actorEmployeeId: input.inspectorEmployeeId,
          action: "cleaning.inspect",
          entityType: "inspection",
          entityId: inspection.id,
          locationId: task.locationId,
          reason: input.findings,
          after: {
            result: "approved",
            taskId: task.id,
            completedAt: completedAt.toISOString(),
            locationUpdated,
            cleaningCycle: task.cleaningCycle,
          },
          // Human summary reflects whether location cycle was still current.
          summary: locationUpdated
            ? `Approved cleaning ${updatedTask.location.number}`
            : `Approved cleaning ${updatedTask.location.number} (stale cycle; location unchanged)`,
        }, tx);
        // Non-idempotent success payload for post-txn publish/notify.
        return { inspection, task: updatedTask, idempotent: false };
      }

      // Reject path: rework + dirty when cycle is current.
      await claimTaskStatus(
        tx,
        task.id,
        // Reject always returns task to rework queue.
        [TaskStatus.awaiting_inspection],
        { status: TaskStatus.rework },
        input.expectedVersion,
      );
      // Reload with includes for the API / notification payload.
      const updatedTask = await tx.cleaningTask.findUniqueOrThrow({
        where: { id: task.id },
        include: taskInclude,
      });
      // Soft cycle guard: never overwrite a newer location cycle.
      const locationUpdated = await applyLocationCleaningStatusIfCurrent(
        tx,
        task.locationId,
        task.cleaningCycle,
        CleaningStatus.dirty,
      );
      // Audit includes findings in the summary when present.
      await recordAudit({
        actorEmployeeId: input.inspectorEmployeeId,
        action: "cleaning.inspect",
        entityType: "inspection",
        entityId: inspection.id,
        locationId: task.locationId,
        reason: input.findings,
        after: {
          result: "rejected",
          taskId: task.id,
          locationUpdated,
          cleaningCycle: task.cleaningCycle,
        },
        summary: locationUpdated
          ? `Rejected cleaning ${updatedTask.location.number}${
              input.findings?.trim() ? ` — ${input.findings.trim()}` : ""
            }`
          : `Rejected cleaning ${updatedTask.location.number} (stale cycle; location unchanged)${
              input.findings?.trim() ? ` — ${input.findings.trim()}` : ""
            }`,
      }, tx);
      // Reject path success — same response shape as approve.
      return { inspection, task: updatedTask, idempotent: false };
    });
    // Fresh inspect — publish and notify the assignee.
    if (!result.idempotent) {
      // Room board refresh after status/location change.
      publish("cleaning.changed", {
        locationId: result.task.locationId,
        taskId: result.task.id,
      });
      // Only the current assignee (if any) gets the inspect outcome.
      const recipients: string[] = [];
      if (result.task.assignedEmployeeId) {
        recipients.push(result.task.assignedEmployeeId);
      }
      await createNotifications({
        type: "cleaning.inspected",
        // Title reflects approve vs reject for inbox skimming.
        title:
          input.result === "approved"
            ? "Cleaning approved"
            : "Cleaning rejected — rework",
        body: `Room ${result.task.location.number}: ${input.result}`,
        entityType: "cleaning_task",
        entityId: result.task.id,
        locationId: result.task.locationId,
        actorEmployeeId: input.inspectorEmployeeId,
        recipientEmployeeIds: recipients,
        dedupeKey: `cleaning.inspected:${result.inspection.id}`,
        payload: {
          panel: "mywork",
          taskId: result.task.id,
          locationId: result.task.locationId,
          locationNumber: result.task.location.number,
        },
      });
    }
    // Return txn result (idempotent or fresh).
    return result;
  } catch (err) {
    // Unique race on commandId — treat as idempotent replay.
    if (isP2002(err)) {
      // Winner inserted inspection — load and return as replay.
      const again = await prisma.inspection.findUnique({
        where: { commandId: input.commandId },
        include: { task: { include: taskInclude } },
      });
      if (again) {
        // Concurrent winner must match task/inspector/decision or it is a collision.
        assertCleaningCommandPayloadMatch(
          again.taskId === input.taskId &&
            again.inspectorEmployeeId === input.inspectorEmployeeId &&
            again.result === expectedResult,
        );
        return { inspection: again, task: again.task, idempotent: true };
      }
    }
    // Non-idempotent errors propagate to HTTP layer.
    throw err;
  }
}
