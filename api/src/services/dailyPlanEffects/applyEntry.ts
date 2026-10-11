import {
  CleaningStatus,
  DailyPlanCategory,
  Occupancy,
  Priority,
  Prisma,
} from "@prisma/client";
import { ACTIVE_TASK_STATUSES } from "../../constants";
import { bumpDirtyAndRebindWork } from "../cleaning";
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

export async function applyPlanEntryEffects(
  tx: Tx,
  location: LocationRow,
  hotelDate: Date,
  category: DailyPlanCategory,
  assignedEmployeeId?: string,
  shiftId?: string | null,
  todayYmd?: string,
): Promise<PlanEffects> {
  let taskEffect: TaskEffect = "skipped";
  let cleaningTaskId: string | null = null;
  let occupancyEffect: "vacant" | null = null;
  let dirtyEffect = false;
  let roomEffectsApplied = false;

  const activeTask = await tx.cleaningTask.findFirst({
    where: {
      locationId: location.id,
      hotelDate,
      status: { in: [...ACTIVE_TASK_STATUSES] },
    },
  });

  if (category === DailyPlanCategory.departure) {
    const today = todayYmd ?? (await todayHotelDateYmd());
    const planYmd = formatHotelDate(hotelDate);
    // Room state only on/after checkout day; future departures stay planned.
    // Protect proven newer stays; defer ambiguous past occupied (no vacant/dirty
    // and no bound task that would bump cleaningCycle).
    let skipRoomAndBoundTask = false;
    if (planYmd <= today) {
      const live = await tx.location.findUniqueOrThrow({
        where: { id: location.id },
        select: { occupancy: true },
      });
      const newerStayLocations = await locationsWithNewerStayEvidence(
        tx,
        [location.id],
        planYmd,
      );
      const decision = classifyDepartureRoomEffects({
        occupancy: live.occupancy,
        planYmd,
        todayYmd: today,
        hasNewerStayEvidence: newerStayLocations.has(location.id),
        confirmed: false,
      });
      if (decision === "apply") {
        await bumpDirtyAndRebindWork(tx, location.id, {
          occupancy: Occupancy.vacant,
        });
        occupancyEffect = "vacant";
        dirtyEffect = true;
        roomEffectsApplied = true;
      } else if (decision === "protect") {
        roomEffectsApplied = true;
        skipRoomAndBoundTask = true;
      } else {
        // defer: keep roomEffectsAppliedAt null for later confirm; preserve stay
        skipRoomAndBoundTask = true;
      }
    }

    if (!skipRoomAndBoundTask) {
      if (activeTask) {
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
    if (activeTask) {
      cleaningTaskId = activeTask.id;
      const data: Prisma.CleaningTaskUpdateInput = {};
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
      taskEffect = "skipped";
    }
  }

  return {
    occupancy: occupancyEffect,
    dirty: dirtyEffect,
    task: taskEffect,
    cleaningTaskId,
    roomEffectsApplied,
  };
}
