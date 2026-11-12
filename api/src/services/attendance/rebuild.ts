/**
 * Rebuild attendance intervals from punch events, and flag stale open shifts.
 * Adjusted intervals are frozen (events in their time range are skipped);
 * pending/rejected adjustments are rematched onto rebuilt intervals by start event.
 */
// Pairing rules, hotel-date keys, and stale-open constants.
import {
  OPEN_MISSING_END_HOURS,
  addDaysYmd,
  asFlags,
  hotelDateKey,
  pairEventsToIntervalDrafts,
  uniqueFlags,
  // Type alias AnomalyFlag.
  type AnomalyFlag,
  // Type alias FrozenRange.
  type FrozenRange,
// Support the surrounding control flow.
} from "../attendanceRules";
// Module dependency import.
import {
  AttendanceAdjustmentStatus,
  AttendanceIntervalStatus,
  Prisma,
// Support the surrounding control flow.
} from "@prisma/client";
// Module dependency import.
import { prisma } from "../../db";
// Local-midnight bounds for punch fetch windows.
import type { Tx } from "../db/types";
// Runtime import from ../hotelTime.
import { formatHotelDate, zonedDayStartUtc } from "../hotelTime";

/** Open intervals older than OPEN_MISSING_END_HOURS become `missing_end` → `needs_review`. */

/** Minimal interval columns read before a stale-open claim attempt. */
type StaleIntervalRow = {
  // Field status on this type/payload.
  status: AttendanceIntervalStatus;
  // Time field endedAt.
  endedAt: Date | null;
  // Time field startedAt.
  startedAt: Date;
  // Time field anomalyFlags.
  anomalyFlags: unknown;
};

/**
 * DB surface needed to claim a single stale open interval.
 * Kept narrow so unit tests can fake only attendanceInterval accessors.
 */
export type StaleOpenClaimDb = {
  /** Interval table read/update used by claimStaleOpenInterval. */
  attendanceInterval: {
    /** Load current flags/status before conditional updateMany. */
    findUnique: (args: {
      // Filter matching rows.
      where: { id: string };
      // Select only needed columns.
      select: {
        // Field status on this type/payload.
        status: true;
        // Time field endedAt.
        endedAt: true;
        // Time field startedAt.
        startedAt: true;
        // Field anomalyFlags on this type/payload.
        anomalyFlags: true;
      };
    // Support the surrounding control flow.
    }) => Promise<StaleIntervalRow | null>;
    /** Conditional claim — returns count 0 when another worker won. */
    updateMany: (args: {
      // Filter matching rows.
      where: {
        // Field id on this type/payload.
        id: string;
        // Field status on this type/payload.
        status: typeof AttendanceIntervalStatus.open;
        // Time field endedAt.
        endedAt: null;
        // Time field startedAt.
        startedAt: { lte: Date };
      };
      // Mutation data payload.
      data: {
        // Field status on this type/payload.
        status: typeof AttendanceIntervalStatus.needs_review;
        // Field anomalyFlags on this type/payload.
        anomalyFlags: AnomalyFlag[];
      };
    // Support the surrounding control flow.
    }) => Promise<{ count: number }>;
  };
};

/**
 * Atomically flag one interval as `missing_end` / `needs_review` only if it is
 * still open, has no end, and started at or before `cutoff`. Re-reads flags so
 * a concurrent close/adjust cannot be overwritten with a stale snapshot.
 * @internal exported for unit tests with a fake DB
 */
