/**
 * Apply category-specific room and cleaning-task effects when a plan entry
 * is created (manual or import). Departure may defer vacant/dirty when stay
 * evidence is ambiguous.
 */
import {
  // Carry this field through the payload or query.
  CleaningStatus,
  // Carry this field through the payload or query.
  DailyPlanCategory,
  // Carry this field through the payload or query.
  Occupancy,
  // Carry this field through the payload or query.
  Priority,
  // Carry this field through the payload or query.
  Prisma,
// Execute: } from "@prisma/client";
} from "@prisma/client";
// Import ../../constants for dailyPlanEffects/applyEntry.ts.
import { ACTIVE_TASK_STATUSES } from "../../constants";
// Import ../assignees for dailyPlanEffects/applyEntry.ts.
import { assertActiveCleaningAssignee } from "../assignees";
// Side-effect or default import required by this module.
import {
  // Carry this field through the payload or query.
  bumpDirtyAndRebindWork,
  // Carry this field through the payload or query.
  lockRebindableTasksAndLocation,
// Execute: } from "../cleaning";
} from "../cleaning";
// Import ../hotelTime for dailyPlanEffects/applyEntry.ts.
import { todayHotelDateYmd } from "../hotelTime";
// Side-effect or default import required by this module.
import {
  // Carry this field through the payload or query.
  classifyDepartureRoomEffects,
  // Carry this field through the payload or query.
  locationsWithNewerStayEvidence,
// Execute: } from "./departure";
} from "./departure";
// Import ./hotelDate for dailyPlanEffects/applyEntry.ts.
import { formatHotelDate } from "./hotelDate";
// Side-effect or default import required by this module.
import {
  // Carry this field through the payload or query.
  PRIORITY_RANK,
  // Carry this field through the payload or query.
  connectAssigneeAndShift,
  // Carry this field through the payload or query.
  createTaskWithSectorSnapshot,
// Execute: } from "./tasks";
} from "./tasks";
// Type-only import from ./types used by dailyPlanEffects/applyEntry.ts.
import type { LocationRow, PlanEffects, TaskEffect, Tx } from "./types";

/**
 * Lock and reload the active task so assignee/priority decisions are not based
 * on a stale snapshot under concurrent reassign or sibling plan writes.
 */
async function lockActiveTask(
  // Carry this field through the payload or query.
  tx: Tx,
  // Carry this field through the payload or query.
  task: { id: string },
// Begin block/object for the following statements.
) {
  // Read the latest row(s) needed for this step.
  await tx.$queryRaw`
    SELECT id FROM "CleaningTask" WHERE id = ${task.id} FOR UPDATE
  `;
  // Return the computed result to the caller.
  return tx.cleaningTask.findUniqueOrThrow({ where: { id: task.id } });
}

/**
 * Mutate location/task state for a new plan entry inside `tx`.
 * Returns what changed so the entry can store `cleaningTaskId` /
 * `roomEffectsAppliedAt`.
 */
