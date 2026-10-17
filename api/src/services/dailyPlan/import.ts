/**
 * Bulk-import daily plan rows from an external source (e.g. clock/PMS export).
 * Idempotent on `(source, externalId)` when provided; respects location scope.
 */
import {
  DailyPlanImportStatus,
  DailyPlanSource,
  LocationKind,
  Prisma,
} from "@prisma/client";
import { prisma } from "../../db";
import { applyPlanEntryEffects, parseHotelDate } from "../dailyPlanEffects";
import { todayHotelDateYmd } from "../hotelTime";
import { mapBatch } from "./format";
import {
  isDailyPlanEntryDateLocCategoryConflict,
  isP2002,
} from "./prismaConflicts";
import { getDailyPlan } from "./queries";
import type { DailyPlanImportPayload, ImportError } from "./types";

/** Resolve a room by building code + number; flag out-of-scope vs missing. */
async function resolveRoomByBuildingAndNumber(
  buildingCode: string,
  roomNumber: string,
  locationFilter?: Prisma.LocationWhereInput,
): Promise<
  | { location: NonNullable<Awaited<ReturnType<typeof prisma.location.findFirst>>>; outOfScope: false }
  | { location: null; outOfScope: boolean }
> {
  // Look up the room by building code + room number (rooms only).
  const location = await prisma.location.findFirst({
    where: {
      number: roomNumber,
      kind: LocationKind.room,
      floor: { building: { code: buildingCode } },
    },
  });
  // Unknown room — not an out-of-scope miss.
  if (!location) {
    return { location: null, outOfScope: false };
  }
  // When the caller has a data-scope filter, re-check the room is inside it.
  if (locationFilter && Object.keys(locationFilter).length > 0) {
    const inScope = await prisma.location.findFirst({
      where: { id: location.id, ...locationFilter },
      select: { id: true },
    });
    // Found globally but outside the caller's permitted locations.
    if (!inScope) {
      return { location: null, outOfScope: true };
    }
  }
  return { location, outOfScope: false };
}

/**
 * Import plan entries for one hotel date into a tracked batch.
 * Skips duplicates / out-of-scope rooms; records per-row errors on the batch.
 */
export async function importDailyPlan(
  payload: DailyPlanImportPayload,
  createdByEmployeeId: string,
  locationFilter?: Prisma.LocationWhereInput,
) {
  // Normalize YYYY-MM-DD into the Date used as DailyPlanEntry.hotelDate.
  const hotelDate = parseHotelDate(payload.hotelDate);
  // Empty label falls back to "clock" (legacy PMS/clock export naming).
  const sourceLabel = payload.sourceLabel.trim() || "clock";
  const entries = payload.entries;

  // Create the batch up-front as failed; finalize status after the loop.
  const batch = await prisma.dailyPlanImportBatch.create({
    data: {
      hotelDate,
      sourceLabel,
      status: DailyPlanImportStatus.failed,
      totalCount: entries.length,
      createdByEmployeeId,
      errors: [],
    },
  });

  let createdCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  const errors: ImportError[] = [];
  // Hotel-local "today" gates deferred departure room effects per row.
  const todayYmd = await todayHotelDateYmd();

  for (let index = 0; index < entries.length; index++) {
    const item = entries[index];
    // Human-readable room label for per-row error reporting.
    const roomLabel = `${item.buildingCode} ${item.roomNumber}`;

    let resolvedLocationId: string | null = null;
    try {
      // Idempotent skip when the same external id was already imported.
      if (item.externalId) {
        const byExternal = await prisma.dailyPlanEntry.findUnique({
          where: {
            source_externalId: {
              source: DailyPlanSource.import,
              externalId: item.externalId,
            },
          },
        });
        if (byExternal) {
          skippedCount += 1;
          continue;
        }
      }

      // Resolve building+number; distinguish missing vs out-of-scope.
      const resolved = await resolveRoomByBuildingAndNumber(
        item.buildingCode,
        item.roomNumber,
        locationFilter,
      );
      // Missing or out-of-scope → record error and continue the batch.
      if (!resolved.location) {
        errorCount += 1;
        errors.push({
          index,
          room: roomLabel,
          reason: resolved.outOfScope
            ? "Outside your permitted data scope"
            : "Room not found",
        });
        continue;
      }
      const location = resolved.location;
      resolvedLocationId = location.id;
      // Archived rooms cannot receive new plan rows.
      if (location.catalogStatus !== "active") {
        errorCount += 1;
        errors.push({
          index,
          room: roomLabel,
          reason: "Room is archived",
        });
        continue;
      }

      // Unique per (hotelDate, location, category) — skip if already present.
      const existing = await prisma.dailyPlanEntry.findUnique({
        where: {
          hotelDate_locationId_category: {
            hotelDate,
            locationId: location.id,
            category: item.category,
          },
        },
      });

      if (existing) {
        // manual wins; existing import is idempotent skip
        skippedCount += 1;
        continue;
      }

      // Effects + entry insert must succeed together for this row.
      await prisma.$transaction(async (tx) => {
        // Category-specific occupancy/dirty/task side effects (no assignee on import).
        const effects = await applyPlanEntryEffects(
          tx,
          location,
          hotelDate,
          item.category,
          undefined,
          undefined,
          todayYmd,
        );

        // Persist the imported plan row linked to this batch.
        await tx.dailyPlanEntry.create({
          data: {
            hotelDate,
            locationId: location.id,
            category: item.category,
            notes: item.notes ?? null,
            source: DailyPlanSource.import,
            externalId: item.externalId ?? null,
            importBatchId: batch.id,
            cleaningTaskId: effects.cleaningTaskId,
            roomEffectsAppliedAt: effects.roomEffectsApplied ? new Date() : null,
            createdByEmployeeId,
          },
        });
      });

      createdCount += 1;
    } catch (err) {
      // Concurrent create won the (hotelDate, location, category) race:
      // treat like the pre-insert existing-row skip (not an error).
      if (isP2002(err) && isDailyPlanEntryDateLocCategoryConflict(err)) {
        skippedCount += 1;
        continue;
      }
      if (isP2002(err) && resolvedLocationId) {
        const raced = await prisma.dailyPlanEntry.findUnique({
          where: {
            hotelDate_locationId_category: {
              hotelDate,
              locationId: resolvedLocationId,
              category: item.category,
            },
          },
          select: { id: true },
        });
        if (raced) {
          skippedCount += 1;
          continue;
        }
      }
      // Unexpected throws become per-row errors; the batch continues.
      errorCount += 1;
      const reason =
        err instanceof Error ? err.message : "Unexpected import error";
      errors.push({ index, room: roomLabel, reason });
    }
  }

  // Derive batch status from created vs error counts.
  let status: DailyPlanImportStatus;
  if (createdCount === 0 && errorCount > 0) {
    status = DailyPlanImportStatus.failed;
  } else if (errorCount > 0) {
    status = DailyPlanImportStatus.partial;
  } else {
    status = DailyPlanImportStatus.completed;
  }

  // Persist final counters + errors onto the batch row.
  const updated = await prisma.dailyPlanImportBatch.update({
    where: { id: batch.id },
    data: {
      status,
      createdCount,
      skippedCount,
      errorCount,
      errors,
    },
  });

  // Return the refreshed plan for the same date/scope so the UI can re-render.
  const plan = await getDailyPlan(payload.hotelDate, locationFilter);

  return {
    batch: mapBatch(updated),
    plan,
  };
}
