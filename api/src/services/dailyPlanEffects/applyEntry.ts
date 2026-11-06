/**
 * Apply category-specific room and cleaning-task effects when a plan entry
 * is created (manual or import). Departure may defer vacant/dirty when stay
 * evidence is ambiguous.
 */
import {
  CleaningStatus,
  DailyPlanCategory,
  Occupancy,
  Priority,
  Prisma,
} from "@prisma/client";
import { ACTIVE_TASK_STATUSES } from "../../constants";
import { assertActiveCleaningAssignee } from "../assignees";
import {
  bumpDirtyAndRebindWork,
  lockRebindableTasksAndLocation,
} from "../cleaning";
import { todayHotelDateYmd } from "../hotelTime";
import {
  classifyDepartureRoomEffects,
  locationsWithNewerStayEvidence,
} from "./departure";
import { formatHotelDate } from "./hotelDate";
import {
  PRIORITY_RANK,
  connectAssigneeAndShift,
  createTaskWithSectorSnapshot,
} from "./tasks";
import type { LocationRow, PlanEffects, TaskEffect, Tx } from "./types";

/**
 * Lock and reload the active task so assignee/priority decisions are not based
 * on a stale snapshot under concurrent reassign or sibling plan writes.
 */
async function lockActiveTask(
  tx: Tx,
  task: { id: string },
) {
  await tx.$queryRaw`
    SELECT id FROM "CleaningTask" WHERE id = ${task.id} FOR UPDATE
  `;
  return tx.cleaningTask.findUniqueOrThrow({ where: { id: task.id } });
}

/**
 * Mutate location/task state for a new plan entry inside `tx`.
 * Returns what changed so the entry can store `cleaningTaskId` /
 * `roomEffectsAppliedAt`.
 */
