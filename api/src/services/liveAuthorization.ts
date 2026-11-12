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
// Import module ../db for this service.
import { prisma } from "../db";
// Import module ./authSessions for this service.
import { assertSessionActive } from "./authSessions";
// Import module ./dataScope for this service.
import { resolveDataScope, type DataScope } from "./dataScope";
// Import module dependency for this service.
import {
  // Run next step: assertCanAccessLocation,
  assertCanAccessLocation,
  // Run next step: assertCanAccessTask,
  assertCanAccessTask,
  // Run next step: assertCanAccessTicket,
  assertCanAccessTicket,
// Run next step: } from "./dataScope";
} from "./dataScope";
// Import module ../events/authorizeLiveEvent for this service.
import { canDeliverLiveEvent } from "../events/authorizeLiveEvent";
// Import type(s) LiveEvent for typing without runtime cost.
import type { LiveEvent } from "../events/bus";
// Import module @prisma/client for this service.
import { Prisma } from "@prisma/client";
// Import type(s) Tx for typing without runtime cost.
import type { Tx } from "./db/types";

// Declare type LiveAuthorizationTestHooks for callers and internals.
export type LiveAuthorizationTestHooks = {
  /** Fires immediately after User FOR SHARE is acquired. */
  afterUserShareLocked?: (ctx: { userId: string; tx: Tx }) => Promise<void>;
  /** Fires after scope resolution, still holding User FOR SHARE. */
  afterScopeResolved?: (ctx: {
    // Set userId on the structure being built.
    userId: string;
    // Set scope on the structure being built.
    scope: DataScope;
    // Set tx on the structure being built.
    tx: Tx;
  // Run next step: }) => Promise<void>;
  }) => Promise<void>;
};

// Capture test hooks for use in this scope.
let testHooks: LiveAuthorizationTestHooks = {};

/** Test-only seam for deterministic mid-authorization barriers. */
export function setLiveAuthorizationTestHooks(
  // Set hooks on the structure being built.
  hooks: LiveAuthorizationTestHooks,
// Run next step: ): void {
): void {
  // Update test hooks as control flow progresses.
  testHooks = hooks;
}

/** Clear test hooks (call from after()/finally). */
export function resetLiveAuthorizationTestHooks(): void {
  // Update test hooks as control flow progresses.
  testHooks = {};
}

// Define lockUserShare — core behavior for this module.
async function lockUserShare(tx: Tx, userId: string): Promise<void> {
  // FOR SHARE conflicts with the FOR UPDATE protocol used by revocation,
  // role changes and sector assignment/membership writers.
  await tx.$executeRaw`
    SELECT id FROM "User" WHERE id = ${userId} FOR SHARE
  `;
}

/** Hold the subscriber's sectors so membership replaces cannot race delivery. */
async function lockScopeSectorsShare(tx: Tx, scope: DataScope): Promise<void> {
  // Branch when this condition holds so the right path runs.
  if (scope.kind !== "sectors" || scope.sectorIds.length === 0) return;
  // Collect ids list for later processing.
  const ids = [...scope.sectorIds].sort();
  // Wait for the async step before continuing.
  await tx.$executeRaw`
    SELECT id FROM "Sector" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE
  `;
}

