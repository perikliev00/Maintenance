/**
 * Bulk-import daily plan rows from an external source (e.g. clock/PMS export).
 * Idempotent on `(source, externalId)` when provided; respects location scope.
 */
import {
  DailyPlanImportStatus,
  DailyPlanSource,
  LocationKind,
  Prisma,
// Execute: } from "@prisma/client";
} from "@prisma/client";
// Import ../../db for dailyPlan/import.ts.
import { prisma } from "../../db";
// Import ../dailyPlanEffects for dailyPlan/import.ts.
import { applyPlanEntryEffects, parseHotelDate } from "../dailyPlanEffects";
// Import ../hotelTime for dailyPlan/import.ts.
import { todayHotelDateYmd } from "../hotelTime";
// Import ./format for dailyPlan/import.ts.
import { mapBatch } from "./format";
// Side-effect or default import required by this module.
import {
  isDailyPlanEntryDateLocCategoryConflict,
  isP2002,
// Execute: } from "./prismaConflicts";
} from "./prismaConflicts";
// Import ./queries for dailyPlan/import.ts.
import { getDailyPlan } from "./queries";
import type { DailyPlanImportPayload, ImportError } from "./types";

/** Resolve a room by building code + number; flag out-of-scope vs missing. */
async function resolveRoomByBuildingAndNumber(
  buildingCode: string,
  roomNumber: string,
  // Parameter/field in the surrounding signature or type.
  locationFilter?: Prisma.LocationWhereInput,
// Execute: ): Promise<
): Promise<
  // Continue the previous expression with this clause.
  | { location: NonNullable<Awaited<ReturnType<typeof prisma.location.findFirst>>>; outOfScope: false }
  // Continue the previous expression with this clause.
  | { location: null; outOfScope: boolean }
> {
  // Look up the room by building code + room number (rooms only).
  const location = await prisma.location.findFirst({
    // Restrict the query to the relevant rows only.
    where: {
      number: roomNumber,
      kind: LocationKind.room,
      floor: { building: { code: buildingCode } },
    },
  });
  // Unknown room — not an out-of-scope miss.
  if (!location) {
    // Early return of a terminal empty/boolean result.
    return { location: null, outOfScope: false };
  }
  // When the caller has a data-scope filter, re-check the room is inside it.
  if (locationFilter && Object.keys(locationFilter).length > 0) {
    // Load inScope needed for the next decision or write.
    const inScope = await prisma.location.findFirst({
      // Restrict the query to the relevant rows only.
      where: { id: location.id, ...locationFilter },
      // Project only the columns the caller needs.
      select: { id: true },
    });
    // Found globally but outside the caller's permitted locations.
    if (!inScope) {
      // Early return of a terminal empty/boolean result.
      return { location: null, outOfScope: true };
    }
  }
  // Early return of a terminal empty/boolean result.
  return { location, outOfScope: false };
}

/**
 * Import plan entries for one hotel date into a tracked batch.
 * Skips duplicates / out-of-scope rooms; records per-row errors on the batch.
 */
