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
// Side-effect or default import required by this module.
import {
  // Carry this field through the payload or query.
  assertTaskVersion,
  // Carry this field through the payload or query.
  claimTaskStatus,
// Execute: } from "./claims";
} from "./claims";
// Import ./cycles for cleaning/inspection.ts.
import { assertTaskOwnsCleaningCycle } from "./cycles";
// Cycle-aware location status writes (never stomp newer cycles).
import { applyLocationCleaningStatusIfCurrent } from "./locationStatus";
// Row lock to serialize inspect vs reassign/start.
import { lockTask } from "./locks";
// Import ../locations/reconcileCleaningStatus for cleaning/inspection.ts.
import { healOrphanIfTaskCycleCurrent } from "../locations/reconcileCleaningStatus";
// Same commandId with different task/inspector/decision → conflict (P1-26).
import {
  // Carry this field through the payload or query.
  loadCleaningCommandInTx,
  // Carry this field through the payload or query.
  loadCleaningCommandPreTx,
  // Field value required by this payload or query.
  replayCleaningCommandOnP2002,
// Execute: } from "./commandReplay";
} from "./commandReplay";

// Capture inspectionInclude for subsequent checks or writes.
const inspectionInclude = { task: { include: taskInclude } } as const;

/**
 * Record an inspection. Rejection requires findings. Location status updates
 * only apply when the task still owns the location's cleaning cycle.
 */
