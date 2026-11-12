/**
 * Bulk-import daily plan rows from an external source (e.g. clock/PMS export).
 * Idempotent on `(source, externalId)` when provided; respects location scope.
 */
import {
  // Carry this field through the payload or query.
  DailyPlanImportStatus,
  // Carry this field through the payload or query.
  DailyPlanSource,
  // Carry this field through the payload or query.
  LocationKind,
  // Carry this field through the payload or query.
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
  // Carry this field through the payload or query.
  isDailyPlanEntryDateLocCategoryConflict,
  // Field value required by this payload or query.
  isP2002,
// Execute: } from "./prismaConflicts";
} from "./prismaConflicts";
// Import ./queries for dailyPlan/import.ts.
import { getDailyPlan } from "./queries";
// Type-only import from ./types used by dailyPlan/import.ts.
import type { DailyPlanImportPayload, ImportError } from "./types";

/** Resolve a room by building code + number; flag out-of-scope vs missing. */
async function resolveRoomByBuildingAndNumber(
  // Carry this field through the payload or query.
  buildingCode: string,
  // Carry this field through the payload or query.
  roomNumber: string,
  // Parameter/field in the surrounding signature or type.
  locationFilter?: Prisma.LocationWhereInput,
// Execute: ): Promise<
): Promise<
  // Continue the previous expression with this clause.
  | { location: NonNullable<Awaited<ReturnType<typeof prisma.location.findFirst>>>; outOfScope: false }
  // Continue the previous expression with this clause.
  | { location: null; outOfScope: boolean }
// Begin block/object for the following statements.
> {
  // Look up the room by building code + room number (rooms only).
  const location = await prisma.location.findFirst({
    // Restrict the query to the relevant rows only.
    where: {
      // Carry this field through the payload or query.
      number: roomNumber,
      // Carry this field through the payload or query.
      kind: LocationKind.room,
      // Carry this field through the payload or query.
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
  // Carry this field through the payload or query.
  payload: DailyPlanImportPayload,
  // Carry this field through the payload or query.
  createdByEmployeeId: string,
  // Parameter/field in the surrounding signature or type.
  locationFilter?: Prisma.LocationWhereInput,
// Begin block/object for the following statements.
) {
  // Normalize YYYY-MM-DD into the Date used as DailyPlanEntry.hotelDate.
  const hotelDate = parseHotelDate(payload.hotelDate);
  // Empty label falls back to "clock" (legacy PMS/clock export naming).
  const sourceLabel = payload.sourceLabel.trim() || "clock";
  // Capture entries for subsequent checks or writes.
  const entries = payload.entries;

  // Create the batch up-front as failed; finalize status after the loop.
  const batch = await prisma.dailyPlanImportBatch.create({
    // Fields written by this create/update.
    data: {
      // Carry this field through the payload or query.
      hotelDate,
      // Carry this field through the payload or query.
      sourceLabel,
      // Carry this field through the payload or query.
      status: DailyPlanImportStatus.failed,
      // Carry this field through the payload or query.
      totalCount: entries.length,
      // Carry this field through the payload or query.
      createdByEmployeeId,
      // Carry this field through the payload or query.
      errors: [],
    },
  });

  // Capture createdCount for subsequent checks or writes.
  let createdCount = 0;
  // Capture skippedCount for subsequent checks or writes.
  let skippedCount = 0;
  // Capture errorCount for subsequent checks or writes.
  let errorCount = 0;
  // Execute: const errors: ImportError[] = [];
  const errors: ImportError[] = [];
  // Hotel-local "today" gates deferred departure room effects per row.
  const todayYmd = await todayHotelDateYmd();

  // Iterate items to apply the same rule to each.
  for (let index = 0; index < entries.length; index++) {
    // Capture item for subsequent checks or writes.
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
              // Carry this field through the payload or query.
              source: DailyPlanSource.import,
              // Carry this field through the payload or query.
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
        // Carry this field through the payload or query.
        locationFilter,
      );
      // Missing or out-of-scope → record error and continue the batch.
      if (!resolved.location) {
        // Execute: errorCount += 1;
        errorCount += 1;
        // Begin block/object for the following statements.
        errors.push({
          // Carry this field through the payload or query.
          index,
          // Carry this field through the payload or query.
          room: roomLabel,
          // Carry this field through the payload or query.
          reason: resolved.outOfScope
            // Continue the previous expression with this clause.
            ? "Outside your permitted data scope"
            // Continue the previous expression with this clause.
            : "Room not found",
        });
        // Execute: continue;
        continue;
      }
      // Capture location for subsequent checks or writes.
      const location = resolved.location;
      // Execute: resolvedLocationId = location.id;
      resolvedLocationId = location.id;
      // Archived rooms cannot receive new plan rows.
      if (location.catalogStatus !== "active") {
        // Execute: errorCount += 1;
        errorCount += 1;
        // Begin block/object for the following statements.
        errors.push({
          // Carry this field through the payload or query.
          index,
          // Carry this field through the payload or query.
          room: roomLabel,
          // Field value required by this payload or query.
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
            // Carry this field through the payload or query.
            hotelDate,
            // Carry this field through the payload or query.
            locationId: location.id,
            // Carry this field through the payload or query.
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
          // Carry this field through the payload or query.
          tx,
          // Carry this field through the payload or query.
          location,
          // Carry this field through the payload or query.
          hotelDate,
          // Execute: item.category,
          item.category,
          // Carry this field through the payload or query.
          undefined,
          // Carry this field through the payload or query.
          undefined,
          // Carry this field through the payload or query.
          todayYmd,
        );

        // Persist the imported plan row linked to this batch.
        await tx.dailyPlanEntry.create({
          // Fields written by this create/update.
          data: {
            // Carry this field through the payload or query.
            hotelDate,
            // Carry this field through the payload or query.
            locationId: location.id,
            // Carry this field through the payload or query.
            category: item.category,
            // Field value required by this payload or query.
            notes: item.notes ?? null,
            // Carry this field through the payload or query.
            source: DailyPlanSource.import,
            // Field value required by this payload or query.
            externalId: item.externalId ?? null,
            // Carry this field through the payload or query.
            importBatchId: batch.id,
            // Carry this field through the payload or query.
            cleaningTaskId: effects.cleaningTaskId,
            // Field value required by this payload or query.
            roomEffectsAppliedAt: effects.roomEffectsApplied ? new Date() : null,
            // Carry this field through the payload or query.
            createdByEmployeeId,
          },
        });
      });

      // Execute: createdCount += 1;
      createdCount += 1;
    // Begin block/object for the following statements.
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
              // Carry this field through the payload or query.
              hotelDate,
              // Carry this field through the payload or query.
              locationId: resolvedLocationId,
              // Carry this field through the payload or query.
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
      // Capture reason for subsequent checks or writes.
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
  // Begin block/object for the following statements.
  } else if (errorCount > 0) {
    // Execute: status = DailyPlanImportStatus.partial;
    status = DailyPlanImportStatus.partial;
  // Begin block/object for the following statements.
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
      // Carry this field through the payload or query.
      status,
      // Carry this field through the payload or query.
      createdCount,
      // Carry this field through the payload or query.
      skippedCount,
      // Carry this field through the payload or query.
      errorCount,
      // Carry this field through the payload or query.
      errors,
    },
  });

  // Return the refreshed plan for the same date/scope so the UI can re-render.
  const plan = await getDailyPlan(payload.hotelDate, locationFilter);

  // Return the computed result to the caller.
  return {
    // Carry this field through the payload or query.
    batch: mapBatch(updated),
    // Carry this field through the payload or query.
    plan,
  };
}
