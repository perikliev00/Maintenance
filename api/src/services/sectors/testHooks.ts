/**
 * Test-only barriers for sector mutation concurrency (BUG-11 / BUG-12).
 * Production code never sets these hooks.
 */
import type { DataScope } from "../dataScope";
// Import type(s) Tx for typing without runtime cost.
import type { Tx } from "../db/types";

// Declare type SectorMutationTestHooks for callers and internals.
export type SectorMutationTestHooks = {
  /** After initial HTTP-style auth/scope resolution, before the DB transaction. */
  afterPreTxAuth?: (ctx: {
    sectorId: string;
    scope: DataScope;
  }) => Promise<void>;
  /** After the sector row is locked inside the mutation transaction. */
  afterSectorLocked?: (ctx: {
    sectorId: string;
    scope: DataScope;
    tx: Tx;
  }) => Promise<void>;
  /** After access was re-checked under the sector lock, before writes. */
  afterAccessRechecked?: (ctx: {
    sectorId: string;
    scope: DataScope;
    tx: Tx;
  }) => Promise<void>;
};

// Capture test hooks for use in this scope.
let testHooks: SectorMutationTestHooks = {};

/** Install deterministic mid-mutation barriers (tests only). */
export function setSectorMutationTestHooks(
  hooks: SectorMutationTestHooks,
): void {
  // Update test hooks as control flow progresses.
  testHooks = hooks;
}

/** Clear barriers — call from after()/finally. */
export function resetSectorMutationTestHooks(): void {
  // Update test hooks as control flow progresses.
  testHooks = {};
}

export async function runAfterPreTxAuth(ctx: {
  sectorId: string;
  scope: DataScope;
}): Promise<void> {
  if (testHooks.afterPreTxAuth) {
    await testHooks.afterPreTxAuth(ctx);
  }
}

export async function runAfterSectorLocked(ctx: {
  sectorId: string;
  scope: DataScope;
  tx: Tx;
}): Promise<void> {
  if (testHooks.afterSectorLocked) {
    await testHooks.afterSectorLocked(ctx);
  }
}

export async function runAfterAccessRechecked(ctx: {
  sectorId: string;
  scope: DataScope;
  tx: Tx;
}): Promise<void> {
  if (testHooks.afterAccessRechecked) {
    await testHooks.afterAccessRechecked(ctx);
  }
}