export async function claimStaleOpenInterval(
  // Field `db`.
  db: StaleOpenClaimDb,
  // Param id required by this function.
  id: string,
  // Param cutoff required by this function.
  cutoff: Date,
): Promise<boolean> {
  // Fresh read so we merge flags from the current row, not a stale snapshot.
  const row = await db.attendanceInterval.findUnique({
    // Filter matching rows.
    where: { id },
    // Select only needed columns.
    select: {
      // Field status on this type/payload.
      status: true,
      // Time field endedAt.
      endedAt: true,
      // Time field startedAt.
      startedAt: true,
      // Field anomalyFlags on this type/payload.
      anomalyFlags: true,
    },
  });
  // Already closed/adjusted/too recent — nothing to claim.
  if (
    // Additional clause in this boolean decision.
    !row ||
    // Additional clause in this boolean decision.
    row.status !== AttendanceIntervalStatus.open ||
    // Additional clause in this boolean decision.
    row.endedAt !== null ||
    // Support the surrounding control flow.
    row.startedAt.getTime() > cutoff.getTime()
  ) {
    // Return result to caller.
    return false;
  }

  // Append missing_end without duplicating existing flags.
  const nextFlags = uniqueFlags([...asFlags(row.anomalyFlags), "missing_end"]);
  // Conditional update — only wins if still open/unended/old enough.
  const claimed = await db.attendanceInterval.updateMany({
    // Filter matching rows.
    where: {
      id,
      // Field status on this type/payload.
      status: AttendanceIntervalStatus.open,
      // Time field endedAt.
      endedAt: null,
      // Time field startedAt.
      startedAt: { lte: cutoff },
    },
    // Mutation data payload.
    data: {
      // Field status on this type/payload.
      status: AttendanceIntervalStatus.needs_review,
      // Field anomalyFlags on this type/payload.
      anomalyFlags: nextFlags,
    },
  });
  // true when this worker won the race.
  return claimed.count > 0;
}

/**
 * Persist `missing_end` / `needs_review` for open intervals that aged past
 * OPEN_MISSING_END_HOURS without a new ingest rebuild.
 */
export async function markStaleOpenIntervals(now = new Date()) {
  // Intervals that started at or before this instant are stale.
  const cutoff = new Date(
    // Support the surrounding control flow.
    now.getTime() - OPEN_MISSING_END_HOURS * 3600_000,
  );
  // Candidate open intervals past the missing-end window.
  const candidates = await prisma.attendanceInterval.findMany({
    // Filter matching rows.
    where: {
      // Param status required by this function.
      status: AttendanceIntervalStatus.open,
      // Param endedAt required by this function.
      endedAt: null,
      // Param startedAt required by this function.
      startedAt: { lte: cutoff },
    },
    // Select only needed columns.
    select: { id: true },
  });

  // Local binding for this step.
  let flagged = 0;
  // Claim each candidate individually to avoid stomping concurrent closes.
  for (const { id } of candidates) {
    // Guard / branch on preconditions.
    if (
      // Await async persistence or side effect.
      await claimStaleOpenInterval(
        // Support the surrounding control flow.
        prisma as unknown as StaleOpenClaimDb,
        id,
        cutoff,
      )
    ) {
      // Assign flagged +.
      flagged += 1;
    }
  }

  // Return result to caller.
  // scanned = candidates considered; flagged = successful claims.
  return { scanned: candidates.length, flagged };
}

/**
 * Rebuild intervals for the event's hotel day and the previous hotel day so
 * overnight clock-outs close the shift that started the day before.
 * Event fetch uses zoned local midnights; hotelDate column keys stay UTC YMD.
 */
