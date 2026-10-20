/**
 * Background job: deactivate users idle past access.lockInactiveDays.
 * Uses conditional claims so concurrent runs cannot double-lock a user.
 */
import { Prisma } from "@prisma/client";
// Default claim DB when tests do not inject a fake.
import { prisma } from "../../db";
// Access settings: lockInactiveUsers flag and sessionIdleDays cutoff.
import { getAccess } from "../settings";
import { recordAudit } from "../audit";
import { revokeAllForUser } from "../authSessions";
import { startJobRun, finishJobRun } from "./runLifecycle";

/**
 * Latest non-null activity timestamp (max of dates — not nullish coalescing).
 * @param dates - Candidate activity instants; nulls are ignored.
 */
export function latestActivityAt(
  dates: Array<Date | null | undefined>,
): Date {
  let latest: Date | null = null;
  for (const d of dates) {
    // Skip null/undefined signals; createdAt is always present as a fallback.
    if (!d) continue;
    // Compare epoch ms so timezone offsets do not skew ordering.
    // Keep the chronologically latest non-null signal.
    if (!latest || d.getTime() > latest.getTime()) latest = d;
  }
  // Caller must supply at least one concrete date (e.g. createdAt).
  if (!latest) {
    throw new Error("latestActivityAt requires at least one date");
  }
  return latest;
}

/** User fields used to compute last activity (devices pre-sorted desc). */
export type LockInactiveActivityUser = {
  lastLoginAt: Date | null;
  activatedAt: Date | null;
  createdAt: Date;
  devices: { lastSeenAt: Date }[];
};

/**
 * Established inactivity signals (AuthSession is intentionally excluded).
 * @param user - Row with login, activation, createdAt, and latest device.
 */
export function activitySignalsOf(
  user: LockInactiveActivityUser,
): Array<Date | null | undefined> {
  // Order irrelevant — latestActivityAt takes the max. createdAt is last-resort.
  return [
    user.lastLoginAt,
    // Most recently seen non-revoked device (query orders desc, take 1).
    user.devices[0]?.lastSeenAt,
    user.activatedAt,
    user.createdAt,
  ];
}

/** Row shape returned by the claim-time user re-read. */
type LockInactiveClaimRow = LockInactiveActivityUser & {
  id: string;
  isActive: boolean;
};

/** DB surface needed to claim a single inactive-user lock. */
export type LockInactiveClaimDb = {
  // Minimal prisma.user subset for CAS lock (injectable in tests).
  user: {
    findUnique: (args: {
      where: { id: string };
      select: {
        id: true;
        isActive: true;
        lastLoginAt: true;
        activatedAt: true;
        createdAt: true;
        devices: {
          where: { revokedAt: null };
          orderBy: { lastSeenAt: "desc" };
          take: 1;
          select: { lastSeenAt: true };
        };
      };
    }) => Promise<LockInactiveClaimRow | null>;
    updateMany: (args: {
      where: {
        id: string;
        isActive: true;
        createdAt: { lte: Date };
        AND: [
          {
            OR: [
              { lastLoginAt: null },
              { lastLoginAt: { lte: Date } },
            ];
          },
          {
            OR: [
              { activatedAt: null },
              { activatedAt: { lte: Date } },
            ];
          },
          {
            devices: {
              none: {
                revokedAt: null;
                lastSeenAt: { gt: Date };
              };
            };
          },
        ];
      };
      data: { isActive: false };
    }) => Promise<{ count: number }>;
  };
};

/** Outcome of a single-user conditional lock attempt. */
export type LockInactiveClaimResult =
  | { claimed: false }
  | { claimed: true; lastActivity: Date };

/**
 * Re-read activity and lock only if the user is still idle at write time.
 * CAS updateMany refuses concurrent login/sync/activation after the snapshot.
 *
 * @param db - Injectable user find/updateMany (real prisma or test double).
 * @param userId - Target user primary key.
 * @param cutoff - Activity at or before this instant qualifies as idle.
 * @internal exported for unit tests with a fake DB
 */
export async function claimLockInactiveUser(
  db: LockInactiveClaimDb,
  userId: string,
  cutoff: Date,
): Promise<LockInactiveClaimResult> {
  // Fresh read inside the claim so we do not lock from a stale candidate list.
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      isActive: true,
      lastLoginAt: true,
      activatedAt: true,
      createdAt: true,
      devices: {
        // Same device slice as candidate scan — latest non-revoked lastSeenAt.
        where: { revokedAt: null },
        orderBy: { lastSeenAt: "desc" },
        take: 1,
        select: { lastSeenAt: true },
      },
    },
  });
  // Already inactive or missing — nothing to claim.
  if (!user || !user.isActive) return { claimed: false };

  // In-memory idle check before the CAS write.
  const lastActivity = latestActivityAt(activitySignalsOf(user));
  // Still active after cutoff — do not attempt the CAS write.
  if (lastActivity.getTime() > cutoff.getTime()) {
    return { claimed: false };
  }

  // Conditional deactivate: refuses if login/device/activation raced ahead.
  const result = await db.user.updateMany({
    where: {
      id: userId,
      isActive: true,
      // Account must have existed before the idle window began.
      createdAt: { lte: cutoff },
      AND: [
        {
          // No login ever, or last login on/before cutoff.
          OR: [{ lastLoginAt: null }, { lastLoginAt: { lte: cutoff } }],
        },
        {
          // Never activated, or activation on/before cutoff.
          OR: [{ activatedAt: null }, { activatedAt: { lte: cutoff } }],
        },
        {
          // No active device reported activity after cutoff.
          devices: {
            none: { revokedAt: null, lastSeenAt: { gt: cutoff } },
          },
        },
      ],
    },
    data: { isActive: false },
  });

  // Another worker or a concurrent activity signal won the race.
  if (result.count === 0) return { claimed: false };
  return { claimed: true, lastActivity };
}

