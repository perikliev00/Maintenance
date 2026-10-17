/**
 * Manually create a daily plan entry and apply category-specific room/task effects.
 */
import { DailyPlanCategory, DailyPlanSource, LocationKind } from "@prisma/client";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { assertActiveCleaningAssignee } from "../assignees";
import { applyPlanEntryEffects, parseHotelDate } from "../dailyPlanEffects";
import { todayHotelDateYmd } from "../hotelTime";
import { assertActiveShiftId } from "../shifts";
import { mapEntry } from "./format";
import {
  isDailyPlanEntryDateLocCategoryConflict,
  isP2002,
} from "./prismaConflicts";
import { entryInclude } from "./types";

const PLAN_ENTRY_EXISTS =
  "Plan entry already exists for this room/date/category";

/**
 * Create a unique (hotelDate, location, category) plan entry for an active room.
 * Runs {@link applyPlanEntryEffects} inside the same transaction.
 */
export async function createDailyPlanEntry(input: {
  hotelDate: string;
  locationId: string;
  category: DailyPlanCategory;
  notes?: string;
  assignedEmployeeId?: string;
  shiftId?: string | null;
  createdByEmployeeId: string;
}) {
  // Normalize YYYY-MM-DD into the Date used as DailyPlanEntry.hotelDate.
  const hotelDate = parseHotelDate(input.hotelDate);
  // null/undefined shift is ok; invalid ids throw.
  const shiftId = await assertActiveShiftId(input.shiftId);

  // Load the room before uniqueness / effects checks.
  const location = await prisma.location.findUnique({
    where: { id: input.locationId },
  });
  // Missing location → 404 (client may have stale id).
  if (!location) {
    throw new AppError(404, "not_found", "Room not found");
  }
  // Daily plan is rooms-only (not common areas).
  if (location.kind !== LocationKind.room) {
    throw new AppError(400, "invalid_state", "Daily plan entries are for rooms only");
  }
  // Archived rooms cannot receive new plan rows.
  if (location.catalogStatus !== "active") {
    throw new AppError(400, "invalid_state", "Room is archived");
  }

  // Unique per (hotelDate, location, category).
  const existingEntry = await prisma.dailyPlanEntry.findUnique({
    where: {
      hotelDate_locationId_category: {
        hotelDate,
        locationId: input.locationId,
        category: input.category,
      },
    },
  });
  // Duplicate category for the same room/day is a conflict.
  if (existingEntry) {
    throw new AppError(409, "conflict", PLAN_ENTRY_EXISTS);
  }

  // Optional assignee must be an active housekeeper.
  if (input.assignedEmployeeId) {
    await assertActiveCleaningAssignee(input.assignedEmployeeId);
  }

  // Effects + entry insert must succeed together.
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Hotel-local "today" gates deferred departure room effects.
      const todayYmd = await todayHotelDateYmd();
      // Category-specific occupancy/dirty/task side effects.
      const effects = await applyPlanEntryEffects(
        tx,
        location,
        hotelDate,
        input.category,
        input.assignedEmployeeId,
        shiftId ?? undefined,
        todayYmd,
      );

      // Persist the plan row with linked task id and optional room-effects stamp.
      const entry = await tx.dailyPlanEntry.create({
        data: {
          hotelDate,
          locationId: location.id,
          category: input.category,
          notes: input.notes ?? null,
          source: DailyPlanSource.manual,
          cleaningTaskId: effects.cleaningTaskId,
          // Preserve for deferred departure confirm (even when task was skipped).
          assignedEmployeeId: input.assignedEmployeeId ?? null,
          shiftId: shiftId ?? null,
          roomEffectsAppliedAt: effects.roomEffectsApplied ? new Date() : null,
          createdByEmployeeId: input.createdByEmployeeId,
        },
        include: entryInclude,
      });

      // API payload: mapped entry + effect summary for the UI toast.
      return {
        entry: mapEntry(entry),
        effects: {
          occupancy: effects.occupancy,
          dirty: effects.dirty,
          task: effects.task,
          cleaningTaskId: effects.cleaningTaskId,
        },
      };
    });

    return result;
  } catch (err) {
    // Concurrent create/import: map only DailyPlanEntry (date,loc,cat) unique.
    // CleaningTask P2002 must not become "plan entry exists".
    if (isP2002(err) && isDailyPlanEntryDateLocCategoryConflict(err)) {
      throw new AppError(409, "conflict", PLAN_ENTRY_EXISTS);
    }
    if (isP2002(err)) {
      // After rollback: confirm the plan row won the race even if meta is opaque.
      const raced = await prisma.dailyPlanEntry.findUnique({
        where: {
          hotelDate_locationId_category: {
            hotelDate,
            locationId: input.locationId,
            category: input.category,
          },
        },
        select: { id: true },
      });
      if (raced) {
        throw new AppError(409, "conflict", PLAN_ENTRY_EXISTS);
      }
    }
    throw err;
  }
}
