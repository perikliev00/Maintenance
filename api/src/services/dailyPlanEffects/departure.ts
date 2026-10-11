import { DailyPlanCategory, Occupancy, Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { bumpDirtyAndRebindWork } from "../cleaning";
import { todayHotelDateYmd, zonedDayStartUtc } from "../hotelTime";
import { getOperations } from "../settings";
import { addDaysYmd, formatHotelDate, parseHotelDate } from "./hotelDate";
import { linkOrCreateDepartureTask } from "./tasks";
import type {
  DepartureRoomEffectsDecision,
  DepartureRoomEffectsResult,
  Tx,
} from "./types";

/**
 * Classify deferred departure room effects without using cleaningStatus.
 * Cleaning alone does not prove a newer stay (check-in keeps verified_clean).
 */
export function classifyDepartureRoomEffects(input: {
  occupancy: Occupancy;
  planYmd: string;
  todayYmd: string;
  hasNewerStayEvidence: boolean;
  confirmed: boolean;
}): DepartureRoomEffectsDecision {
  if (input.occupancy !== Occupancy.occupied) {
    return "apply";
  }
  if (input.hasNewerStayEvidence) {
    return "protect";
  }
  // Past plan + occupied without proof: do not auto-vacate; await confirm.
  if (input.planYmd < input.todayYmd) {
    return input.confirmed ? "apply" : "defer";
  }
  // Same hotel day, current stay — apply even if room is still verified_clean.
  return "apply";
}

function emptyDepartureRoomEffectsResult(
  planYmd: string,
): DepartureRoomEffectsResult {
  return {
    hotelDate: planYmd,
    applied: 0,
    skipped: 0,
    deferred: 0,
    deferredEntryIds: [],
    total: 0,
  };
}

/**
 * Locations with proof of a newer stay after a departure plan day:
 * occupancy set to occupied after that hotel day (hotel timezone).
 * Planned arrivals are not evidence — they do not prove check-in.
 * Cleaning status alone is not evidence.
 */
export async function locationsWithNewerStayEvidence(
  db: Tx | typeof prisma,
  locationIds: string[],
  planYmd: string,
): Promise<Set<string>> {
  if (locationIds.length === 0) {
    return new Set();
  }

  const ops = await getOperations();
  const afterPlanDayStart = zonedDayStartUtc(
    addDaysYmd(planYmd, 1),
    ops.hotelTimezone,
  );
  const reoccupyRows = await db.auditEvent.findMany({
    where: {
      locationId: { in: locationIds },
      action: "location.set_occupancy",
      occurredAt: { gte: afterPlanDayStart },
      after: { path: ["occupancy"], equals: Occupancy.occupied },
    },
    select: { locationId: true },
  });
  const withEvidence = new Set<string>();
  for (const row of reoccupyRows) {
    if (row.locationId) {
      withEvidence.add(row.locationId);
    }
  }
  return withEvidence;
}

/** Apply deferred departure room effects for a YYYY-MM-DD hotel date. */
export async function applyDepartureRoomEffects(
  hotelDate: string,
  locationFilter?: Prisma.LocationWhereInput,
  options?: { confirmEntryIds?: string[] },
): Promise<DepartureRoomEffectsResult> {
  return ensureDepartureRoomEffects(
    parseHotelDate(hotelDate),
    locationFilter,
    options,
  );
}

/**
 * Apply deferred vacant+dirty for departure plan entries once their hotelDate
 * has arrived (or is in the past). No-op for future hotel dates.
 * Scoped by locationFilter when provided. Protects rooms with a proven newer
 * stay; defers ambiguous past occupied rooms until confirmEntryIds.
 */
export async function ensureDepartureRoomEffects(
  hotelDate: Date,
  locationFilter?: Prisma.LocationWhereInput,
  options?: { confirmEntryIds?: string[] },
): Promise<DepartureRoomEffectsResult> {
  const todayYmd = await todayHotelDateYmd();
  const planYmd = formatHotelDate(hotelDate);
  const empty = emptyDepartureRoomEffectsResult(planYmd);
  if (planYmd > todayYmd) {
    return empty;
  }

  const pending = await prisma.dailyPlanEntry.findMany({
    where: {
      hotelDate,
      category: DailyPlanCategory.departure,
      roomEffectsAppliedAt: null,
      ...(locationFilter ? { location: locationFilter } : {}),
    },
    select: {
      id: true,
      locationId: true,
      assignedEmployeeId: true,
      shiftId: true,
      cleaningTaskId: true,
    },
  });
  if (pending.length === 0) {
    return empty;
  }

  const locationIds = [...new Set(pending.map((e) => e.locationId))];
  const confirmSet = new Set(options?.confirmEntryIds ?? []);
  const newerStayLocations = await locationsWithNewerStayEvidence(
    prisma,
    locationIds,
    planYmd,
  );

  const now = new Date();
  let applied = 0;
  let skipped = 0;
  const deferredEntryIds: string[] = [];

  await prisma.$transaction(async (tx) => {
    for (const entry of pending) {
      const location = await tx.location.findUniqueOrThrow({
        where: { id: entry.locationId },
        select: { occupancy: true, kind: true },
      });

      const hasNewerStayEvidence = newerStayLocations.has(entry.locationId);

      const decision = classifyDepartureRoomEffects({
        occupancy: location.occupancy,
        planYmd,
        todayYmd,
        hasNewerStayEvidence,
        confirmed: confirmSet.has(entry.id),
      });

      if (decision === "defer") {
        deferredEntryIds.push(entry.id);
        continue;
      }

      const claimed = await tx.dailyPlanEntry.updateMany({
        where: {
          id: entry.id,
          category: DailyPlanCategory.departure,
          roomEffectsAppliedAt: null,
        },
        data: { roomEffectsAppliedAt: now },
      });
      if (claimed.count === 0) continue;

      if (decision === "protect") {
        skipped += 1;
        continue;
      }

      await bumpDirtyAndRebindWork(tx, entry.locationId, {
        occupancy: Occupancy.vacant,
      });

      const cleaningTaskId = await linkOrCreateDepartureTask(tx, {
        locationId: entry.locationId,
        locationKind: location.kind,
        hotelDate,
        assignedEmployeeId: entry.assignedEmployeeId ?? undefined,
        shiftId: entry.shiftId,
        existingCleaningTaskId: entry.cleaningTaskId,
      });
      if (cleaningTaskId && cleaningTaskId !== entry.cleaningTaskId) {
        await tx.dailyPlanEntry.update({
          where: { id: entry.id },
          data: { cleaningTaskId },
        });
      }

      applied += 1;
    }
  });

  return {
    hotelDate: planYmd,
    applied,
    skipped,
    deferred: deferredEntryIds.length,
    deferredEntryIds,
    total: applied + skipped + deferredEntryIds.length,
  };
}