export async function rebuildIntervalsForEmployee(
  // Param employeeId required by this function.
  employeeId: string,
  // Param hotelDate required by this function.
  hotelDate: Date,
  // Param timeZone required by this function.
  timeZone: string,
  // Param db required by this function.
  db: Tx | typeof prisma = prisma,
) {
  // Center day + previous day (overnight clock-outs).
  const centerYmd = formatHotelDate(hotelDate);
  // Local binding for this step.
  const prevYmd = addDaysYmd(centerYmd, -1);
  // Local binding for this step.
  const replaceYmds = [prevYmd, centerYmd];
  // hotelDate column keys (UTC midnight Dates) for the two replace days.
  const replaceKeys = replaceYmds.map(hotelDateKey);

  // Event window: prev local midnight → day after center (exclusive end).
  const from = zonedDayStartUtc(prevYmd, timeZone);
  // Local binding for this step.
  const to = zonedDayStartUtc(addDaysYmd(centerYmd, 2), timeZone);

  // Load punches, frozen adjusted intervals, and replaceable non-adjusted rows.
  // Fetch punches + frozen/replaceable intervals in parallel.
  const [events, frozen, replaceable] = await Promise.all([
    // Support the surrounding control flow.
    db.attendanceEvent.findMany({
      // Filter matching rows.
      where: {
        employeeId,
        // Inclusive start, exclusive end — hotel-local window.
        normalizedTime: { gte: from, lt: to },
      },
      // Stable ordering for deterministic pairing.
      orderBy: [
        // Support the surrounding control flow.
        { normalizedTime: "asc" },
        // Support the surrounding control flow.
        { createdAt: "asc" },
        // Support the surrounding control flow.
        { id: "asc" },
      ],
      // Select only needed columns.
      select: {
        // Field id on this type/payload.
        id: true,
        // Field kind on this type/payload.
        kind: true,
        // Field normalizedTime on this type/payload.
        normalizedTime: true,
        // Field clockSkewSeconds on this type/payload.
        clockSkewSeconds: true,
      },
    }),
    // Adjusted intervals are never deleted — they freeze event ranges.
    db.attendanceInterval.findMany({
      // Filter matching rows.
      where: {
        employeeId,
        // Time field hotelDate.
        hotelDate: { in: replaceKeys },
        // Field status on this type/payload.
        status: AttendanceIntervalStatus.adjusted,
      },
      // Select only needed columns.
      select: { id: true, startedAt: true, endedAt: true },
    }),
    // Non-adjusted intervals will be deleted and rebuilt from punches.
    db.attendanceInterval.findMany({
      // Filter matching rows.
      where: {
        employeeId,
        // Time field hotelDate.
        hotelDate: { in: replaceKeys },
        // Field status on this type/payload.
        status: { not: AttendanceIntervalStatus.adjusted },
      },
      // Include relations for labels/checks.
      include: {
        // Preserve pending requests and rejected history across rebuild.
        // Approved corrections live on frozen `adjusted` intervals above.
        adjustments: {
          // Filter matching rows.
          where: {
            // Field status on this type/payload.
            status: {
              // Field in on this type/payload.
              in: [
                // Support the surrounding control flow.
                AttendanceAdjustmentStatus.pending,
                // Support the surrounding control flow.
                AttendanceAdjustmentStatus.rejected,
              ],
            },
          },
        },
      },
    }),
  ]);

  // Delete replaceable intervals (and their adjustments) before recreating.
  // Re-check after the snapshot: a concurrent approve may have frozen a row that
  // was still replaceable when we read it. Never delete adjusted intervals or
  // their approved corrections from a stale id list.
  const replaceIds = replaceable.map((r) => r.id);
  // Local stillReplaceIds used below.
  let stillReplaceIds = replaceIds;
  // Local frozenRows used below.
  let frozenRows = frozen;
  // Threshold/size gate.
  if (replaceIds.length) {
    // Unpack parallel query results.
    const [stillReplaceable, newlyFrozen] = await Promise.all([
      // Support the surrounding control flow.
      db.attendanceInterval.findMany({
        // Filter matching rows.
        where: {
          // Field id on this type/payload.
          id: { in: replaceIds },
          // Field status on this type/payload.
          status: { not: AttendanceIntervalStatus.adjusted },
        },
        // Select only needed columns.
        select: { id: true },
      }),
      // Support the surrounding control flow.
      db.attendanceInterval.findMany({
        // Filter matching rows.
        where: {
          // Field id on this type/payload.
          id: { in: replaceIds },
          // Field status on this type/payload.
          status: AttendanceIntervalStatus.adjusted,
        },
        // Select only needed columns.
        select: { id: true, startedAt: true, endedAt: true },
      }),
    ]);
    // Assign stillReplaceIds.
    stillReplaceIds = stillReplaceable.map((r) => r.id);
    // Threshold/size gate.
    if (newlyFrozen.length) {
      // Assign frozenRows.
      frozenRows = [...frozen, ...newlyFrozen];
    }
  }

  // Threshold/size gate.
  if (stillReplaceIds.length) {
    // Pending/rejected history rides with replaceable intervals only.
    await db.attendanceAdjustment.deleteMany({
      // Filter matching rows.
      where: {
        // Field intervalId on this type/payload.
        intervalId: { in: stillReplaceIds },
        // Field status on this type/payload.
        status: {
          // Field in on this type/payload.
          in: [
            // Support the surrounding control flow.
            AttendanceAdjustmentStatus.pending,
            // Support the surrounding control flow.
            AttendanceAdjustmentStatus.rejected,
          ],
        },
      },
    });
    // Await side effect before continuing.
    await db.attendanceInterval.deleteMany({
      // Filter matching rows.
      where: {
        // Field id on this type/payload.
        id: { in: stillReplaceIds },
        // Field status on this type/payload.
        status: { not: AttendanceIntervalStatus.adjusted },
      },
    });
  }

  // Rematch only for intervals that were actually removed. A concurrent approve
  // can make a candidate survive the conditional delete above.
  const survived = stillReplaceIds.length
    // Support the surrounding control flow.
    ? await db.attendanceInterval.findMany({
        // Filter matching rows.
        where: { id: { in: stillReplaceIds } },
        // Select only needed columns.
        select: { id: true },
      })
    // Support the surrounding control flow.
    : [];
  // Set deletedReplaceSet for dedupe/membership.
  const deletedReplaceSet = new Set(stillReplaceIds);
  // Iterate items for aggregation or writes.
  for (const row of survived) deletedReplaceSet.delete(row.id);
  // Local adjustmentsToRematch used below.
  const adjustmentsToRematch = replaceable
    // Filter with predicate.
    .filter((iv) => deletedReplaceSet.has(iv.id))
    // Continue fluent chain.
    .flatMap((iv) =>
      // Support the surrounding control flow.
      iv.adjustments
        // Filter with predicate.
        .filter((a) => iv.startEventId)
        // Map elements to output shape.
        .map((a) => ({
          // Set startEventId.
          startEventId: iv.startEventId!,
          // Set requestedById.
          requestedById: a.requestedById,
          // Set reviewedById.
          reviewedById: a.reviewedById,
          // Set reason.
          reason: a.reason,
          // Set proposedStartedAt.
          proposedStartedAt: a.proposedStartedAt,
          // Set proposedEndedAt.
          proposedEndedAt: a.proposedEndedAt,
          // Set proposedBreakMinutes.
          proposedBreakMinutes: a.proposedBreakMinutes,
          // Set status.
          status: a.status,
          // Set createdAt.
          createdAt: a.createdAt,
          // Set reviewedAt.
          reviewedAt: a.reviewedAt,
        })),
    );

  // Reload adjusted rows immediately before pairing so an approve that landed
  // after the re-check still freezes punches (no duplicate rebuilt interval).
  const frozenForPairing =
    // Support the surrounding control flow.
    replaceIds.length || frozenRows.length
      // Support the surrounding control flow.
      ? await db.attendanceInterval.findMany({
          // Filter matching rows.
          where: {
            employeeId,
            // Time field hotelDate.
            hotelDate: { in: replaceKeys },
            // Field status on this type/payload.
            status: AttendanceIntervalStatus.adjusted,
          },
          // Select only needed columns.
          select: { id: true, startedAt: true, endedAt: true },
        })
      // Support the surrounding control flow.
      : frozenRows;

  // Still-open adjusted rows get a 36h synthetic end so events inside stay frozen.
  // Convert adjusted intervals into ms ranges skipped by pairing.
  const frozenRanges: FrozenRange[] = frozenForPairing.map((f) => ({
    // Set startMs.
    startMs: f.startedAt.getTime(),
    // Open adjusted rows use synthetic 36h end so in-range punches stay frozen.
    endMs: (f.endedAt ?? new Date(f.startedAt.getTime() + 36 * 3600_000)).getTime(),
  }));

  // Pair punches into drafts; keep only the two replace hotel days.
  // Pair punches into draft intervals, respecting frozen adjusted ranges.
  const drafts = pairEventsToIntervalDrafts({
    events,
    // Set frozen.
    frozen: frozenRanges,
    timeZone,
  // Support the surrounding control flow.
  }).filter((d) => {
    // Local binding for this step.
    const ymd = formatHotelDate(d.hotelDate);
    // Return result to caller.
    return replaceYmds.includes(ymd);
  });

  // Create intervals and index by startEventId for adjustment rematch.
  const createdByStart = new Map<string, string>();
  // Iterate for side effects.
  for (const draft of drafts) {
    // Await async query or service call.
    const created = await db.attendanceInterval.create({
      // Mutation data payload.
      data: {
        employeeId,
        // Time field hotelDate.
        hotelDate: draft.hotelDate,
        // Time field startedAt.
        startedAt: draft.startedAt,
        // Time field endedAt.
        endedAt: draft.endedAt,
        // Link back to punch rows for adjustment rematch.
        startEventId: draft.startEventId,
        // Field endEventId on this type/payload.
        endEventId: draft.endEventId,
        // Field breakMinutes on this type/payload.
        breakMinutes: draft.breakMinutes,
        // Field workedMinutes on this type/payload.
        workedMinutes: draft.workedMinutes,
        // Field anomalyFlags on this type/payload.
        anomalyFlags: draft.anomalyFlags,
        // Field status on this type/payload.
        status: draft.status,
      },
    });
    // Guard / branch on preconditions.
    if (draft.startEventId) {
      // Support the surrounding control flow.
      createdByStart.set(draft.startEventId, created.id);
    }
  }

  // Re-attach pending/rejected adjustments onto the new interval with same start.
  for (const adj of adjustmentsToRematch) {
    // Local binding for this step.
    const intervalId = createdByStart.get(adj.startEventId);
    // Start event no longer produced an interval — drop the orphaned rematch.
    if (!intervalId) continue;
    // Await async persistence or side effect.
    await db.attendanceAdjustment.create({
      // Mutation data payload.
      data: {
        intervalId,
        // Field requestedById on this type/payload.
        requestedById: adj.requestedById,
        // Field reviewedById on this type/payload.
        reviewedById: adj.reviewedById,
        // Field reason on this type/payload.
        reason: adj.reason,
        // Time field proposedStartedAt.
        proposedStartedAt: adj.proposedStartedAt,
        // Time field proposedEndedAt.
        proposedEndedAt: adj.proposedEndedAt,
        // Field proposedBreakMinutes on this type/payload.
        proposedBreakMinutes: adj.proposedBreakMinutes,
        // Field status on this type/payload.
        status: adj.status,
        // Time field createdAt.
        createdAt: adj.createdAt,
        // Time field reviewedAt.
        reviewedAt: adj.reviewedAt,
      },
    });
    // Pending adjustments keep the interval in needs_review.
    if (adj.status === AttendanceAdjustmentStatus.pending) {
      // Await async persistence or side effect.
      await db.attendanceInterval.update({
        // Filter matching rows.
        where: { id: intervalId },
        // Mutation data payload.
        data: {
          // Field status on this type/payload.
          status: AttendanceIntervalStatus.needs_review,
        },
      });
    }
  }
}
