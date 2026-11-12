/**
 * Background job: deactivate users idle past access.lockInactiveDays.
 * Uses conditional claims so concurrent runs cannot double-lock a user.
 */
import { Prisma } from "@prisma/client";
// Default claim DB when tests do not inject a fake.
import { prisma } from "../../db";
// Access settings: lockInactiveUsers flag and sessionIdleDays cutoff.
import { getAccess } from "../settings";
// Import module ../audit for this service.
import { recordAudit } from "../audit";
// Import module ../authSessions for this service.
import { revokeAllForUser } from "../authSessions";
// Import module ./runLifecycle for this service.
import { startJobRun, finishJobRun, withJobRun } from "./runLifecycle";

/**
 * Latest non-null activity timestamp (max of dates — not nullish coalescing).
 * @param dates - Candidate activity instants; nulls are ignored.
 */
export function latestActivityAt(
  // Set dates on the structure being built.
  dates: Array<Date | null | undefined>,
// Run next step: ): Date {
): Date {
  // Capture latest for use in this scope.
  let latest: Date | null = null;
  // Iterate items to apply the same logic to each entry.
  for (const d of dates) {
    // Skip null/undefined signals; createdAt is always present as a fallback.
    if (!d) continue;
    // Compare epoch ms so timezone offsets do not skew ordering.
    // Keep the chronologically latest non-null signal.
    if (!latest || d.getTime() > latest.getTime()) latest = d;
  }
  // Caller must supply at least one concrete date (e.g. createdAt).
  if (!latest) {
    // Abort with an error so callers can react.
    throw new Error("latestActivityAt requires at least one date");
  }
  // Return the computed result to the caller.
  return latest;
}

/** User fields used to compute last activity (devices pre-sorted desc). */
export type LockInactiveActivityUser = {
  // Set lastLoginAt on the structure being built.
  lastLoginAt: Date | null;
  // Set activatedAt on the structure being built.
  activatedAt: Date | null;
  // Set createdAt on the structure being built.
  createdAt: Date;
  // Set devices on the structure being built.
  devices: { lastSeenAt: Date }[];
};

/**
 * Established inactivity signals (AuthSession is intentionally excluded).
 * @param user - Row with login, activation, createdAt, and latest device.
 */
export function activitySignalsOf(
  // Set user on the structure being built.
  user: LockInactiveActivityUser,
// Run next step: ): Array<Date | null | undefined> {
): Array<Date | null | undefined> {
  // Order irrelevant — latestActivityAt takes the max. createdAt is last-resort.
  return [
    // Run next step: user.lastLoginAt,
    user.lastLoginAt,
    // Most recently seen non-revoked device (query orders desc, take 1).
    user.devices[0]?.lastSeenAt,
    // Run next step: user.activatedAt,
    user.activatedAt,
    // Run next step: user.createdAt,
    user.createdAt,
  ];
}

/** Row shape returned by the claim-time user re-read. */
type LockInactiveClaimRow = LockInactiveActivityUser & {
  // Set id on the structure being built.
  id: string;
  // Set isActive on the structure being built.
  isActive: boolean;
};

/** DB surface needed to claim a single inactive-user lock. */
export type LockInactiveClaimDb = {
  // Minimal prisma.user subset for CAS lock (injectable in tests).
  user: {
    // Set findUnique on the structure being built.
    findUnique: (args: {
      // Set where on the structure being built.
      where: { id: string };
      // Set select on the structure being built.
      select: {
        // Set id on the structure being built.
        id: true;
        // Set isActive on the structure being built.
        isActive: true;
        // Set lastLoginAt on the structure being built.
        lastLoginAt: true;
        // Set activatedAt on the structure being built.
        activatedAt: true;
        // Set createdAt on the structure being built.
        createdAt: true;
        // Set devices on the structure being built.
        devices: {
          // Set where on the structure being built.
          where: { revokedAt: null };
          // Set orderBy on the structure being built.
          orderBy: { lastSeenAt: "desc" };
          // Set take on the structure being built.
          take: 1;
          // Set select on the structure being built.
          select: { lastSeenAt: true };
        };
      };
    // Run next step: }) => Promise<LockInactiveClaimRow | null>;
    }) => Promise<LockInactiveClaimRow | null>;
    // Set updateMany on the structure being built.
    updateMany: (args: {
      // Set where on the structure being built.
      where: {
        // Set id on the structure being built.
        id: string;
        // Set isActive on the structure being built.
        isActive: true;
        // Set createdAt on the structure being built.
        createdAt: { lte: Date };
        // Set AND on the structure being built.
        AND: [
          // Run next step: {
          {
            // Set OR on the structure being built.
            OR: [
              // Run next step: { lastLoginAt: null },
              { lastLoginAt: null },
              // Run next step: { lastLoginAt: { lte: Date } },
              { lastLoginAt: { lte: Date } },
            ];
          },
          // Run next step: {
          {
            // Set OR on the structure being built.
            OR: [
              // Run next step: { activatedAt: null },
              { activatedAt: null },
              // Run next step: { activatedAt: { lte: Date } },
              { activatedAt: { lte: Date } },
            ];
          },
          // Run next step: {
          {
            // Set devices on the structure being built.
            devices: {
              // Set none on the structure being built.
              none: {
                // Set revokedAt on the structure being built.
                revokedAt: null;
                // Set lastSeenAt on the structure being built.
                lastSeenAt: { gt: Date };
              };
            };
          },
        ];
      };
      // Set data on the structure being built.
      data: { isActive: false };
    // Run next step: }) => Promise<{ count: number }>;
    }) => Promise<{ count: number }>;
  };
};

