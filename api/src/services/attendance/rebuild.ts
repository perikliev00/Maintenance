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
import {
  AttendanceAdjustmentStatus,
  AttendanceIntervalStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "../../db";
import { zonedDayStartUtc } from "../hotelTime";

/** Open intervals older than this become `missing_end` → `needs_review`. */
/** Default page size for GET /attendance/intervals */

type Tx = Prisma.TransactionClient;

type StaleIntervalRow = {
  status: AttendanceIntervalStatus;
  endedAt: Date | null;
  startedAt: Date;
  anomalyFlags: unknown;
};

/** DB surface needed to claim a single stale open interval. */
export type StaleOpenClaimDb = {
  attendanceInterval: {
    findUnique: (args: {
      where: { id: string };
      select: {
        status: true;
        endedAt: true;
        startedAt: true;
        anomalyFlags: true;
      };
    }) => Promise<StaleIntervalRow | null>;
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
  db: StaleOpenClaimDb,
  id: string,
  cutoff: Date,
): Promise<boolean> {
  const row = await db.attendanceInterval.findUnique({
    where: { id },
    select: {
      status: true,
      endedAt: true,
      startedAt: true,
      anomalyFlags: true,
    },
  });
  if (
    !row ||
    row.status !== AttendanceIntervalStatus.open ||
    row.endedAt !== null ||
    row.startedAt.getTime() > cutoff.getTime()
  ) {
    return false;
  }

  const nextFlags = uniqueFlags([...asFlags(row.anomalyFlags), "missing_end"]);
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
  return claimed.count > 0;
}

/**
 * Persist `missing_end` / `needs_review` for open intervals that aged past
 * OPEN_MISSING_END_HOURS without a new ingest rebuild.
 */
export async function markStaleOpenIntervals(now = new Date()) {
  const cutoff = new Date(
    now.getTime() - OPEN_MISSING_END_HOURS * 3600_000,
  );
  const candidates = await prisma.attendanceInterval.findMany({
    where: {
      status: AttendanceIntervalStatus.open,
      endedAt: null,
      startedAt: { lte: cutoff },
    },
    select: { id: true },
  });

  let flagged = 0;
  for (const { id } of candidates) {
    if (
      await claimStaleOpenInterval(
        prisma as unknown as StaleOpenClaimDb,
        id,
        cutoff,
      )
    ) {
      flagged += 1;
    }
  }

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
  const centerYmd = hotelDate.toISOString().slice(0, 10);
  const prevYmd = addDaysYmd(centerYmd, -1);
  const replaceYmds = [prevYmd, centerYmd];
  const replaceKeys = replaceYmds.map(hotelDateKey);

  const from = zonedDayStartUtc(prevYmd, timeZone);
  const to = zonedDayStartUtc(addDaysYmd(centerYmd, 2), timeZone);

  const [events, frozen, replaceable] = await Promise.all([
    db.attendanceEvent.findMany({
      where: {
        employeeId,
        normalizedTime: { gte: from, lt: to },
      },
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
    db.attendanceInterval.findMany({
      where: {
        employeeId,
        hotelDate: { in: replaceKeys },
        status: AttendanceIntervalStatus.adjusted,
      },
      select: { id: true, startedAt: true, endedAt: true },
    }),
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

  const replaceIds = replaceable.map((r) => r.id);
  if (replaceIds.length) {
    await db.attendanceAdjustment.deleteMany({
      where: { intervalId: { in: replaceIds } },
    });
    await db.attendanceInterval.deleteMany({
      where: { id: { in: replaceIds } },
    });
  }

  const frozenRanges: FrozenRange[] = frozen.map((f) => ({
    startMs: f.startedAt.getTime(),
    endMs: (f.endedAt ?? new Date(f.startedAt.getTime() + 36 * 3600_000)).getTime(),
  }));

  const drafts = pairEventsToIntervalDrafts({
    events,
    frozen: frozenRanges,
    timeZone,
  }).filter((d) => {
    const ymd = d.hotelDate.toISOString().slice(0, 10);
    return replaceYmds.includes(ymd);
  });

  const createdByStart = new Map<string, string>();
  for (const draft of drafts) {
    const created = await db.attendanceInterval.create({
      data: {
        employeeId,
        hotelDate: draft.hotelDate,
        startedAt: draft.startedAt,
        endedAt: draft.endedAt,
        startEventId: draft.startEventId,
        endEventId: draft.endEventId,
        breakMinutes: draft.breakMinutes,
        workedMinutes: draft.workedMinutes,
        anomalyFlags: draft.anomalyFlags,
        status: draft.status,
      },
    });
    if (draft.startEventId) {
      createdByStart.set(draft.startEventId, created.id);
    }
  }

  for (const adj of adjustmentsToRematch) {
    const intervalId = createdByStart.get(adj.startEventId);
    if (!intervalId) continue;
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
    if (adj.status === AttendanceAdjustmentStatus.pending) {
      await db.attendanceInterval.update({
        where: { id: intervalId },
        data: {
          status: AttendanceIntervalStatus.needs_review,
        },
      });
    }
  }
}
