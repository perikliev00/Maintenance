/**
 * Manually create a daily plan entry and apply category-specific room/task effects.
 */
import { DailyPlanCategory, DailyPlanSource, LocationKind } from "@prisma/client";
// Import ../../db for dailyPlan/create.ts.
import { prisma } from "../../db";
// Import ../../errors for dailyPlan/create.ts.
import { AppError } from "../../errors";
// Import ../assignees for dailyPlan/create.ts.
import { assertActiveCleaningAssignee } from "../assignees";
// Import ../dailyPlanEffects for dailyPlan/create.ts.
import { applyPlanEntryEffects, parseHotelDate } from "../dailyPlanEffects";
// Import ../hotelTime for dailyPlan/create.ts.
import { todayHotelDateYmd } from "../hotelTime";
// Import ../shifts for dailyPlan/create.ts.
import { assertActiveShiftId } from "../shifts";
// Import ./format for dailyPlan/create.ts.
import { mapEntry } from "./format";
// Side-effect or default import required by this module.
import {
  isDailyPlanEntryDateLocCategoryConflict,
  isP2002,
// Execute: } from "./prismaConflicts";
} from "./prismaConflicts";
// Import ./types for dailyPlan/create.ts.
import { entryInclude } from "./types";

const PLAN_ENTRY_EXISTS =
  // Execute: "Plan entry already exists for this room/date/category";
  "Plan entry already exists for this room/date/category";

/**
 * Create a unique (hotelDate, location, category) plan entry for an active room.
 * Runs {@link applyPlanEntryEffects} inside the same transaction.
 */
export async function createDailyPlanEntry(input: {
  hotelDate: string;
  locationId: string;
  category: DailyPlanCategory;
  // Parameter/field in the surrounding signature or type.
  notes?: string;
  // Parameter/field in the surrounding signature or type.
  assignedEmployeeId?: string;
  // Parameter/field in the surrounding signature or type.
  shiftId?: string | null;
  createdByEmployeeId: string;
}) {
  // Normalize YYYY-MM-DD into the Date used as DailyPlanEntry.hotelDate.
  const hotelDate = parseHotelDate(input.hotelDate);
  // null/undefined shift is ok; invalid ids throw.
  const shiftId = await assertActiveShiftId(input.shiftId);

  // Load the room before uniqueness / effects checks.
  const location = await prisma.location.findUnique({
    // Restrict the query to the relevant rows only.
    where: { id: input.locationId },
  });
  // Missing location → 404 (client may have stale id).
  if (!location) {
    // Abort with an HTTP-mapped AppError or rethrow.
    throw new AppError(404, "not_found", "Room not found");
  }
  // Daily plan is rooms-only (not common areas).
  if (location.kind !== LocationKind.room) {
    // Abort with an HTTP-mapped AppError or rethrow.
    throw new AppError(400, "invalid_state", "Daily plan entries are for rooms only");
  }
  // Archived rooms cannot receive new plan rows.
  if (location.catalogStatus !== "active") {
    // Abort with an HTTP-mapped AppError or rethrow.
    throw new AppError(400, "invalid_state", "Room is archived");
  }

  // Unique per (hotelDate, location, category).
  const existingEntry = await prisma.dailyPlanEntry.findUnique({
    // Restrict the query to the relevant rows only.
    where: {
      // Open nested structure for the next related fields.
      hotelDate_locationId_category: {
        hotelDate,
        locationId: input.locationId,
        category: input.category,
      },
    },
  });
  // Duplicate category for the same room/day is a conflict.
  if (existingEntry) {
    // Abort with an HTTP-mapped AppError or rethrow.
    throw new AppError(409, "conflict", PLAN_ENTRY_EXISTS);
  }

  // Optional assignee must be an active housekeeper.
  if (input.assignedEmployeeId) {
    await assertActiveCleaningAssignee(input.assignedEmployeeId);
  }

  // Effects + entry insert must succeed together.
  try {
    // Load result needed for the next decision or write.
    const result = await prisma.$transaction(async (tx) => {
      // Hotel-local "today" gates deferred departure room effects.
      const todayYmd = await todayHotelDateYmd();
      // Category-specific occupancy/dirty/task side effects.
      const effects = await applyPlanEntryEffects(
        tx,
        location,
        hotelDate,
        // Execute: input.category,
        input.category,
        // Execute: input.assignedEmployeeId,
        input.assignedEmployeeId,
        // Execute: shiftId ?? undefined,
        shiftId ?? undefined,
        todayYmd,
      );

      // Persist the plan row with linked task id and optional room-effects stamp.
      const entry = await tx.dailyPlanEntry.create({
        // Fields written by this create/update.
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
        // Eager-load relations needed by the API response shape.
        include: entryInclude,
      });

      // API payload: mapped entry + effect summary for the UI toast.
      return {
        entry: mapEntry(entry),
        // Open nested structure for the next related fields.
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
      // Abort with an HTTP-mapped AppError or rethrow.
      throw new AppError(409, "conflict", PLAN_ENTRY_EXISTS);
    }
    // Conflict/stale path: map domain race to a safe response.
    if (isP2002(err)) {
      // After rollback: confirm the plan row won the race even if meta is opaque.
      const raced = await prisma.dailyPlanEntry.findUnique({
        // Restrict the query to the relevant rows only.
        where: {
          // Open nested structure for the next related fields.
          hotelDate_locationId_category: {
            hotelDate,
            locationId: input.locationId,
            category: input.category,
          },
        },
        // Project only the columns the caller needs.
        select: { id: true },
      });
      // Branch when this condition holds for the domain rule.
      if (raced) {
        // Abort with an HTTP-mapped AppError or rethrow.
        throw new AppError(409, "conflict", PLAN_ENTRY_EXISTS);
      }
    }
    // Abort with an HTTP-mapped AppError or rethrow.
    throw err;
  }
}
