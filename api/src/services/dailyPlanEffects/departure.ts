/**
 * Departure room-effect classification and batch apply/confirm for deferred
 * vacant+dirty when checkout day arrives or ops confirms ambiguous stays.
 */
import { DailyPlanCategory, Occupancy, Prisma } from "@prisma/client";
// Import ../../db for dailyPlanEffects/departure.ts.
import { prisma } from "../../db";
// Side-effect or default import required by this module.
import {
  // Carry this field through the payload or query.
  bumpDirtyAndRebindWork,
  // Carry this field through the payload or query.
  lockRebindableTasksAndLocation,
// Execute: } from "../cleaning";
} from "../cleaning";
// Import ../hotelTime for dailyPlanEffects/departure.ts.
import { todayHotelDateYmd, zonedDayStartUtc } from "../hotelTime";
// Import ../settings for dailyPlanEffects/departure.ts.
import { getOperations } from "../settings";
// Import ./hotelDate for dailyPlanEffects/departure.ts.
import { addDaysYmd, formatHotelDate, parseHotelDate } from "./hotelDate";
// Import ./tasks for dailyPlanEffects/departure.ts.
import { linkOrCreateDepartureTask } from "./tasks";
// Type-only import from module used by dailyPlanEffects/departure.ts.
import type {
  // Carry this field through the payload or query.
  DepartureRoomEffectsDecision,
  // Carry this field through the payload or query.
  DepartureRoomEffectsResult,
  // Carry this field through the payload or query.
  Tx,
// Execute: } from "./types";
} from "./types";

/**
 * Classify deferred departure room effects without using cleaningStatus.
 * Cleaning alone does not prove a newer stay (check-in keeps verified_clean).
 *
 * @returns `"apply"` vacant+dirty, `"protect"` stamp without vacating,
 *          or `"defer"` leave pending until ops confirms.
 */