export async function importDailyPlan(
  payload: DailyPlanImportPayload,
  createdByEmployeeId: string,
  // Parameter/field in the surrounding signature or type.
  locationFilter?: Prisma.LocationWhereInput,
) {
  // Normalize YYYY-MM-DD into the Date used as DailyPlanEntry.hotelDate.
  const hotelDate = parseHotelDate(payload.hotelDate);
  // Empty label falls back to "clock" (legacy PMS/clock export naming).
  const sourceLabel = payload.sourceLabel.trim() || "clock";
  const entries = payload.entries;

  // Create the batch up-front as failed; finalize status after the loop.
  const batch = await prisma.dailyPlanImportBatch.create({
    // Fields written by this create/update.
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
  // Execute: const errors: ImportError[] = [];
  const errors: ImportError[] = [];
  // Hotel-local "today" gates deferred departure room effects per row.
  const todayYmd = await todayHotelDateYmd();

  // Iterate items to apply the same rule to each.
  for (let index = 0; index < entries.length; index++) {
    const item = entries[index];
    // Human-readable room label for per-row error reporting.
    const roomLabel = `${item.buildingCode} ${item.roomNumber}`;

    // Execute: let resolvedLocationId: string | null = null;
    let resolvedLocationId: string | null = null;
    // Isolate fallible work so conflicts can be mapped cleanly.
    try {
      // Idempotent skip when the same external id was already imported.
      if (item.externalId) {
        // Load byExternal needed for the next decision or write.
        const byExternal = await prisma.dailyPlanEntry.findUnique({
          // Restrict the query to the relevant rows only.
          where: {
            // Open nested structure for the next related fields.
            source_externalId: {
              source: DailyPlanSource.import,
              externalId: item.externalId,
            },
          },
        });
        // Branch when this condition holds for the domain rule.
        if (byExternal) {
          // Execute: skippedCount += 1;
          skippedCount += 1;
          // Execute: continue;
          continue;
        }
      }

      // Resolve building+number; distinguish missing vs out-of-scope.
      const resolved = await resolveRoomByBuildingAndNumber(
        // Execute: item.buildingCode,
        item.buildingCode,
        // Execute: item.roomNumber,
        item.roomNumber,
        locationFilter,
      );
      // Missing or out-of-scope → record error and continue the batch.
      if (!resolved.location) {
        // Execute: errorCount += 1;
        errorCount += 1;
        errors.push({
          index,
          room: roomLabel,
          reason: resolved.outOfScope
            // Continue the previous expression with this clause.
            ? "Outside your permitted data scope"
            // Continue the previous expression with this clause.
            : "Room not found",
        });
        // Execute: continue;
        continue;
      }
      const location = resolved.location;
      // Execute: resolvedLocationId = location.id;
      resolvedLocationId = location.id;
      // Archived rooms cannot receive new plan rows.
      if (location.catalogStatus !== "active") {
        // Execute: errorCount += 1;
        errorCount += 1;
        errors.push({
          index,
          room: roomLabel,
          reason: "Room is archived",
        });
        // Execute: continue;
        continue;
      }

      // Unique per (hotelDate, location, category) — skip if already present.
      const existing = await prisma.dailyPlanEntry.findUnique({
        // Restrict the query to the relevant rows only.
        where: {
          // Open nested structure for the next related fields.
          hotelDate_locationId_category: {
            hotelDate,
            locationId: location.id,
            category: item.category,
          },
        },
      });

      // Branch when this condition holds for the domain rule.
      if (existing) {
        // manual wins; existing import is idempotent skip
        skippedCount += 1;
        // Execute: continue;
        continue;
      }

      // Effects + entry insert must succeed together for this row.
      await prisma.$transaction(async (tx) => {
        // Category-specific occupancy/dirty/task side effects (no assignee on import).
        const effects = await applyPlanEntryEffects(
          tx,
          location,
          hotelDate,
          // Execute: item.category,
          item.category,
          undefined,
          undefined,
          todayYmd,
        );

        // Persist the imported plan row linked to this batch.
        await tx.dailyPlanEntry.create({
          // Fields written by this create/update.
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

      // Execute: createdCount += 1;
      createdCount += 1;
    } catch (err) {
      // Concurrent create won the (hotelDate, location, category) race:
      // treat like the pre-insert existing-row skip (not an error).
      if (isP2002(err) && isDailyPlanEntryDateLocCategoryConflict(err)) {
        // Execute: skippedCount += 1;
        skippedCount += 1;
        // Execute: continue;
        continue;
      }
      // Conflict/stale path: map domain race to a safe response.
      if (isP2002(err) && resolvedLocationId) {
        // Load raced needed for the next decision or write.
        const raced = await prisma.dailyPlanEntry.findUnique({
          // Restrict the query to the relevant rows only.
          where: {
            // Open nested structure for the next related fields.
            hotelDate_locationId_category: {
              hotelDate,
              locationId: resolvedLocationId,
              category: item.category,
            },
          },
          // Project only the columns the caller needs.
          select: { id: true },
        });
        // Branch when this condition holds for the domain rule.
        if (raced) {
          // Execute: skippedCount += 1;
          skippedCount += 1;
          // Execute: continue;
          continue;
        }
      }
      // Unexpected throws become per-row errors; the batch continues.
      errorCount += 1;
      const reason =
        // Execute: err instanceof Error ? err.message : "Unexpected import error";
        err instanceof Error ? err.message : "Unexpected import error";
      // Execute: errors.push({ index, room: roomLabel, reason });
      errors.push({ index, room: roomLabel, reason });
    }
  }

  // Derive batch status from created vs error counts.
  let status: DailyPlanImportStatus;
  // Branch when this condition holds for the domain rule.
  if (createdCount === 0 && errorCount > 0) {
    // Execute: status = DailyPlanImportStatus.failed;
    status = DailyPlanImportStatus.failed;
  } else if (errorCount > 0) {
    // Execute: status = DailyPlanImportStatus.partial;
    status = DailyPlanImportStatus.partial;
  } else {
    // Execute: status = DailyPlanImportStatus.completed;
    status = DailyPlanImportStatus.completed;
  }

  // Persist final counters + errors onto the batch row.
  const updated = await prisma.dailyPlanImportBatch.update({
    // Restrict the query to the relevant rows only.
    where: { id: batch.id },
    // Fields written by this create/update.
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
