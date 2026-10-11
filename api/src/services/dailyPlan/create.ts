import { DailyPlanCategory, DailyPlanSource, LocationKind } from "@prisma/client";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { assertActiveCleaningAssignee } from "../assignees";
import { applyPlanEntryEffects, parseHotelDate } from "../dailyPlanEffects";
import { todayHotelDateYmd } from "../hotelTime";
import { assertActiveShiftId } from "../shifts";
import { mapEntry } from "./format";
import { entryInclude } from "./types";

export async function createDailyPlanEntry(input: {
  hotelDate: string;
  locationId: string;
  category: DailyPlanCategory;
  notes?: string;
  assignedEmployeeId?: string;
  shiftId?: string | null;
  createdByEmployeeId: string;
}) {
  const hotelDate = parseHotelDate(input.hotelDate);
  const shiftId = await assertActiveShiftId(input.shiftId);

  const location = await prisma.location.findUnique({
    where: { id: input.locationId },
  });
  if (!location) {
    throw new AppError(404, "not_found", "Room not found");
  }
  if (location.kind !== LocationKind.room) {
    throw new AppError(400, "invalid_state", "Daily plan entries are for rooms only");
  }
  if (location.catalogStatus !== "active") {
    throw new AppError(400, "invalid_state", "Room is archived");
  }

  const existingEntry = await prisma.dailyPlanEntry.findUnique({
    where: {
      hotelDate_locationId_category: {
        hotelDate,
        locationId: input.locationId,
        category: input.category,
      },
    },
  });
  if (existingEntry) {
    throw new AppError(
      409,
      "conflict",
      "Plan entry already exists for this room/date/category",
    );
  }

  if (input.assignedEmployeeId) {
    await assertActiveCleaningAssignee(input.assignedEmployeeId);
  }

  const result = await prisma.$transaction(async (tx) => {
    const todayYmd = await todayHotelDateYmd();
    const effects = await applyPlanEntryEffects(
      tx,
      location,
      hotelDate,
      input.category,
      input.assignedEmployeeId,
      shiftId ?? undefined,
      todayYmd,
    );

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
}
