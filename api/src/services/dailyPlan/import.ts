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
import { getDailyPlan } from "./queries";
import type { DailyPlanImportPayload, ImportError } from "./types";

async function resolveRoomByBuildingAndNumber(
  buildingCode: string,
  roomNumber: string,
  locationFilter?: Prisma.LocationWhereInput,
): Promise<
  | { location: NonNullable<Awaited<ReturnType<typeof prisma.location.findFirst>>>; outOfScope: false }
  | { location: null; outOfScope: boolean }
> {
  const location = await prisma.location.findFirst({
    where: {
      number: roomNumber,
      kind: LocationKind.room,
      floor: { building: { code: buildingCode } },
    },
  });
  if (!location) {
    return { location: null, outOfScope: false };
  }
  if (locationFilter && Object.keys(locationFilter).length > 0) {
    const inScope = await prisma.location.findFirst({
      where: { id: location.id, ...locationFilter },
      select: { id: true },
    });
    if (!inScope) {
      return { location: null, outOfScope: true };
    }
  }
  return { location, outOfScope: false };
}

export async function importDailyPlan(
  payload: DailyPlanImportPayload,
  createdByEmployeeId: string,
  locationFilter?: Prisma.LocationWhereInput,
) {
  const hotelDate = parseHotelDate(payload.hotelDate);
  const sourceLabel = payload.sourceLabel.trim() || "clock";
  const entries = payload.entries;

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
  const todayYmd = await todayHotelDateYmd();

  for (let index = 0; index < entries.length; index++) {
    const item = entries[index];
    const roomLabel = `${item.buildingCode} ${item.roomNumber}`;

    try {
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

      const resolved = await resolveRoomByBuildingAndNumber(
        item.buildingCode,
        item.roomNumber,
        locationFilter,
      );
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
      if (location.catalogStatus !== "active") {
        errorCount += 1;
        errors.push({
          index,
          room: roomLabel,
          reason: "Room is archived",
        });
        continue;
      }

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

      await prisma.$transaction(async (tx) => {
        const effects = await applyPlanEntryEffects(
          tx,
          location,
          hotelDate,
          item.category,
          undefined,
          undefined,
          todayYmd,
        );

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
      errorCount += 1;
      const reason =
        err instanceof Error ? err.message : "Unexpected import error";
      errors.push({ index, room: roomLabel, reason });
    }
  }

  let status: DailyPlanImportStatus;
  if (createdCount === 0 && errorCount > 0) {
    status = DailyPlanImportStatus.failed;
  } else if (errorCount > 0) {
    status = DailyPlanImportStatus.partial;
  } else {
    status = DailyPlanImportStatus.completed;
  }

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

  const plan = await getDailyPlan(payload.hotelDate, locationFilter);

  return {
    batch: mapBatch(updated),
    plan,
  };
}