/** Active user row from the candidate scan (includes id). */
type LockInactiveCandidate = LockInactiveActivityUser & { id: string };

/** Injectable collaborators for `runLockInactiveUsers` unit tests. */
export type RunLockInactiveUsersDeps = {
  // Settings reader (defaults to getAccess from ../settings).
  getAccess?: () => Promise<{
    lockInactiveUsers: boolean;
    sessionIdleDays: number;
  }>;
  // Override candidate query (defaults to all active users + latest device).
  findCandidates?: () => Promise<LockInactiveCandidate[]>;
  claimDb?: LockInactiveClaimDb;
  // Audit writer (defaults to recordAudit).
  recordAudit?: typeof recordAudit;
  startJobRun?: (jobKey: string) => Promise<{ id: string }>;
  finishJobRun?: (
    id: string,
    status: "ok" | "error",
    summary?: Prisma.InputJsonValue,
    error?: string,
  ) => Promise<unknown>;
};

/**
 * Scan active users and lock those idle past sessionIdleDays.
 * deps are injectable for unit tests (fake DB / settings).
 *
 * @param deps - Optional overrides for settings, DB, audit, and JobRun hooks.
 * @returns Locked count, or `{ locked: 0, skipped: true }` when disabled.
 */
export async function runLockInactiveUsers(deps: RunLockInactiveUsersDeps = {}) {
  // Prefer injected deps in tests; fall back to production modules.
  const accessFn = deps.getAccess ?? getAccess;
  const start = deps.startJobRun ?? startJobRun;
  const finish = deps.finishJobRun ?? finishJobRun;
  const audit = deps.recordAudit ?? recordAudit;
  // claimLockInactiveUser expects the prisma-shaped LockInactiveClaimDb.
  const claimDb = deps.claimDb ?? prisma;
  const findCandidates =
    deps.findCandidates ??
    (() =>
      prisma.user.findMany({
        // Only active accounts are eligible for idle lock.
        where: { isActive: true },
        include: {
          devices: {
            where: { revokedAt: null },
            orderBy: { lastSeenAt: "desc" },
            take: 1,
          },
        },
      }));

  // Standard JobRun lifecycle keyed for the jobs admin panel.
  const run = await start("lock_inactive_users");
  try {
    const access = await accessFn();
    // Feature flag: skip entirely when lockInactiveUsers is off.
    if (!access.lockInactiveUsers) {
      // Early exit still closes the JobRun as ok with skip reason.
      await finish(run.id, "ok", { skipped: true, reason: "disabled" });
      return { locked: 0, skipped: true };
    }

    // Activity older than this cutoff is considered idle.
    const cutoff = new Date(
      Date.now() - access.sessionIdleDays * 24 * 60 * 60 * 1000,
    );
    // sessionIdleDays is whole days — multiply out to milliseconds.

    // Broad scan — per-user CAS claim re-validates before write.
    const candidates = await findCandidates();

    // Successful locks after claim + audit.
    let locked = 0;
    for (const user of candidates) {
      // Cheap pre-filter before the CAS claim round-trip.
      const lastActivity = latestActivityAt(activitySignalsOf(user));
      if (lastActivity.getTime() > cutoff.getTime()) continue;

      // Candidate passed in-memory idle check — attempt atomic claim.
      // CAS path handles races with login, device sync, or activation.
      const claim = await claimLockInactiveUser(claimDb, user.id, cutoff);
      if (!claim.claimed) continue;

      // Close open SSE / refresh sessions under the live-access User lock.
      if (!deps.claimDb) {
        await revokeAllForUser(user.id);
      }

      // Audit only successful locks (system actor).
      await audit({
        actorEmployeeId: null,
        action: "user.lock_inactive",
        entityType: "user",
        entityId: user.id,
        reason: `Idle beyond ${access.sessionIdleDays} days`,
        before: {
          isActive: true,
          lastActivity: claim.lastActivity.toISOString(),
        },
        after: { isActive: false },
      });
      // Increment only after audit succeeds (lock already committed).
      locked += 1;
    }

    await finish(run.id, "ok", { locked, cutoff: cutoff.toISOString() });
    return { locked, skipped: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finish(run.id, "error", undefined, message);
    // Surface failure to scheduler after JobRun error row is written.
    throw err;
  }
}