export async function applyPlanEntryEffects(
  // Carry this field through the payload or query.
  tx: Tx,
  // Carry this field through the payload or query.
  location: LocationRow,
  // Carry this field through the payload or query.
  hotelDate: Date,
  // Carry this field through the payload or query.
  category: DailyPlanCategory,
  // Parameter/field in the surrounding signature or type.
  assignedEmployeeId?: string,
  // Parameter/field in the surrounding signature or type.
  shiftId?: string | null,
  // Parameter/field in the surrounding signature or type.
  todayYmd?: string,
// Begin block/object for the following statements.
): Promise<PlanEffects> {
  // Plan effects can create or fill an assignment too. Keep eligibility stable
  // for this transaction, including deferred assignment stored on a plan entry.
  if (assignedEmployeeId) {
    // Await side effect or helper before continuing.
    await assertActiveCleaningAssignee(assignedEmployeeId, tx);
  }
  // Defaults: no occupancy/dirty change and no task until a branch sets them.
  let taskEffect: TaskEffect = "skipped";
  // Execute: let cleaningTaskId: string | null = null;
  let cleaningTaskId: string | null = null;
  // Execute: let occupancyEffect: "vacant" | null = null;
  let occupancyEffect: "vacant" | null = null;
  // Capture dirtyEffect for subsequent checks or writes.
  let dirtyEffect = false;
  // Capture roomEffectsApplied for subsequent checks or writes.
  let roomEffectsApplied = false;

  // Any active task for this room/date (reuse instead of creating a duplicate).
  let activeTask = await tx.cleaningTask.findFirst({
    // Restrict the query to the relevant rows only.
    where: {
      // Carry this field through the payload or query.
      locationId: location.id,
      // Carry this field through the payload or query.
      hotelDate,
      // Carry this field through the payload or query.
      status: { in: [...ACTIVE_TASK_STATUSES] },
    },
  });
  // Branch when this condition holds for the domain rule.
  if (activeTask) {
    // Execute: activeTask = await lockActiveTask(tx, activeTask);
    activeTask = await lockActiveTask(tx, activeTask);
  }

  // Branch when this condition holds for the domain rule.
  if (category === DailyPlanCategory.departure) {
    // Prefer caller-supplied todayYmd (import batch) to avoid N+1 settings reads.
    const today = todayYmd ?? (await todayHotelDateYmd());
    // Capture planYmd for subsequent checks or writes.
    const planYmd = formatHotelDate(hotelDate);
    // Room state only on/after checkout day; future departures stay planned.
    // Protect proven newer stays; defer ambiguous past occupied (no vacant/dirty
    // and no bound task that would bump cleaningCycle).
    let skipRoomAndBoundTask = false;
    // Branch when this condition holds for the domain rule.
    if (planYmd <= today) {
      // Same lock order as departure apply: tasks → location, then decide.
      await lockRebindableTasksAndLocation(tx, location.id);
      // Fresh occupancy under the location lock (may have changed since create).
      const live = await tx.location.findUniqueOrThrow({
        // Restrict the query to the relevant rows only.
        where: { id: location.id },
        // Project only the columns the caller needs.
        select: { occupancy: true },
      });
      // Audit-based proof of a newer stay after the plan day (same tx).
      const newerStayLocations = await locationsWithNewerStayEvidence(
        // Carry this field through the payload or query.
        tx,
        // Execute: [location.id],
        [location.id],
        // Carry this field through the payload or query.
        planYmd,
      );
      // Decide apply / protect / defer (confirm always false at create time).
      const decision = classifyDepartureRoomEffects({
        // Carry this field through the payload or query.
        occupancy: live.occupancy,
        // Carry this field through the payload or query.
        planYmd,
        // Carry this field through the payload or query.
        todayYmd: today,
        // Carry this field through the payload or query.
        hasNewerStayEvidence: newerStayLocations.has(location.id),
        // Field value required by this payload or query.
        confirmed: false,
      });
      // Branch when this condition holds for the domain rule.
      if (decision === "apply") {
        // Vacate + dirty; locks already held for this location.
        await bumpDirtyAndRebindWork(
          // Carry this field through the payload or query.
          tx,
          // Execute: location.id,
          location.id,
          // Execute: { occupancy: Occupancy.vacant },
          { occupancy: Occupancy.vacant },
          // Execute: { alreadyLocked: true },
          { alreadyLocked: true },
        );
        // Execute: occupancyEffect = "vacant";
        occupancyEffect = "vacant";
        // Execute: dirtyEffect = true;
        dirtyEffect = true;
        // Execute: roomEffectsApplied = true;
        roomEffectsApplied = true;
      // Begin block/object for the following statements.
      } else if (decision === "protect") {
        // Stamp applied so we do not retry; do not vacate/dirty or bind a task.
        roomEffectsApplied = true;
        // Execute: skipRoomAndBoundTask = true;
        skipRoomAndBoundTask = true;
      // Begin block/object for the following statements.
      } else {
        // defer: keep roomEffectsAppliedAt null for later confirm; preserve stay
        skipRoomAndBoundTask = true;
      }
    }

    // Create/link a high-priority departure task unless protect/defer skipped it.
    if (!skipRoomAndBoundTask) {
      // Branch when this condition holds for the domain rule.
      if (activeTask) {
        // Reuse the existing active task; bump priority to at least high.
        cleaningTaskId = activeTask.id;
        // Execute: const data: Prisma.CleaningTaskUpdateInput = {};
        const data: Prisma.CleaningTaskUpdateInput = {};
        // Branch when this condition holds for the domain rule.
        if (PRIORITY_RANK[activeTask.priority] < PRIORITY_RANK[Priority.high]) {
          // Execute: data.priority = Priority.high;
          data.priority = Priority.high;
          // Execute: taskEffect = "bumped";
          taskEffect = "bumped";
        // Begin block/object for the following statements.
        } else {
          // Execute: taskEffect = "linked";
          taskEffect = "linked";
        }
        // Attach plan assignee/shift only when the task is unbound.
        connectAssigneeAndShift(data, activeTask, assignedEmployeeId, shiftId);
        // Branch when this condition holds for the domain rule.
        if (Object.keys(data).length) {
          // Persist the mutation inside the current transaction/context.
          await tx.cleaningTask.update({
            // Restrict the query to the relevant rows only.
            where: { id: activeTask.id },
            // Carry this field through the payload or query.
            data,
          });
        }
      // Begin block/object for the following statements.
      } else {
        // No active task — create a high-priority departure task.
        const created = await createTaskWithSectorSnapshot(tx, {
          // Carry this field through the payload or query.
          locationId: location.id,
          // Carry this field through the payload or query.
          hotelDate,
          // Carry this field through the payload or query.
          priority: Priority.high,
          // Carry this field through the payload or query.
          assignedEmployeeId,
          // Carry this field through the payload or query.
          shiftId,
          // Carry this field through the payload or query.
          locationKind: location.kind,
          // Carry this field through the payload or query.
          planCategory: category,
        });
        // Execute: cleaningTaskId = created.id;
        cleaningTaskId = created.id;
        // Execute: taskEffect = "created";
        taskEffect = "created";
      }
    }
  // Begin block/object for the following statements.
  } else if (category === DailyPlanCategory.priority) {
    // Priority plan: urgent task (reuse active or create); dirty when creating.
    if (activeTask) {
      // Execute: cleaningTaskId = activeTask.id;
      cleaningTaskId = activeTask.id;
      // Execute: const data: Prisma.CleaningTaskUpdateInput = {};
      const data: Prisma.CleaningTaskUpdateInput = {};
      // Bump to urgent if the existing priority is lower.
      if (PRIORITY_RANK[activeTask.priority] < PRIORITY_RANK[Priority.urgent]) {
        // Execute: data.priority = Priority.urgent;
        data.priority = Priority.urgent;
        // Execute: taskEffect = "bumped";
        taskEffect = "bumped";
      // Begin block/object for the following statements.
      } else {
        // Execute: taskEffect = "linked";
        taskEffect = "linked";
      }
      // Execute: connectAssigneeAndShift(data, activeTask, assignedEmployeeId, shiftId);
      connectAssigneeAndShift(data, activeTask, assignedEmployeeId, shiftId);
      // Branch when this condition holds for the domain rule.
      if (Object.keys(data).length) {
        // Persist the mutation inside the current transaction/context.
        await tx.cleaningTask.update({
          // Restrict the query to the relevant rows only.
          where: { id: activeTask.id },
          // Carry this field through the payload or query.
          data,
        });
      }
    // Begin block/object for the following statements.
    } else {
      // Creating a new urgent task: mark dirty when room looked clean/inspecting.
      dirtyEffect =
        // Execute: location.cleaningStatus === CleaningStatus.verified_clean ||
        location.cleaningStatus === CleaningStatus.verified_clean ||
        // Execute: location.cleaningStatus === CleaningStatus.pending_inspection;
        location.cleaningStatus === CleaningStatus.pending_inspection;
      // Load created needed for the next decision or write.
      const created = await createTaskWithSectorSnapshot(tx, {
        // Carry this field through the payload or query.
        locationId: location.id,
        // Carry this field through the payload or query.
        hotelDate,
        // Carry this field through the payload or query.
        priority: Priority.urgent,
        // Carry this field through the payload or query.
        assignedEmployeeId,
        // Carry this field through the payload or query.
        shiftId,
        // Carry this field through the payload or query.
        locationKind: location.kind,
        // Carry this field through the payload or query.
        planCategory: category,
      });
      // Execute: cleaningTaskId = created.id;
      cleaningTaskId = created.id;
      // Execute: taskEffect = "created";
      taskEffect = "created";
    }
  // Begin block/object for the following statements.
  } else {
    // arrival — no occupancy change; task only if not verified_clean
    if (location.cleaningStatus !== CleaningStatus.verified_clean) {
      // Branch when this condition holds for the domain rule.
      if (activeTask) {
        // Reuse active task; bump to at least high for arrival prep.
        cleaningTaskId = activeTask.id;
        // Execute: const data: Prisma.CleaningTaskUpdateInput = {};
        const data: Prisma.CleaningTaskUpdateInput = {};
        // Branch when this condition holds for the domain rule.
        if (PRIORITY_RANK[activeTask.priority] < PRIORITY_RANK[Priority.high]) {
          // Execute: data.priority = Priority.high;
          data.priority = Priority.high;
          // Execute: taskEffect = "bumped";
          taskEffect = "bumped";
        // Begin block/object for the following statements.
        } else {
          // Execute: taskEffect = "linked";
          taskEffect = "linked";
        }
        // Execute: connectAssigneeAndShift(data, activeTask, assignedEmployeeId, shiftId);
        connectAssigneeAndShift(data, activeTask, assignedEmployeeId, shiftId);
        // Branch when this condition holds for the domain rule.
        if (Object.keys(data).length) {
          // Persist the mutation inside the current transaction/context.
          await tx.cleaningTask.update({
            // Restrict the query to the relevant rows only.
            where: { id: activeTask.id },
            // Carry this field through the payload or query.
            data,
          });
        }
      // Begin block/object for the following statements.
      } else {
        // Create a high-priority arrival cleaning task.
        const created = await createTaskWithSectorSnapshot(tx, {
          // Carry this field through the payload or query.
          locationId: location.id,
          // Carry this field through the payload or query.
          hotelDate,
          // Carry this field through the payload or query.
          priority: Priority.high,
          // Carry this field through the payload or query.
          assignedEmployeeId,
          // Carry this field through the payload or query.
          shiftId,
          // Carry this field through the payload or query.
          locationKind: location.kind,
          // Carry this field through the payload or query.
          planCategory: category,
        });
        // Execute: cleaningTaskId = created.id;
        cleaningTaskId = created.id;
        // Execute: taskEffect = "created";
        taskEffect = "created";
      }
    // Begin block/object for the following statements.
    } else {
      // Already verified_clean — no arrival cleaning work needed.
      taskEffect = "skipped";
    }
  }

  // Summary for the plan entry to store cleaningTaskId / roomEffectsAppliedAt.
  return {
    // Carry this field through the payload or query.
    occupancy: occupancyEffect,
    // Carry this field through the payload or query.
    dirty: dirtyEffect,
    // Carry this field through the payload or query.
    task: taskEffect,
    // Carry this field through the payload or query.
    cleaningTaskId,
    // Carry this field through the payload or query.
    roomEffectsApplied,
  };
}