/** Outcome of a single-user conditional lock attempt. */
export type LockInactiveClaimResult =
  // Run next step: | { claimed: false }
  | { claimed: false }
  // Run next step: | { claimed: true; lastActivity: Date };
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
  // Set db on the structure being built.
  db: LockInactiveClaimDb,
  // Set userId on the structure being built.
  userId: string,
  // Set cutoff on the structure being built.
  cutoff: Date,
// Run next step: ): Promise<LockInactiveClaimResult> {
): Promise<LockInactiveClaimResult> {
  // Fresh read inside the claim so we do not lock from a stale candidate list.
  const user = await db.user.findUnique({
    // Set where on the structure being built.
    where: { id: userId },
    // Set select on the structure being built.
    select: {
      // Set id on the structure being built.
      id: true,
      // Set isActive on the structure being built.
      isActive: true,
      // Set lastLoginAt on the structure being built.
      lastLoginAt: true,
      // Set activatedAt on the structure being built.
      activatedAt: true,
      // Set createdAt on the structure being built.
      createdAt: true,
      // Set devices on the structure being built.
      devices: {
        // Same device slice as candidate scan — latest non-revoked lastSeenAt.
        where: { revokedAt: null },
        // Set orderBy on the structure being built.
        orderBy: { lastSeenAt: "desc" },
        // Set take on the structure being built.
        take: 1,
        // Set select on the structure being built.
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
    // Return the computed result to the caller.
    return { claimed: false };
  }

  // Conditional deactivate: refuses if login/device/activation raced ahead.
  const result = await db.user.updateMany({
    // Set where on the structure being built.
    where: {
      // Set id on the structure being built.
      id: userId,
      // Set isActive on the structure being built.
      isActive: true,
      // Account must have existed before the idle window began.
      createdAt: { lte: cutoff },
      // Set AND on the structure being built.
      AND: [
        // Run next step: {
        {
          // No login ever, or last login on/before cutoff.
          OR: [{ lastLoginAt: null }, { lastLoginAt: { lte: cutoff } }],
        },
        // Run next step: {
        {
          // Never activated, or activation on/before cutoff.
          OR: [{ activatedAt: null }, { activatedAt: { lte: cutoff } }],
        },
        // Run next step: {
        {
          // No active device reported activity after cutoff.
          devices: {
            // Set none on the structure being built.
            none: { revokedAt: null, lastSeenAt: { gt: cutoff } },
          },
        },
      ],
    },
    // Set data on the structure being built.
    data: { isActive: false },
  });

  // Another worker or a concurrent activity signal won the race.
  if (result.count === 0) return { claimed: false };
  // Return the computed result to the caller.
  return { claimed: true, lastActivity };
}

/** Active user row from the candidate scan (includes id). */
type LockInactiveCandidate = LockInactiveActivityUser & { id: string };

/** Injectable collaborators for `runLockInactiveUsers` unit tests. */
export type RunLockInactiveUsersDeps = {
  // Settings reader (defaults to getAccess from ../settings).
  getAccess?: () => Promise<{
    // Set lockInactiveUsers on the structure being built.
    lockInactiveUsers: boolean;
    // Set sessionIdleDays on the structure being built.
    sessionIdleDays: number;
  // Run next step: }>;
  }>;
  // Override candidate query (defaults to all active users + latest device).
  findCandidates?: () => Promise<LockInactiveCandidate[]>;
  // Run next step: claimDb?: LockInactiveClaimDb;
  claimDb?: LockInactiveClaimDb;
  // Audit writer (defaults to recordAudit).
  recordAudit?: typeof recordAudit;
  // Run next step: startJobRun?: (jobKey: string) => Promise<{ id: string }>;
  startJobRun?: (jobKey: string) => Promise<{ id: string }>;
  // Run next step: finishJobRun?: (
  finishJobRun?: (
    // Set id on the structure being built.
    id: string,
    // Set status on the structure being built.
    status: "ok" | "error",
    // Run next step: summary?: Prisma.InputJsonValue,
    summary?: Prisma.InputJsonValue,
    // Run next step: error?: string,
    error?: string,
  // Run next step: ) => Promise<unknown>;
  ) => Promise<unknown>;
};

/**
 * Scan active users and lock those idle past sessionIdleDays.
 * deps are injectable for unit tests (fake DB / settings).
 *
 * @param deps - Optional overrides for settings, DB, audit, and JobRun hooks.
 * @returns Locked count + cutoff ISO when active, or
 * `{ locked: 0, skipped: true, reason: "disabled" }` when the feature flag is off.
 */
export async function runLockInactiveUsers(deps: RunLockInactiveUsersDeps = {}) {
  // Prefer injected deps in tests; fall back to production modules.
  const accessFn = deps.getAccess ?? getAccess;
  // Capture audit for use in this scope.
  const audit = deps.recordAudit ?? recordAudit;
  // claimLockInactiveUser expects the prisma-shaped LockInactiveClaimDb.
  const claimDb = deps.claimDb ?? prisma;
  // Capture find candidates for use in this scope.
  const findCandidates =
    // Run next step: deps.findCandidates ??
    deps.findCandidates ??
    // Run next step: (() =>
    (() =>
      // Persist or query via Prisma for durable state.
      prisma.user.findMany({
        // Only active accounts are eligible for idle lock.
        where: { isActive: true },
        // Set include on the structure being built.
        include: {
          // Set devices on the structure being built.
          devices: {
            // Set where on the structure being built.
            where: { revokedAt: null },
            // Set orderBy on the structure being built.
            orderBy: { lastSeenAt: "desc" },
            // Set take on the structure being built.
            take: 1,
          },
        },
      }));

  // Return the computed result to the caller.
  return withJobRun(
    // Run next step: "lock_inactive_users",
    "lock_inactive_users",
    // Run next step: async () => {
    async () => {
      // Load access asynchronously for the next steps.
      const access = await accessFn();
      // Feature flag: skip entirely when lockInactiveUsers is off.
      if (!access.lockInactiveUsers) {
        // Return the computed result to the caller.
        return { locked: 0, skipped: true as const, reason: "disabled" };
      }

      // Activity older than this cutoff is considered idle.
      const cutoff = new Date(
        // Run next step: Date.now() - access.sessionIdleDays * 24 * 60 * 60 * 1000,
        Date.now() - access.sessionIdleDays * 24 * 60 * 60 * 1000,
      );
      // sessionIdleDays is whole days — multiply out to milliseconds.

      // Broad scan — per-user CAS claim re-validates before write.
      const candidates = await findCandidates();

      // Successful locks after claim + audit.
      let locked = 0;
      // Iterate items to apply the same logic to each entry.
      for (const user of candidates) {
        // Cheap pre-filter before the CAS claim round-trip.
        const lastActivity = latestActivityAt(activitySignalsOf(user));
        // Branch when this condition holds so the right path runs.
        if (lastActivity.getTime() > cutoff.getTime()) continue;

        // Candidate passed in-memory idle check — attempt atomic claim.
        // CAS path handles races with login, device sync, or activation.
        const claim = await claimLockInactiveUser(claimDb, user.id, cutoff);
        // Branch when this condition holds so the right path runs.
        if (!claim.claimed) continue;

        // Close open SSE / refresh sessions under the live-access User lock.
        if (!deps.claimDb) {
          // Wait for the async step before continuing.
          await revokeAllForUser(user.id);
          // Bump access-state version so stale Team lifecycle actions conflict.
          await prisma.employee.updateMany({
            // Set where on the structure being built.
            where: { user: { is: { id: user.id } } },
            // Set data on the structure being built.
            data: { accessVersion: { increment: 1 } },
          });
        }

        // Audit only successful locks (system actor).
        await audit({
          // Set actorEmployeeId on the structure being built.
          actorEmployeeId: null,
          // Set action on the structure being built.
          action: "user.lock_inactive",
          // Set entityType on the structure being built.
          entityType: "user",
          // Set entityId on the structure being built.
          entityId: user.id,
          // Set reason on the structure being built.
          reason: `Idle beyond ${access.sessionIdleDays} days`,
          // Set before on the structure being built.
          before: {
            // Set isActive on the structure being built.
            isActive: true,
            // Set lastActivity on the structure being built.
            lastActivity: claim.lastActivity.toISOString(),
          },
          // Set after on the structure being built.
          after: { isActive: false },
        });
        // Increment only after audit succeeds (lock already committed).
        locked += 1;
      }

      // Return the computed result to the caller.
      return {
        // Run next step: locked,
        locked,
        // Set skipped on the structure being built.
        skipped: false as const,
        // Set cutoff on the structure being built.
        cutoff: cutoff.toISOString(),
      };
    },
    // Run next step: {
    {
      // Set startJobRun on the structure being built.
      startJobRun: deps.startJobRun ?? startJobRun,
      // Set finishJobRun on the structure being built.
      finishJobRun: deps.finishJobRun ?? finishJobRun,
    },
  );
}
