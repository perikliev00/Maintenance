/**
 * Departure room-effect classification and batch apply/confirm for deferred
 * vacant+dirty when checkout day arrives or ops confirms ambiguous stays.
 */
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
 *
 * @returns `"apply"` vacant+dirty, `"protect"` stamp without vacating,
 *          or `"defer"` leave pending until ops confirms.
 */
export function classifyDepartureRoomEffects(input: {
  occupancy: Occupancy;
  planYmd: string;
  todayYmd: string;
  hasNewerStayEvidence: boolean;
  confirmed: boolean;
}): DepartureRoomEffectsDecision {
  // Vacant / unknown / OOO-style occupancy: safe to apply vacant+dirty immediately.
  if (input.occupancy !== Occupancy.occupied) {
    return "apply";
  }
  // Occupied after a later check-in audit event — do not vacate that newer stay.
  if (input.hasNewerStayEvidence) {
    return "protect";
  }
  // Past plan + still occupied without proof: do not auto-vacate; await confirm.
  if (input.planYmd < input.todayYmd) {
    // Ops explicitly confirmed these entry ids may be vacated despite occupancy.
    return input.confirmed ? "apply" : "defer";
  }
  // Same hotel day, current stay — apply even if room is still verified_clean.
  return "apply";
}

/**
 * Zeroed counters used when there is nothing to process (future date / empty set).
 */
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
  // Nothing to query — avoid an empty `IN ()` and return fast.
  if (locationIds.length === 0) {
    return new Set();
  }

  // Hotel timezone from operations settings (not server local time).
  const ops = await getOperations();
  // Evidence window starts at the beginning of the day *after* the plan day.
  const afterPlanDayStart = zonedDayStartUtc(
    addDaysYmd(planYmd, 1),
    ops.hotelTimezone,
  );
  // Only occupancy→occupied audit writes count as check-in proof.
  const reoccupyRows = await db.auditEvent.findMany({
    where: {
      locationId: { in: locationIds },
      action: "location.set_occupancy",
      occurredAt: { gte: afterPlanDayStart },
      after: { path: ["occupancy"], equals: Occupancy.occupied },
    },
    select: { locationId: true },
  });
  // Deduplicate location ids from the audit rows.
  const withEvidence = new Set<string>();
  for (const row of reoccupyRows) {
    // Guard: locationId is optional on AuditEvent.
    if (row.locationId) {
      withEvidence.add(row.locationId);
    }
  }
  return withEvidence;
}

/**
 * Apply deferred departure room effects for a YYYY-MM-DD hotel date.
 * Thin string wrapper over {@link ensureDepartureRoomEffects}.
 */
export async function applyDepartureRoomEffects(
  hotelDate: string,
  locationFilter?: Prisma.LocationWhereInput,
  options?: { confirmEntryIds?: string[] },
): Promise<DepartureRoomEffectsResult> {
  // Parse YMD into a Date at hotel-date midnight semantics used elsewhere.
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
  // Current hotel calendar day (YYYY-MM-DD) in the configured timezone.
  const todayYmd = await todayHotelDateYmd();
  // Normalize the requested plan day to the same YMD string form for compares.
  const planYmd = formatHotelDate(hotelDate);
  const empty = emptyDepartureRoomEffectsResult(planYmd);
  // Future departures must not vacate rooms early.
  if (planYmd > todayYmd) {
    return empty;
  }

  // Pending = departure rows that have never had room effects stamped.
  const pending = await prisma.dailyPlanEntry.findMany({
    where: {
      hotelDate,
      category: DailyPlanCategory.departure,
      roomEffectsAppliedAt: null,
      // Optional data-scope / sector filter from the caller.
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
  // Nothing left to apply for this day.
  if (pending.length === 0) {
    return empty;
  }

  // Unique locations for the evidence query (one room may appear once per category).
  const locationIds = [...new Set(pending.map((e) => e.locationId))];
  // Explicit confirm list from ops UI / API (ambiguous past occupied rooms).
  const confirmSet = new Set(options?.confirmEntryIds ?? []);
  // Locations that must be protected (newer stay proven via audit).
  const newerStayLocations = await locationsWithNewerStayEvidence(
    prisma,
    locationIds,
    planYmd,
  );

  // Single timestamp stamped onto all claimed rows in this run.
  const now = new Date();
  let applied = 0;
  let skipped = 0;
  const deferredEntryIds: string[] = [];

  // Atomic per-entry claim + room mutation so concurrent runs do not double-apply.
  await prisma.$transaction(async (tx) => {
    for (const entry of pending) {
      // Fresh occupancy/kind inside the transaction (may have changed since the list query).
      const location = await tx.location.findUniqueOrThrow({
        where: { id: entry.locationId },
        select: { occupancy: true, kind: true },
      });

      const hasNewerStayEvidence = newerStayLocations.has(entry.locationId);

      // Decide apply / protect / defer from occupancy + evidence + confirm flag.
      const decision = classifyDepartureRoomEffects({
        occupancy: location.occupancy,
        planYmd,
        todayYmd,
        hasNewerStayEvidence,
        confirmed: confirmSet.has(entry.id),
      });

      // Leave roomEffectsAppliedAt null so a later confirm can pick this entry up.
      if (decision === "defer") {
        deferredEntryIds.push(entry.id);
        continue;
      }

      // Optimistic claim: only one worker stamps roomEffectsAppliedAt.
      const claimed = await tx.dailyPlanEntry.updateMany({
        where: {
          id: entry.id,
          category: DailyPlanCategory.departure,
          roomEffectsAppliedAt: null,
        },
        data: { roomEffectsAppliedAt: now },
      });
      // Another concurrent run already claimed this entry — skip silently.
      if (claimed.count === 0) continue;

      // Newer stay: keep stamp (so we do not retry) but do not vacate/dirty.
      if (decision === "protect") {
        skipped += 1;
        continue;
      }

      // Apply vacant + dirty and rebind any active cleaning work to the new cycle.
      await bumpDirtyAndRebindWork(tx, entry.locationId, {
        occupancy: Occupancy.vacant,
      });

      // Ensure a departure cleaning task exists / is linked for housekeeping.
      const cleaningTaskId = await linkOrCreateDepartureTask(tx, {
        locationId: entry.locationId,
        locationKind: location.kind,
        hotelDate,
        assignedEmployeeId: entry.assignedEmployeeId ?? undefined,
        shiftId: entry.shiftId,
        existingCleaningTaskId: entry.cleaningTaskId,
      });
      // Persist newly created task id back onto the plan entry when it changed.
      if (cleaningTaskId && cleaningTaskId !== entry.cleaningTaskId) {
        await tx.dailyPlanEntry.update({
          where: { id: entry.id },
          data: { cleaningTaskId },
        });
      }

      applied += 1;
    }
  });

  // Aggregate counters for API / UI feedback (deferred ids listed for confirm UX).
  return {
    hotelDate: planYmd,
    applied,
    skipped,
    deferred: deferredEntryIds.length,
    deferredEntryIds,
    total: applied + skipped + deferredEntryIds.length,
  };
}
