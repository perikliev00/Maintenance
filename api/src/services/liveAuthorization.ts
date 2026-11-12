/**
 * Serialization boundary for a live delivery and changes which remove access.
 *
 * A stream takes User FOR SHARE (session/role/supervisor writers use FOR UPDATE
 * on the same row) and, for sector-scoped subscribers, Sector FOR SHARE on the
 * resolved sector ids (membership writers use Sector FOR NO KEY UPDATE).
 * Session + scope are re-checked and the frame is written before those locks
 * release, so delivery is linearized against access-reducing commits.
 */
import type { AuthUser } from "../auth/tokens";
import { prisma } from "../db";
import { assertSessionActive } from "./authSessions";
import { resolveDataScope, type DataScope } from "./dataScope";
import {
  assertCanAccessLocation,
  assertCanAccessTask,
  assertCanAccessTicket,
} from "./dataScope";
import { canDeliverLiveEvent } from "../events/authorizeLiveEvent";
// Import type(s) LiveEvent for typing without runtime cost.
import type { LiveEvent } from "../events/bus";
import { Prisma } from "@prisma/client";
// Import type(s) Tx for typing without runtime cost.
import type { Tx } from "./db/types";

// Declare type LiveAuthorizationTestHooks for callers and internals.
export type LiveAuthorizationTestHooks = {
  /** Fires immediately after User FOR SHARE is acquired. */
  afterUserShareLocked?: (ctx: { userId: string; tx: Tx }) => Promise<void>;
  /** Fires after scope resolution, still holding User FOR SHARE. */
  afterScopeResolved?: (ctx: {
    userId: string;
    scope: DataScope;
    tx: Tx;
  }) => Promise<void>;
};

// Capture test hooks for use in this scope.
let testHooks: LiveAuthorizationTestHooks = {};

/** Test-only seam for deterministic mid-authorization barriers. */
export function setLiveAuthorizationTestHooks(
  hooks: LiveAuthorizationTestHooks,
): void {
  // Update test hooks as control flow progresses.
  testHooks = hooks;
}

/** Clear test hooks (call from after()/finally). */
export function resetLiveAuthorizationTestHooks(): void {
  // Update test hooks as control flow progresses.
  testHooks = {};
}

async function lockUserShare(tx: Tx, userId: string): Promise<void> {
  // FOR SHARE conflicts with the FOR UPDATE protocol used by revocation,
  // role changes and sector assignment/membership writers.
  await tx.$executeRaw`
    SELECT id FROM "User" WHERE id = ${userId} FOR SHARE
  `;
}

/** Hold the subscriber's sectors so membership replaces cannot race delivery. */
async function lockScopeSectorsShare(tx: Tx, scope: DataScope): Promise<void> {
  if (scope.kind !== "sectors" || scope.sectorIds.length === 0) return;
  // Collect ids list for later processing.
  const ids = [...scope.sectorIds].sort();
  await tx.$executeRaw`
    SELECT id FROM "Sector" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE
  `;
}

async function loadAuthorizedState(
  tx: Tx,
  user: AuthUser,
): Promise<{ user: AuthUser; scope: DataScope }> {
  await lockUserShare(tx, user.userId);
  if (testHooks.afterUserShareLocked) {
    await testHooks.afterUserShareLocked({ userId: user.userId, tx });
  }
  const session = await assertSessionActive(user.sid, user.userId, tx);
  // Capture current user for use in this scope.
  const currentUser: AuthUser = {
    userId: session.user.id,
    employeeId: session.user.employeeId,
    role: session.user.role,
    email: session.user.email,
    sid: session.id,
  };
  // Expand sector SHARE locks until the resolved sector set is stable.
  let scope = await resolveDataScope(currentUser, tx);
  // Iterate items to apply the same logic to each entry.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await lockScopeSectorsShare(tx, scope);
    const again = await resolveDataScope(currentUser, tx);
    // Collect before list for later processing.
    const before = [...scope.sectorIds].sort().join(",");
    // Collect after list for later processing.
    const after = [...again.sectorIds].sort().join(",");
    scope = again;
    if (before === after) break;
  }
  if (testHooks.afterScopeResolved) {
    await testHooks.afterScopeResolved({
      userId: currentUser.userId,
      scope,
      tx,
    });
  }
  return { user: currentUser, scope };
}

/** Authorize and write one frame while holding the shared serialization lock. */
export async function authorizeLiveDelivery(
  user: AuthUser,
  event: LiveEvent,
  write: (event: LiveEvent) => void,
): Promise<{ user: AuthUser; scope: DataScope; delivered: boolean }> {
  return prisma.$transaction(
    async (tx) => {
      const authorized = await loadAuthorizedState(tx, user);
      const delivered = await canDeliverLiveEvent(authorized.scope, event, {
        assertCanAccessLocation: (s, id) => assertCanAccessLocation(s, id, tx),
        assertCanAccessTask: (s, id) => assertCanAccessTask(s, id, tx),
        assertCanAccessTicket: (s, id) => assertCanAccessTicket(s, id, tx),
      });
      // This is deliberately inside the transaction: the successful write is
      // the delivery linearization point, not a check that happened earlier.
      if (delivered) write(event);
      return { ...authorized, delivered };
    },
    { timeout: 20_000, maxWait: 20_000 },
  );
}

/**
 * Heartbeat / idle refresh under the same User FOR SHARE lock so revoke and
 * sector writers cannot race a "still active" decision against a later ping.
 */
export async function refreshLiveSubscriberState(
  user: AuthUser,
): Promise<{ user: AuthUser; scope: DataScope }> {
  return prisma.$transaction(
    async (tx) => loadAuthorizedState(tx, user),
    { timeout: 20_000, maxWait: 20_000 },
  );
}

// Re-export lock helpers so existing imports from this module keep working.
export {
  lockUsersForLiveAccess,
  lockEmployeesForLiveAccess,
} from "./liveAccessLocks";