export function classifyDepartureRoomEffects(input: {
  // Carry this field through the payload or query.
  occupancy: Occupancy;
  // Carry this field through the payload or query.
  planYmd: string;
  // Carry this field through the payload or query.
  todayYmd: string;
  // Carry this field through the payload or query.
  hasNewerStayEvidence: boolean;
  // Carry this field through the payload or query.
  confirmed: boolean;
// Begin block/object for the following statements.
}): DepartureRoomEffectsDecision {
  // Vacant / unknown / OOO-style occupancy: safe to apply vacant+dirty immediately.
  if (input.occupancy !== Occupancy.occupied) {
    // Return the computed result to the caller.
    return "apply";
  }
  // Occupied after a later check-in audit event — do not vacate that newer stay.
  if (input.hasNewerStayEvidence) {
    // Return the computed result to the caller.
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
  // Carry this field through the payload or query.
  planYmd: string,
// Begin block/object for the following statements.
): DepartureRoomEffectsResult {
  // Return the computed result to the caller.
  return {
    // Carry this field through the payload or query.
    hotelDate: planYmd,
    // Field value required by this payload or query.
    applied: 0,
    // Field value required by this payload or query.
    skipped: 0,
    // Field value required by this payload or query.
    deferred: 0,
    // Carry this field through the payload or query.
    deferredEntryIds: [],
    // Field value required by this payload or query.
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
  // Carry this field through the payload or query.
  db: Tx | typeof prisma,
  // Carry this field through the payload or query.
  locationIds: string[],
  // Carry this field through the payload or query.
  planYmd: string,
// Begin block/object for the following statements.
): Promise<Set<string>> {
  // Nothing to query — avoid an empty `IN ()` and return fast.
  if (locationIds.length === 0) {
    // Return the computed result to the caller.
    return new Set();
  }

  // Hotel timezone from operations settings (not server local time).
  const ops = await getOperations();
  // Evidence window starts at the beginning of the day *after* the plan day.
  const afterPlanDayStart = zonedDayStartUtc(
    // Execute: addDaysYmd(planYmd, 1),
    addDaysYmd(planYmd, 1),
    // Execute: ops.hotelTimezone,
    ops.hotelTimezone,
  );
  // Only occupancy→occupied audit writes count as check-in proof.
  const reoccupyRows = await db.auditEvent.findMany({
    // Restrict the query to the relevant rows only.
    where: {
      // Carry this field through the payload or query.
      locationId: { in: locationIds },
      // Field value required by this payload or query.
      action: "location.set_occupancy",
      // Carry this field through the payload or query.
      occurredAt: { gte: afterPlanDayStart },
      // Field value required by this payload or query.
      after: { path: ["occupancy"], equals: Occupancy.occupied },
    },
    // Project only the columns the caller needs.
    select: { locationId: true },
  });
  // Deduplicate location ids from the audit rows.
  const withEvidence = new Set<string>();
  // Iterate items to apply the same rule to each.
  for (const row of reoccupyRows) {
    // Guard: locationId is optional on AuditEvent.
    if (row.locationId) {
      // Execute: withEvidence.add(row.locationId);
      withEvidence.add(row.locationId);
    }
  }
  // Return the computed result to the caller.
  return withEvidence;
}

/**
 * Apply deferred departure room effects for a YYYY-MM-DD hotel date.
 * Thin string wrapper over {@link ensureDepartureRoomEffects}.
 */
export async function applyDepartureRoomEffects(
  // Carry this field through the payload or query.
  hotelDate: string,
  // Parameter/field in the surrounding signature or type.
  locationFilter?: Prisma.LocationWhereInput,
  // Parameter/field in the surrounding signature or type.
  options?: { confirmEntryIds?: string[] },
// Begin block/object for the following statements.
): Promise<DepartureRoomEffectsResult> {
  // Parse YMD into a Date at hotel-date midnight semantics used elsewhere.
  return ensureDepartureRoomEffects(
    // Execute: parseHotelDate(hotelDate),
    parseHotelDate(hotelDate),
    // Carry this field through the payload or query.
    locationFilter,
    // Carry this field through the payload or query.
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
  // Carry this field through the payload or query.
  hotelDate: Date,
  // Parameter/field in the surrounding signature or type.
  locationFilter?: Prisma.LocationWhereInput,
  // Parameter/field in the surrounding signature or type.
  options?: { confirmEntryIds?: string[] },
// Begin block/object for the following statements.
): Promise<DepartureRoomEffectsResult> {
  // Current hotel calendar day (YYYY-MM-DD) in the configured timezone.
  const todayYmd = await todayHotelDateYmd();
  // Normalize the requested plan day to the same YMD string form for compares.
  const planYmd = formatHotelDate(hotelDate);
  // Capture empty for subsequent checks or writes.
  const empty = emptyDepartureRoomEffectsResult(planYmd);
  // Future departures must not vacate rooms early.
  if (planYmd > todayYmd) {
    // Return the computed result to the caller.
    return empty;
  }

  // Pending = departure rows that have never had room effects stamped.
  const pending = await prisma.dailyPlanEntry.findMany({
    // Restrict the query to the relevant rows only.
    where: {
      // Carry this field through the payload or query.
      hotelDate,
      // Carry this field through the payload or query.
      category: DailyPlanCategory.departure,
      // Field value required by this payload or query.
      roomEffectsAppliedAt: null,
      // Optional data-scope / sector filter from the caller.
      ...(locationFilter ? { location: locationFilter } : {}),
    },
    // Project only the columns the caller needs.
    select: {
      // Field value required by this payload or query.
      id: true,
      // Field value required by this payload or query.
      locationId: true,
      // Field value required by this payload or query.
      assignedEmployeeId: true,
      // Field value required by this payload or query.
      shiftId: true,
      // Field value required by this payload or query.
      cleaningTaskId: true,
    },
  });
  // Nothing left to apply for this day.
  if (pending.length === 0) {
    // Return the computed result to the caller.
    return empty;
  }

  // Explicit confirm list from ops UI / API (ambiguous past occupied rooms).
  const confirmSet = new Set(options?.confirmEntryIds ?? []);

  // Single timestamp stamped onto all claimed rows in this run.
  const now = new Date();
  // Capture applied for subsequent checks or writes.
  let applied = 0;
  // Capture skipped for subsequent checks or writes.
  let skipped = 0;
  // Execute: const deferredEntryIds: string[] = [];
  const deferredEntryIds: string[] = [];

  // Atomic per-entry claim + room mutation so concurrent runs do not double-apply.
  // Occupancy + newer-stay evidence are read only after task→location locks so a
  // concurrent check-in that already committed is visible before apply/protect.
  await prisma.$transaction(async (tx) => {
    // Iterate items to apply the same rule to each.
    for (const entry of pending) {
      // Await side effect or helper before continuing.
      await lockRebindableTasksAndLocation(tx, entry.locationId);

      // Fresh occupancy/kind under the location lock.
      const location = await tx.location.findUniqueOrThrow({
        // Restrict the query to the relevant rows only.
        where: { id: entry.locationId },
        // Project only the columns the caller needs.
        select: { occupancy: true, kind: true },
      });
      // Load newerStayLocations needed for the next decision or write.
      const newerStayLocations = await locationsWithNewerStayEvidence(
        // Carry this field through the payload or query.
        tx,
        // Execute: [entry.locationId],
        [entry.locationId],
        // Carry this field through the payload or query.
        planYmd,
      );
      // Capture hasNewerStayEvidence for subsequent checks or writes.
      const hasNewerStayEvidence = newerStayLocations.has(entry.locationId);

      // Decide apply / protect / defer from occupancy + evidence + confirm flag.
      const decision = classifyDepartureRoomEffects({
        // Carry this field through the payload or query.
        occupancy: location.occupancy,
        // Carry this field through the payload or query.
        planYmd,
        // Carry this field through the payload or query.
        todayYmd,
        // Carry this field through the payload or query.
        hasNewerStayEvidence,
        // Carry this field through the payload or query.
        confirmed: confirmSet.has(entry.id),
      });

      // Leave roomEffectsAppliedAt null so a later confirm can pick this entry up.
      if (decision === "defer") {
        // Execute: deferredEntryIds.push(entry.id);
        deferredEntryIds.push(entry.id);
        // Execute: continue;
        continue;
      }

      // Optimistic claim: only one worker stamps roomEffectsAppliedAt.
      const claimed = await tx.dailyPlanEntry.updateMany({
        // Restrict the query to the relevant rows only.
        where: {
          // Carry this field through the payload or query.
          id: entry.id,
          // Carry this field through the payload or query.
          category: DailyPlanCategory.departure,
          // Field value required by this payload or query.
          roomEffectsAppliedAt: null,
        },
        // Fields written by this create/update.
        data: { roomEffectsAppliedAt: now },
      });
      // Another concurrent run already claimed this entry — skip silently.
      if (claimed.count === 0) continue;

      // Newer stay: keep stamp (so we do not retry) but do not vacate/dirty.
      if (decision === "protect") {
        // Execute: skipped += 1;
        skipped += 1;
        // Execute: continue;
        continue;
      }

      // Apply vacant + dirty; locks already held for this location.
      await bumpDirtyAndRebindWork(
        // Carry this field through the payload or query.
        tx,
        // Execute: entry.locationId,
        entry.locationId,
        // Execute: { occupancy: Occupancy.vacant },
        { occupancy: Occupancy.vacant },
        // Execute: { alreadyLocked: true },
        { alreadyLocked: true },
      );

      // Ensure a departure cleaning task exists / is linked for housekeeping.
      const cleaningTaskId = await linkOrCreateDepartureTask(tx, {
        // Carry this field through the payload or query.
        locationId: entry.locationId,
        // Carry this field through the payload or query.
        locationKind: location.kind,
        // Carry this field through the payload or query.
        hotelDate,
        // Carry this field through the payload or query.
        assignedEmployeeId: entry.assignedEmployeeId ?? undefined,
        // Carry this field through the payload or query.
        shiftId: entry.shiftId,
        // Carry this field through the payload or query.
        existingCleaningTaskId: entry.cleaningTaskId,
      });
      // Persist newly created task id back onto the plan entry when it changed.
      if (cleaningTaskId && cleaningTaskId !== entry.cleaningTaskId) {
        // Persist the mutation inside the current transaction/context.
        await tx.dailyPlanEntry.update({
          // Restrict the query to the relevant rows only.
          where: { id: entry.id },
          // Fields written by this create/update.
          data: { cleaningTaskId },
        });
      }

      // Execute: applied += 1;
      applied += 1;
    }
  });

  // Aggregate counters for API / UI feedback (deferred ids listed for confirm UX).
  return {
    // Carry this field through the payload or query.
    hotelDate: planYmd,
    // Carry this field through the payload or query.
    applied,
    // Carry this field through the payload or query.
    skipped,
    // Carry this field through the payload or query.
    deferred: deferredEntryIds.length,
    // Carry this field through the payload or query.
    deferredEntryIds,
    // Carry this field through the payload or query.
    total: applied + skipped + deferredEntryIds.length,
  };
}
