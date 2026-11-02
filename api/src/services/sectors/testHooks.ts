/**
 * Test-only barriers for sector mutation concurrency (BUG-11 / BUG-12).
 * Production code never sets these hooks.
 */
import type { DataScope } from "../dataScope";
import type { Tx } from "../db/types";

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

let testHooks: SectorMutationTestHooks = {};

/** Install deterministic mid-mutation barriers (tests only). */
export function setSectorMutationTestHooks(
  hooks: SectorMutationTestHooks,
): void {
  testHooks = hooks;
}

/** Clear barriers — call from after()/finally. */
export function resetSectorMutationTestHooks(): void {
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