export async function applyPlanEntryEffects(
  tx: Tx,
  location: LocationRow,
  hotelDate: Date,
  category: DailyPlanCategory,
  assignedEmployeeId?: string,
  shiftId?: string | null,
  todayYmd?: string,
): Promise<PlanEffects> {
  // Plan effects can create or fill an assignment too. Keep eligibility stable
  // for this transaction, including deferred assignment stored on a plan entry.
  if (assignedEmployeeId) {
    await assertActiveCleaningAssignee(assignedEmployeeId, tx);
  }
  // Defaults: no occupancy/dirty change and no task until a branch sets them.
  let taskEffect: TaskEffect = "skipped";
  let cleaningTaskId: string | null = null;
  let occupancyEffect: "vacant" | null = null;
  let dirtyEffect = false;
  let roomEffectsApplied = false;

  // Any active task for this room/date (reuse instead of creating a duplicate).
  let activeTask = await tx.cleaningTask.findFirst({
    where: {
      locationId: location.id,
      hotelDate,
      status: { in: [...ACTIVE_TASK_STATUSES] },
    },
  });
  if (activeTask) {
    activeTask = await lockActiveTask(tx, activeTask);
  }

  if (category === DailyPlanCategory.departure) {
    // Prefer caller-supplied todayYmd (import batch) to avoid N+1 settings reads.
    const today = todayYmd ?? (await todayHotelDateYmd());
    const planYmd = formatHotelDate(hotelDate);
    // Room state only on/after checkout day; future departures stay planned.
    // Protect proven newer stays; defer ambiguous past occupied (no vacant/dirty
    // and no bound task that would bump cleaningCycle).
    let skipRoomAndBoundTask = false;
    if (planYmd <= today) {
      // Same lock order as departure apply: tasks → location, then decide.
      await lockRebindableTasksAndLocation(tx, location.id);
      // Fresh occupancy under the location lock (may have changed since create).
      const live = await tx.location.findUniqueOrThrow({
        where: { id: location.id },
        select: { occupancy: true },
      });
      // Audit-based proof of a newer stay after the plan day (same tx).
      const newerStayLocations = await locationsWithNewerStayEvidence(
        tx,
        [location.id],
        planYmd,
      );
      // Decide apply / protect / defer (confirm always false at create time).
      const decision = classifyDepartureRoomEffects({
        occupancy: live.occupancy,
        planYmd,
        todayYmd: today,
        hasNewerStayEvidence: newerStayLocations.has(location.id),
        confirmed: false,
      });
      if (decision === "apply") {
        // Vacate + dirty; locks already held for this location.
        await bumpDirtyAndRebindWork(
          tx,
          location.id,
          { occupancy: Occupancy.vacant },
          { alreadyLocked: true },
        );
        occupancyEffect = "vacant";
        dirtyEffect = true;
        roomEffectsApplied = true;
      } else if (decision === "protect") {
        // Stamp applied so we do not retry; do not vacate/dirty or bind a task.
        roomEffectsApplied = true;
        skipRoomAndBoundTask = true;
      } else {
        // defer: keep roomEffectsAppliedAt null for later confirm; preserve stay
        skipRoomAndBoundTask = true;
      }
    }

    // Create/link a high-priority departure task unless protect/defer skipped it.
    if (!skipRoomAndBoundTask) {
      if (activeTask) {
        // Reuse the existing active task; bump priority to at least high.
        cleaningTaskId = activeTask.id;
        const data: Prisma.CleaningTaskUpdateInput = {};
        if (PRIORITY_RANK[activeTask.priority] < PRIORITY_RANK[Priority.high]) {
          data.priority = Priority.high;
          taskEffect = "bumped";
        } else {
          taskEffect = "linked";
        }
        // Attach plan assignee/shift only when the task is unbound.
        connectAssigneeAndShift(data, activeTask, assignedEmployeeId, shiftId);
        if (Object.keys(data).length) {
          await tx.cleaningTask.update({
            where: { id: activeTask.id },
            data,
          });
        }
      } else {
        // No active task — create a high-priority departure task.
        const created = await createTaskWithSectorSnapshot(tx, {
          locationId: location.id,
          hotelDate,
          priority: Priority.high,
          assignedEmployeeId,
          shiftId,
          locationKind: location.kind,
          planCategory: category,
        });
        cleaningTaskId = created.id;
        taskEffect = "created";
      }
    }
  } else if (category === DailyPlanCategory.priority) {
    // Priority plan: urgent task (reuse active or create); dirty when creating.
    if (activeTask) {
      cleaningTaskId = activeTask.id;
      const data: Prisma.CleaningTaskUpdateInput = {};
      // Bump to urgent if the existing priority is lower.
      if (PRIORITY_RANK[activeTask.priority] < PRIORITY_RANK[Priority.urgent]) {
        data.priority = Priority.urgent;
        taskEffect = "bumped";
      } else {
        taskEffect = "linked";
      }
      connectAssigneeAndShift(data, activeTask, assignedEmployeeId, shiftId);
      if (Object.keys(data).length) {
        await tx.cleaningTask.update({
          where: { id: activeTask.id },
          data,
        });
      }
    } else {
      // Creating a new urgent task: mark dirty when room looked clean/inspecting.
      dirtyEffect =
        location.cleaningStatus === CleaningStatus.verified_clean ||
        location.cleaningStatus === CleaningStatus.pending_inspection;
      const created = await createTaskWithSectorSnapshot(tx, {
        locationId: location.id,
        hotelDate,
        priority: Priority.urgent,
        assignedEmployeeId,
        shiftId,
        locationKind: location.kind,
        planCategory: category,
      });
      cleaningTaskId = created.id;
      taskEffect = "created";
    }
  } else {
    // arrival — no occupancy change; task only if not verified_clean
    if (location.cleaningStatus !== CleaningStatus.verified_clean) {
      if (activeTask) {
        // Reuse active task; bump to at least high for arrival prep.
        cleaningTaskId = activeTask.id;
        const data: Prisma.CleaningTaskUpdateInput = {};
        if (PRIORITY_RANK[activeTask.priority] < PRIORITY_RANK[Priority.high]) {
          data.priority = Priority.high;
          taskEffect = "bumped";
        } else {
          taskEffect = "linked";
        }
        connectAssigneeAndShift(data, activeTask, assignedEmployeeId, shiftId);
        if (Object.keys(data).length) {
          await tx.cleaningTask.update({
            where: { id: activeTask.id },
            data,
          });
        }
      } else {
        // Create a high-priority arrival cleaning task.
        const created = await createTaskWithSectorSnapshot(tx, {
          locationId: location.id,
          hotelDate,
          priority: Priority.high,
          assignedEmployeeId,
          shiftId,
          locationKind: location.kind,
          planCategory: category,
        });
        cleaningTaskId = created.id;
        taskEffect = "created";
      }
    } else {
      // Already verified_clean — no arrival cleaning work needed.
      taskEffect = "skipped";
    }
  }

  // Summary for the plan entry to store cleaningTaskId / roomEffectsAppliedAt.
  return {
    occupancy: occupancyEffect,
    dirty: dirtyEffect,
    task: taskEffect,
    cleaningTaskId,
    roomEffectsApplied,
  };
}
