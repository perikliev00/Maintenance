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
  type AnomalyFlag,
  type FrozenRange,
} from "../attendanceRules";
// Module dependency import.
import {
  AttendanceAdjustmentStatus,
  AttendanceIntervalStatus,
  Prisma,
} from "@prisma/client";
// Module dependency import.
import { prisma } from "../../db";
// Local-midnight bounds for punch fetch windows.
import type { Tx } from "../db/types";
import { formatHotelDate, zonedDayStartUtc } from "../hotelTime";

/** Open intervals older than OPEN_MISSING_END_HOURS become `missing_end` → `needs_review`. */

/** Minimal interval columns read before a stale-open claim attempt. */
type StaleIntervalRow = {
  status: AttendanceIntervalStatus;
  endedAt: Date | null;
  startedAt: Date;
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
      where: { id: string };
      select: {
        status: true;
        endedAt: true;
        startedAt: true;
        anomalyFlags: true;
      };
    }) => Promise<StaleIntervalRow | null>;
    /** Conditional claim — returns count 0 when another worker won. */
    updateMany: (args: {
      where: {
        id: string;
        status: typeof AttendanceIntervalStatus.open;
        endedAt: null;
        startedAt: { lte: Date };
      };
      data: {
        status: typeof AttendanceIntervalStatus.needs_review;
        anomalyFlags: AnomalyFlag[];
      };
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
  id: string,
  cutoff: Date,
): Promise<boolean> {
  // Fresh read so we merge flags from the current row, not a stale snapshot.
  const row = await db.attendanceInterval.findUnique({
    where: { id },
    select: {
      status: true,
      endedAt: true,
      startedAt: true,
      anomalyFlags: true,
    },
  });
  // Already closed/adjusted/too recent — nothing to claim.
  if (
    !row ||
    row.status !== AttendanceIntervalStatus.open ||
    row.endedAt !== null ||
    row.startedAt.getTime() > cutoff.getTime()
  ) {
    // Return result to caller.
    return false;
  }

  // Append missing_end without duplicating existing flags.
  const nextFlags = uniqueFlags([...asFlags(row.anomalyFlags), "missing_end"]);
  // Conditional update — only wins if still open/unended/old enough.
  const claimed = await db.attendanceInterval.updateMany({
    where: {
      id,
      status: AttendanceIntervalStatus.open,
      endedAt: null,
      startedAt: { lte: cutoff },
    },
    data: {
      status: AttendanceIntervalStatus.needs_review,
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
    now.getTime() - OPEN_MISSING_END_HOURS * 3600_000,
  );
  // Candidate open intervals past the missing-end window.
  const candidates = await prisma.attendanceInterval.findMany({
    where: {
      status: AttendanceIntervalStatus.open,
      endedAt: null,
      startedAt: { lte: cutoff },
    },
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
        prisma as unknown as StaleOpenClaimDb,
        id,
        cutoff,
      )
    ) {
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
  employeeId: string,
  hotelDate: Date,
  timeZone: string,
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
    db.attendanceEvent.findMany({
      where: {
        employeeId,
        // Inclusive start, exclusive end — hotel-local window.
        normalizedTime: { gte: from, lt: to },
      },
      // Stable ordering for deterministic pairing.
      orderBy: [
        { normalizedTime: "asc" },
        { createdAt: "asc" },
        { id: "asc" },
      ],
      select: {
        id: true,
        kind: true,
        normalizedTime: true,
        clockSkewSeconds: true,
      },
    }),
    // Adjusted intervals are never deleted — they freeze event ranges.
    db.attendanceInterval.findMany({
      where: {
        employeeId,
        hotelDate: { in: replaceKeys },
        status: AttendanceIntervalStatus.adjusted,
      },
      select: { id: true, startedAt: true, endedAt: true },
    }),
    // Non-adjusted intervals will be deleted and rebuilt from punches.
    db.attendanceInterval.findMany({
      where: {
        employeeId,
        hotelDate: { in: replaceKeys },
        status: { not: AttendanceIntervalStatus.adjusted },
      },
      include: {
        // Preserve pending requests and rejected history across rebuild.
        // Approved corrections live on frozen `adjusted` intervals above.
        adjustments: {
          where: {
            status: {
              in: [
                AttendanceAdjustmentStatus.pending,
                AttendanceAdjustmentStatus.rejected,
              ],
            },
          },
        },
      },
    }),
  ]);

  // Snapshot adjustments to rematch onto new intervals by startEventId.
  const adjustmentsToRematch = replaceable.flatMap((iv) =>
    iv.adjustments
      .filter((a) => iv.startEventId)
      .map((a) => ({
        startEventId: iv.startEventId!,
        requestedById: a.requestedById,
        reviewedById: a.reviewedById,
        reason: a.reason,
        proposedStartedAt: a.proposedStartedAt,
        proposedEndedAt: a.proposedEndedAt,
        proposedBreakMinutes: a.proposedBreakMinutes,
        status: a.status,
        createdAt: a.createdAt,
        reviewedAt: a.reviewedAt,
      })),
  );

  // Delete replaceable intervals (and their adjustments) before recreating.
  const replaceIds = replaceable.map((r) => r.id);
  // Guard / branch on preconditions.
  if (replaceIds.length) {
    // Await async persistence or side effect.
    await db.attendanceAdjustment.deleteMany({
      where: { intervalId: { in: replaceIds } },
    });
    // Await async persistence or side effect.
    await db.attendanceInterval.deleteMany({
      where: { id: { in: replaceIds } },
    });
  }

  // Still-open adjusted rows get a 36h synthetic end so events inside stay frozen.
  // Convert adjusted intervals into ms ranges skipped by pairing.
  const frozenRanges: FrozenRange[] = frozen.map((f) => ({
    startMs: f.startedAt.getTime(),
    // Open adjusted rows use synthetic 36h end so in-range punches stay frozen.
    endMs: (f.endedAt ?? new Date(f.startedAt.getTime() + 36 * 3600_000)).getTime(),
  }));

  // Pair punches into drafts; keep only the two replace hotel days.
  // Pair punches into draft intervals, respecting frozen adjusted ranges.
  const drafts = pairEventsToIntervalDrafts({
    events,
    frozen: frozenRanges,
    timeZone,
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
      data: {
        employeeId,
        hotelDate: draft.hotelDate,
        startedAt: draft.startedAt,
        endedAt: draft.endedAt,
        // Link back to punch rows for adjustment rematch.
        startEventId: draft.startEventId,
        endEventId: draft.endEventId,
        breakMinutes: draft.breakMinutes,
        workedMinutes: draft.workedMinutes,
        anomalyFlags: draft.anomalyFlags,
        status: draft.status,
      },
    });
    // Guard / branch on preconditions.
    if (draft.startEventId) {
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
      data: {
        intervalId,
        requestedById: adj.requestedById,
        reviewedById: adj.reviewedById,
        reason: adj.reason,
        proposedStartedAt: adj.proposedStartedAt,
        proposedEndedAt: adj.proposedEndedAt,
        proposedBreakMinutes: adj.proposedBreakMinutes,
        status: adj.status,
        createdAt: adj.createdAt,
        reviewedAt: adj.reviewedAt,
      },
    });
    // Pending adjustments keep the interval in needs_review.
    if (adj.status === AttendanceAdjustmentStatus.pending) {
      // Await async persistence or side effect.
      await db.attendanceInterval.update({
        where: { id: intervalId },
        data: {
          status: AttendanceIntervalStatus.needs_review,
        },
      });
    }
  }
}