export async function inspectCleaningTask(input: {
  // Carry this field through the payload or query.
  taskId: string;
  // Carry this field through the payload or query.
  inspectorEmployeeId: string;
  // Carry this field through the payload or query.
  commandId: string;
  // Field value required by this payload or query.
  result: "approved" | "rejected";
  // Parameter/field in the surrounding signature or type.
  findings?: string;
  // Parameter/field in the surrounding signature or type.
  expectedVersion?: number;
// Begin block/object for the following statements.
}) {
  // Map API union to persisted enum for replay payload checks.
  const expectedResult =
    // Execute: input.result === "approved"
    input.result === "approved"
      // Continue the previous expression with this clause.
      ? InspectionResult.approved
      // Continue the previous expression with this clause.
      : InspectionResult.rejected;

  // Capture inspectionPayloadMatches for subsequent checks or writes.
  const inspectionPayloadMatches = (row: {
    // Carry this field through the payload or query.
    taskId: string;
    // Carry this field through the payload or query.
    inspectorEmployeeId: string;
    // Carry this field through the payload or query.
    result: InspectionResult;
  // Execute: }) =>
  }) =>
    // Execute: row.taskId === input.taskId &&
    row.taskId === input.taskId &&
    // Execute: row.inspectorEmployeeId === input.inspectorEmployeeId &&
    row.inspectorEmployeeId === input.inspectorEmployeeId &&
    // Execute: row.result === expectedResult;
    row.result === expectedResult;

  // Load existing needed for the next decision or write.
  const existing = await loadCleaningCommandPreTx(
    // Execute: () =>
    () =>
      // Begin block/object for the following statements.
      prisma.inspection.findUnique({
        // Restrict the query to the relevant rows only.
        where: { commandId: input.commandId },
        // Eager-load relations needed by the API response shape.
        include: inspectionInclude,
      }),
    // Carry this field through the payload or query.
    inspectionPayloadMatches,
  );
  // Branch when this condition holds for the domain rule.
  if (existing) {
    // Early return of a terminal empty/boolean result.
    return { inspection: existing, task: existing.task, idempotent: true };
  }

  // Rejection without findings is not allowed (audit/accountability).
  if (input.result === "rejected" && !input.findings?.trim()) {
    // Abort with an HTTP-mapped AppError or rethrow.
    throw new AppError(400, "validation", "Findings/reason required when rejecting");
  }

  // Isolate fallible work so conflicts can be mapped cleanly.
  try {
    // Serialize inspect against concurrent task status transitions.
    const result = await prisma.$transaction(async (tx) => {
      // Exclusive task row for inspect vs concurrent lifecycle ops.
      await lockTask(tx, input.taskId);

      // Load replay needed for the next decision or write.
      const replay = await loadCleaningCommandInTx(
        // Carry this field through the payload or query.
        tx,
        // Execute: (t) =>
        (t) =>
          // Begin block/object for the following statements.
          t.inspection.findUnique({
            // Restrict the query to the relevant rows only.
            where: { commandId: input.commandId },
            // Eager-load relations needed by the API response shape.
            include: inspectionInclude,
          }),
        // Carry this field through the payload or query.
        inspectionPayloadMatches,
      );
      // Branch when this condition holds for the domain rule.
      if (replay) {
        // Early return of a terminal empty/boolean result.
        return { inspection: replay, task: replay.task, idempotent: true };
      }

      // Load task after lock for status/version checks.
      const task = await tx.cleaningTask.findUnique({
        // Restrict the query to the relevant rows only.
        where: { id: input.taskId },
      });
      // Stale task id from client or deleted row.
      if (!task) {
        // Abort with an HTTP-mapped AppError or rethrow.
        throw new AppError(404, "not_found", "Task not found");
      }
      // Only awaiting_inspection may be inspected.
      if (task.status !== TaskStatus.awaiting_inspection) {
        // Abort with an HTTP-mapped AppError or rethrow.
        throw new AppError(
          // Execute: 409,
          409,
          // Execute: "invalid_state",
          "invalid_state",
          // Execute: `Cannot inspect task in status ${task.status}`,
          `Cannot inspect task in status ${task.status}`,
        );
      }
      // Offline clients: reject when expectedVersion is stale.
      assertTaskVersion(task, input.expectedVersion);

      // Reject of a non-current cycle would leave task=rework while location
      // stays pending_inspection. Fail closed instead of creating that split.
      if (input.result === "rejected") {
        // Await side effect or helper before continuing.
        await assertTaskOwnsCleaningCycle(
          // Carry this field through the payload or query.
          tx,
          // Execute: task.locationId,
          task.locationId,
          // Execute: task.cleaningCycle,
          task.cleaningCycle,
        );
      }

      // Persist the inspection row keyed by commandId for idempotency.
      const inspection = await tx.inspection.create({
        // Fields written by this create/update.
        data: {
          // Parent task under inspection.
          taskId: task.id,
          // Reviewer identity for audit/notifications.
          inspectorEmployeeId: input.inspectorEmployeeId,
          // Wall-clock inspect moment (also used as completedAt on approve).
          inspectedAt: new Date(),
          // Map API union to persisted enum.
          result:
            // Execute: input.result === "approved"
            input.result === "approved"
              // Continue the previous expression with this clause.
              ? InspectionResult.approved
              // Continue the previous expression with this clause.
              : InspectionResult.rejected,
          // Optional findings text (required on reject at API layer).
          findings: input.findings?.trim() || null,
          // Idempotency key — unique index prevents double inspect.
          commandId: input.commandId,
        },
      });

      // Approve path: complete task + verified_clean when cycle is current.
      if (input.result === "approved") {
        // Capture completedAt for subsequent checks or writes.
        const completedAt = inspection.inspectedAt;
        // Claim awaiting_inspection → completed with completedAt stamp.
        await claimTaskStatus(
          // Carry this field through the payload or query.
          tx,
          // Execute: task.id,
          task.id,
          // Only awaiting_inspection may transition on approve.
          [TaskStatus.awaiting_inspection],
          // Execute: { status: TaskStatus.completed, completedAt },
          { status: TaskStatus.completed, completedAt },
          // Execute: input.expectedVersion,
          input.expectedVersion,
        );
        // Reload with includes for the API / notification payload.
        const updatedTask = await tx.cleaningTask.findUniqueOrThrow({
          // Restrict the query to the relevant rows only.
          where: { id: task.id },
          // Eager-load relations needed by the API response shape.
          include: taskInclude,
        });
        // Soft cycle guard: never overwrite a newer location cycle.
        let locationUpdated = await applyLocationCleaningStatusIfCurrent(
          // Carry this field through the payload or query.
          tx,
          // Execute: task.locationId,
          task.locationId,
          // Execute: task.cleaningCycle,
          task.cleaningCycle,
          // Execute: CleaningStatus.verified_clean,
          CleaningStatus.verified_clean,
        );
        // Guard: handle missing/invalid state before continuing.
        if (!locationUpdated) {
          // Load healed needed for the next decision or write.
          const healed = await healOrphanIfTaskCycleCurrent(
            // Carry this field through the payload or query.
            tx,
            // Execute: task.locationId,
            task.locationId,
            // Execute: task.cleaningCycle,
            task.cleaningCycle,
          );
          // Execute: locationUpdated = healed != null;
          locationUpdated = healed != null;
        }
        // Audit note when location was left unchanged due to stale cycle.
        await recordAudit({
          // Carry this field through the payload or query.
          actorEmployeeId: input.inspectorEmployeeId,
          // Field value required by this payload or query.
          action: "cleaning.inspect",
          // Field value required by this payload or query.
          entityType: "inspection",
          // Carry this field through the payload or query.
          entityId: inspection.id,
          // Carry this field through the payload or query.
          locationId: task.locationId,
          // Carry this field through the payload or query.
          reason: input.findings,
          // Open nested structure for the next related fields.
          after: {
            // Field value required by this payload or query.
            result: "approved",
            // Carry this field through the payload or query.
            taskId: task.id,
            // Carry this field through the payload or query.
            completedAt: completedAt.toISOString(),
            // Carry this field through the payload or query.
            locationUpdated,
            // Carry this field through the payload or query.
            cleaningCycle: task.cleaningCycle,
          },
          // Human summary reflects whether location cycle was still current.
          summary: locationUpdated
            // Continue the previous expression with this clause.
            ? `Approved cleaning ${updatedTask.location.number}`
            // Continue the previous expression with this clause.
            : `Approved cleaning ${updatedTask.location.number} (stale cycle; location unchanged)`,
        // Execute: }, tx);
        }, tx);
        // Non-idempotent success payload for post-txn publish/notify.
        return { inspection, task: updatedTask, idempotent: false };
      }

      // Reject path: rework + dirty when cycle is current.
      await claimTaskStatus(
        // Carry this field through the payload or query.
        tx,
        // Execute: task.id,
        task.id,
        // Reject always returns task to rework queue.
        [TaskStatus.awaiting_inspection],
        // Execute: { status: TaskStatus.rework },
        { status: TaskStatus.rework },
        // Execute: input.expectedVersion,
        input.expectedVersion,
      );
      // Reload with includes for the API / notification payload.
      const updatedTask = await tx.cleaningTask.findUniqueOrThrow({
        // Restrict the query to the relevant rows only.
        where: { id: task.id },
        // Eager-load relations needed by the API response shape.
        include: taskInclude,
      });
      // Soft cycle guard: never overwrite a newer location cycle.
      let locationUpdated = await applyLocationCleaningStatusIfCurrent(
        // Carry this field through the payload or query.
        tx,
        // Execute: task.locationId,
        task.locationId,
        // Execute: task.cleaningCycle,
        task.cleaningCycle,
        // Execute: CleaningStatus.dirty,
        CleaningStatus.dirty,
      );
      // Guard: handle missing/invalid state before continuing.
      if (!locationUpdated) {
        // Load healed needed for the next decision or write.
        const healed = await healOrphanIfTaskCycleCurrent(
          // Carry this field through the payload or query.
          tx,
          // Execute: task.locationId,
          task.locationId,
          // Execute: task.cleaningCycle,
          task.cleaningCycle,
        );
        // Execute: locationUpdated = healed != null;
        locationUpdated = healed != null;
      }
      // Audit includes findings in the summary when present.
      await recordAudit({
        // Carry this field through the payload or query.
        actorEmployeeId: input.inspectorEmployeeId,
        // Field value required by this payload or query.
        action: "cleaning.inspect",
        // Field value required by this payload or query.
        entityType: "inspection",
        // Carry this field through the payload or query.
        entityId: inspection.id,
        // Carry this field through the payload or query.
        locationId: task.locationId,
        // Carry this field through the payload or query.
        reason: input.findings,
        // Open nested structure for the next related fields.
        after: {
          // Field value required by this payload or query.
          result: "rejected",
          // Carry this field through the payload or query.
          taskId: task.id,
          // Carry this field through the payload or query.
          locationUpdated,
          // Carry this field through the payload or query.
          cleaningCycle: task.cleaningCycle,
        },
        // Carry this field through the payload or query.
        summary: locationUpdated
          // Begin block/object for the following statements.
          ? `Rejected cleaning ${updatedTask.location.number}${
              input.findings?.trim() ? ` — ${input.findings.trim()}` : ""
            }`
          // Begin block/object for the following statements.
          : `Rejected cleaning ${updatedTask.location.number} (stale cycle; location unchanged)${
              input.findings?.trim() ? ` — ${input.findings.trim()}` : ""
            }`,
      // Execute: }, tx);
      }, tx);
      // Reject path success — same response shape as approve.
      return { inspection, task: updatedTask, idempotent: false };
    });
    // Fresh inspect — publish and notify the assignee.
    if (!result.idempotent) {
      // Room board refresh after status/location change.
      publish("cleaning.changed", {
        // Carry this field through the payload or query.
        locationId: result.task.locationId,
        // Carry this field through the payload or query.
        taskId: result.task.id,
      });
      // Only the current assignee (if any) gets the inspect outcome.
      const recipients: string[] = [];
      // Branch when this condition holds for the domain rule.
      if (result.task.assignedEmployeeId) {
        // Execute: recipients.push(result.task.assignedEmployeeId);
        recipients.push(result.task.assignedEmployeeId);
      }
      // Await side effect or helper before continuing.
      await createNotifications({
        // Field value required by this payload or query.
        type: "cleaning.inspected",
        // Title reflects approve vs reject for inbox skimming.
        title:
          // Execute: input.result === "approved"
          input.result === "approved"
            // Continue the previous expression with this clause.
            ? "Cleaning approved"
            // Continue the previous expression with this clause.
            : "Cleaning rejected — rework",
        // Field value required by this payload or query.
        body: `Room ${result.task.location.number}: ${input.result}`,
        // Field value required by this payload or query.
        entityType: "cleaning_task",
        // Carry this field through the payload or query.
        entityId: result.task.id,
        // Carry this field through the payload or query.
        locationId: result.task.locationId,
        // Carry this field through the payload or query.
        actorEmployeeId: input.inspectorEmployeeId,
        // Carry this field through the payload or query.
        recipientEmployeeIds: recipients,
        // Field value required by this payload or query.
        dedupeKey: `cleaning.inspected:${result.inspection.id}`,
        // Open nested structure for the next related fields.
        payload: {
          // Field value required by this payload or query.
          panel: "mywork",
          // Carry this field through the payload or query.
          taskId: result.task.id,
          // Carry this field through the payload or query.
          locationId: result.task.locationId,
          // Carry this field through the payload or query.
          locationNumber: result.task.location.number,
        },
      });
    }
    // Return txn result (idempotent or fresh).
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
        prisma.inspection.findUnique({
          // Restrict the query to the relevant rows only.
          where: { commandId: input.commandId },
          // Eager-load relations needed by the API response shape.
          include: inspectionInclude,
        }),
      // Carry this field through the payload or query.
      inspectionPayloadMatches,
    );
    // Branch when this condition holds for the domain rule.
    if (again) {
      // Early return of a terminal empty/boolean result.
      return { inspection: again, task: again.task, idempotent: true };
    }
    // Abort with an HTTP-mapped AppError or rethrow.
    throw err;
  }
}
