import { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { getAccess } from "../settings";
import { recordAudit } from "../audit";
import { startJobRun, finishJobRun } from "./runLifecycle";

/** Latest non-null activity timestamp (max of dates — not nullish coalescing). */
export function latestActivityAt(
  dates: Array<Date | null | undefined>,
): Date {
  let latest: Date | null = null;
  for (const d of dates) {
    if (!d) continue;
    if (!latest || d.getTime() > latest.getTime()) latest = d;
  }
  if (!latest) {
    throw new Error("latestActivityAt requires at least one date");
  }
  return latest;
}

export type LockInactiveActivityUser = {
  lastLoginAt: Date | null;
  activatedAt: Date | null;
  createdAt: Date;
  devices: { lastSeenAt: Date }[];
};

/** Established inactivity signals (AuthSession is intentionally excluded). */
export function activitySignalsOf(
  user: LockInactiveActivityUser,
): Array<Date | null | undefined> {
  return [
    user.lastLoginAt,
    user.devices[0]?.lastSeenAt,
    user.activatedAt,
    user.createdAt,
  ];
}

type LockInactiveClaimRow = LockInactiveActivityUser & {
  id: string;
  isActive: boolean;
};

/** DB surface needed to claim a single inactive-user lock. */
export type LockInactiveClaimDb = {
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

export type LockInactiveClaimResult =
  | { claimed: false }
  | { claimed: true; lastActivity: Date };

/**
 * Re-read activity and lock only if the user is still idle at write time.
 * CAS updateMany refuses concurrent login/sync/activation after the snapshot.
 * @internal exported for unit tests with a fake DB
 */
export async function claimLockInactiveUser(
  db: LockInactiveClaimDb,
  userId: string,
  cutoff: Date,
): Promise<LockInactiveClaimResult> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      isActive: true,
      lastLoginAt: true,
      activatedAt: true,
      createdAt: true,
      devices: {
        where: { revokedAt: null },
        orderBy: { lastSeenAt: "desc" },
        take: 1,
        select: { lastSeenAt: true },
      },
    },
  });
  if (!user || !user.isActive) return { claimed: false };

  const lastActivity = latestActivityAt(activitySignalsOf(user));
  if (lastActivity.getTime() > cutoff.getTime()) {
    return { claimed: false };
  }

  const result = await db.user.updateMany({
    where: {
      id: userId,
      isActive: true,
      createdAt: { lte: cutoff },
      AND: [
        {
          OR: [{ lastLoginAt: null }, { lastLoginAt: { lte: cutoff } }],
        },
        {
          OR: [{ activatedAt: null }, { activatedAt: { lte: cutoff } }],
        },
        {
          devices: {
            none: { revokedAt: null, lastSeenAt: { gt: cutoff } },
          },
        },
      ],
    },
    data: { isActive: false },
  });

  if (result.count === 0) return { claimed: false };
  return { claimed: true, lastActivity };
}

type LockInactiveCandidate = LockInactiveActivityUser & { id: string };

export type RunLockInactiveUsersDeps = {
  getAccess?: () => Promise<{
    lockInactiveUsers: boolean;
    sessionIdleDays: number;
  }>;
  findCandidates?: () => Promise<LockInactiveCandidate[]>;
  claimDb?: LockInactiveClaimDb;
  recordAudit?: typeof recordAudit;
  startJobRun?: (jobKey: string) => Promise<{ id: string }>;
  finishJobRun?: (
    id: string,
    status: "ok" | "error",
    summary?: Prisma.InputJsonValue,
    error?: string,
  ) => Promise<unknown>;
};

export async function runLockInactiveUsers(deps: RunLockInactiveUsersDeps = {}) {
  const accessFn = deps.getAccess ?? getAccess;
  const start = deps.startJobRun ?? startJobRun;
  const finish = deps.finishJobRun ?? finishJobRun;
  const audit = deps.recordAudit ?? recordAudit;
  const claimDb = deps.claimDb ?? prisma;
  const findCandidates =
    deps.findCandidates ??
    (() =>
      prisma.user.findMany({
        where: { isActive: true },
        include: {
          devices: {
            where: { revokedAt: null },
            orderBy: { lastSeenAt: "desc" },
            take: 1,
          },
        },
      }));

  const run = await start("lock_inactive_users");
  try {
    const access = await accessFn();
    if (!access.lockInactiveUsers) {
      await finish(run.id, "ok", { skipped: true, reason: "disabled" });
      return { locked: 0, skipped: true };
    }

    const cutoff = new Date(
      Date.now() - access.sessionIdleDays * 24 * 60 * 60 * 1000,
    );

    const candidates = await findCandidates();

    let locked = 0;
    for (const user of candidates) {
      const lastActivity = latestActivityAt(activitySignalsOf(user));
      if (lastActivity.getTime() > cutoff.getTime()) continue;

      const claim = await claimLockInactiveUser(claimDb, user.id, cutoff);
      if (!claim.claimed) continue;

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
      locked += 1;
    }

    await finish(run.id, "ok", { locked, cutoff: cutoff.toISOString() });
    return { locked, skipped: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finish(run.id, "error", undefined, message);
    throw err;
  }
}
