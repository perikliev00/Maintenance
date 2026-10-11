import { CleaningStatus, InspectionResult, TaskStatus } from "@prisma/client";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { publish } from "../../events/bus";
import { recordAudit } from "../audit";
import { createNotifications } from "../notifications";
import { taskInclude } from "../cleaningTasksQuery";
import {
  assertTaskVersion,
  claimTaskStatus,
} from "./claims";
import { applyLocationCleaningStatusIfCurrent } from "./locationStatus";
import { lockTask } from "./locks";
import { isP2002 } from "./prismaConflicts";

export async function inspectCleaningTask(input: {
  taskId: string;
  inspectorEmployeeId: string;
  commandId: string;
  result: "approved" | "rejected";
  findings?: string;
  expectedVersion?: number;
}) {
  const existing = await prisma.inspection.findUnique({
    where: { commandId: input.commandId },
    include: { task: { include: taskInclude } },
  });
  if (existing) {
    return { inspection: existing, task: existing.task, idempotent: true };
  }

  if (input.result === "rejected" && !input.findings?.trim()) {
    throw new AppError(400, "validation", "Findings/reason required when rejecting");
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockTask(tx, input.taskId);

      const task = await tx.cleaningTask.findUnique({
        where: { id: input.taskId },
      });
      if (!task) {
        throw new AppError(404, "not_found", "Task not found");
      }
      if (task.status !== TaskStatus.awaiting_inspection) {
        throw new AppError(
          409,
          "invalid_state",
          `Cannot inspect task in status ${task.status}`,
        );
      }
      assertTaskVersion(task, input.expectedVersion);

      const inspection = await tx.inspection.create({
        data: {
          taskId: task.id,
          inspectorEmployeeId: input.inspectorEmployeeId,
          inspectedAt: new Date(),
          result:
            input.result === "approved"
              ? InspectionResult.approved
              : InspectionResult.rejected,
          findings: input.findings?.trim() || null,
          commandId: input.commandId,
        },
      });

      if (input.result === "approved") {
        const completedAt = inspection.inspectedAt;
        await claimTaskStatus(
          tx,
          task.id,
          [TaskStatus.awaiting_inspection],
          { status: TaskStatus.completed, completedAt },
          input.expectedVersion,
        );
        const updatedTask = await tx.cleaningTask.findUniqueOrThrow({
          where: { id: task.id },
          include: taskInclude,
        });
        const locationUpdated = await applyLocationCleaningStatusIfCurrent(
          tx,
          task.locationId,
          task.cleaningCycle,
          CleaningStatus.verified_clean,
        );
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
          summary: locationUpdated
            ? `Approved cleaning ${updatedTask.location.number}`
            : `Approved cleaning ${updatedTask.location.number} (stale cycle; location unchanged)`,
        }, tx);
        return { inspection, task: updatedTask, idempotent: false };
      }

      await claimTaskStatus(
        tx,
        task.id,
        [TaskStatus.awaiting_inspection],
        { status: TaskStatus.rework },
        input.expectedVersion,
      );
      const updatedTask = await tx.cleaningTask.findUniqueOrThrow({
        where: { id: task.id },
        include: taskInclude,
      });
      const locationUpdated = await applyLocationCleaningStatusIfCurrent(
        tx,
        task.locationId,
        task.cleaningCycle,
        CleaningStatus.dirty,
      );
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
      return { inspection, task: updatedTask, idempotent: false };
    });
    if (!result.idempotent) {
      publish("cleaning.changed", {
        locationId: result.task.locationId,
        taskId: result.task.id,
      });
      const recipients: string[] = [];
      if (result.task.assignedEmployeeId) {
        recipients.push(result.task.assignedEmployeeId);
      }
      await createNotifications({
        type: "cleaning.inspected",
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
    return result;
  } catch (err) {
    if (isP2002(err)) {
      const again = await prisma.inspection.findUnique({
        where: { commandId: input.commandId },
        include: { task: { include: taskInclude } },
      });
      if (again) {
        return { inspection: again, task: again.task, idempotent: true };
      }
    }
    throw err;
  }
}
