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
    // Set sectorId on the structure being built.
    sectorId: string;
    // Set scope on the structure being built.
    scope: DataScope;
  // Run next step: }) => Promise<void>;
  }) => Promise<void>;
  /** After the sector row is locked inside the mutation transaction. */
  afterSectorLocked?: (ctx: {
    // Set sectorId on the structure being built.
    sectorId: string;
    // Set scope on the structure being built.
    scope: DataScope;
    // Set tx on the structure being built.
    tx: Tx;
  // Run next step: }) => Promise<void>;
  }) => Promise<void>;
  /** After access was re-checked under the sector lock, before writes. */
  afterAccessRechecked?: (ctx: {
    // Set sectorId on the structure being built.
    sectorId: string;
    // Set scope on the structure being built.
    scope: DataScope;
    // Set tx on the structure being built.
    tx: Tx;
  // Run next step: }) => Promise<void>;
  }) => Promise<void>;
};

// Capture test hooks for use in this scope.
let testHooks: SectorMutationTestHooks = {};

/** Install deterministic mid-mutation barriers (tests only). */
export function setSectorMutationTestHooks(
  // Set hooks on the structure being built.
  hooks: SectorMutationTestHooks,
// Run next step: ): void {
): void {
  // Update test hooks as control flow progresses.
  testHooks = hooks;
}

/** Clear barriers — call from after()/finally. */
export function resetSectorMutationTestHooks(): void {
  // Update test hooks as control flow progresses.
  testHooks = {};
}

// Define runAfterPreTxAuth — core behavior for this module.
export async function runAfterPreTxAuth(ctx: {
  // Set sectorId on the structure being built.
  sectorId: string;
  // Set scope on the structure being built.
  scope: DataScope;
// Run next step: }): Promise<void> {
}): Promise<void> {
  // Branch when this condition holds so the right path runs.
  if (testHooks.afterPreTxAuth) {
    // Wait for the async step before continuing.
    await testHooks.afterPreTxAuth(ctx);
  }
}

// Define runAfterSectorLocked — core behavior for this module.
export async function runAfterSectorLocked(ctx: {
  // Set sectorId on the structure being built.
  sectorId: string;
  // Set scope on the structure being built.
  scope: DataScope;
  // Set tx on the structure being built.
  tx: Tx;
// Run next step: }): Promise<void> {
}): Promise<void> {
  // Branch when this condition holds so the right path runs.
  if (testHooks.afterSectorLocked) {
    // Wait for the async step before continuing.
    await testHooks.afterSectorLocked(ctx);
  }
}

// Define runAfterAccessRechecked — core behavior for this module.
export async function runAfterAccessRechecked(ctx: {
  // Set sectorId on the structure being built.
  sectorId: string;
  // Set scope on the structure being built.
  scope: DataScope;
  // Set tx on the structure being built.
  tx: Tx;
// Run next step: }): Promise<void> {
}): Promise<void> {
  // Branch when this condition holds so the right path runs.
  if (testHooks.afterAccessRechecked) {
    // Wait for the async step before continuing.
    await testHooks.afterAccessRechecked(ctx);
  }
}