// Define loadAuthorizedState — core behavior for this module.
async function loadAuthorizedState(
  // Set tx on the structure being built.
  tx: Tx,
  // Set user on the structure being built.
  user: AuthUser,
// Run next step: ): Promise<{ user: AuthUser; scope: DataScope }> {
): Promise<{ user: AuthUser; scope: DataScope }> {
  // Wait for the async step before continuing.
  await lockUserShare(tx, user.userId);
  // Branch when this condition holds so the right path runs.
  if (testHooks.afterUserShareLocked) {
    // Wait for the async step before continuing.
    await testHooks.afterUserShareLocked({ userId: user.userId, tx });
  }
  // Load session asynchronously for the next steps.
  const session = await assertSessionActive(user.sid, user.userId, tx);
  // Capture current user for use in this scope.
  const currentUser: AuthUser = {
    // Set userId on the structure being built.
    userId: session.user.id,
    // Set employeeId on the structure being built.
    employeeId: session.user.employeeId,
    // Set role on the structure being built.
    role: session.user.role,
    // Set email on the structure being built.
    email: session.user.email,
    // Set sid on the structure being built.
    sid: session.id,
  };
  // Expand sector SHARE locks until the resolved sector set is stable.
  let scope = await resolveDataScope(currentUser, tx);
  // Iterate items to apply the same logic to each entry.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    // Wait for the async step before continuing.
    await lockScopeSectorsShare(tx, scope);
    // Load again asynchronously for the next steps.
    const again = await resolveDataScope(currentUser, tx);
    // Collect before list for later processing.
    const before = [...scope.sectorIds].sort().join(",");
    // Collect after list for later processing.
    const after = [...again.sectorIds].sort().join(",");
    // Update scope as control flow progresses.
    scope = again;
    // Branch when this condition holds so the right path runs.
    if (before === after) break;
  }
  // Branch when this condition holds so the right path runs.
  if (testHooks.afterScopeResolved) {
    // Wait for the async step before continuing.
    await testHooks.afterScopeResolved({
      // Set userId on the structure being built.
      userId: currentUser.userId,
      // Run next step: scope,
      scope,
      // Run next step: tx,
      tx,
    });
  }
  // Return the computed result to the caller.
  return { user: currentUser, scope };
}

/** Authorize and write one frame while holding the shared serialization lock. */
export async function authorizeLiveDelivery(
  // Set user on the structure being built.
  user: AuthUser,
  // Set event on the structure being built.
  event: LiveEvent,
  // Set write on the structure being built.
  write: (event: LiveEvent) => void,
// Run next step: ): Promise<{ user: AuthUser; scope: DataScope; delivered: bo…
): Promise<{ user: AuthUser; scope: DataScope; delivered: boolean }> {
  // Return the computed result to the caller.
  return prisma.$transaction(
    // Run next step: async (tx) => {
    async (tx) => {
      // Load authorized asynchronously for the next steps.
      const authorized = await loadAuthorizedState(tx, user);
      // Load delivered asynchronously for the next steps.
      const delivered = await canDeliverLiveEvent(authorized.scope, event, {
        // Set assertCanAccessLocation on the structure being built.
        assertCanAccessLocation: (s, id) => assertCanAccessLocation(s, id, tx),
        // Set assertCanAccessTask on the structure being built.
        assertCanAccessTask: (s, id) => assertCanAccessTask(s, id, tx),
        // Set assertCanAccessTicket on the structure being built.
        assertCanAccessTicket: (s, id) => assertCanAccessTicket(s, id, tx),
      });
      // This is deliberately inside the transaction: the successful write is
      // the delivery linearization point, not a check that happened earlier.
      if (delivered) write(event);
      // Return the computed result to the caller.
      return { ...authorized, delivered };
    },
    // Run next step: { timeout: 20_000, maxWait: 20_000 },
    { timeout: 20_000, maxWait: 20_000 },
  );
}

/**
 * Heartbeat / idle refresh under the same User FOR SHARE lock so revoke and
 * sector writers cannot race a "still active" decision against a later ping.
 */
export async function refreshLiveSubscriberState(
  // Set user on the structure being built.
  user: AuthUser,
// Run next step: ): Promise<{ user: AuthUser; scope: DataScope }> {
): Promise<{ user: AuthUser; scope: DataScope }> {
  // Return the computed result to the caller.
  return prisma.$transaction(
    // Run next step: async (tx) => loadAuthorizedState(tx, user),
    async (tx) => loadAuthorizedState(tx, user),
    // Run next step: { timeout: 20_000, maxWait: 20_000 },
    { timeout: 20_000, maxWait: 20_000 },
  );
}

// Re-export lock helpers so existing imports from this module keep working.
export {
  // Run next step: lockUsersForLiveAccess,
  lockUsersForLiveAccess,
  // Run next step: lockEmployeesForLiveAccess,
  lockEmployeesForLiveAccess,
// Run next step: } from "./liveAccessLocks";
} from "./liveAccessLocks";
