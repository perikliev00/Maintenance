// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Type-only import from @prisma/client for compile-time contracts.
import type { Prisma, PrismaClient } from "@prisma/client";

// Shape LockDiag documents the fixture/response fields this suite touches.
type LockDiag = {
  // Concurrency/isolation step for the race under test.
  blockedByBarrier: number;
  // Execute the next setup or assertion step for this scenario.
  waiters: Array<{
    // Execute the next setup or assertion step for this scenario.
    pid: number;
    // Execute the next setup or assertion step for this scenario.
    state: string | null;
    // Execute the next setup or assertion step for this scenario.
    waitEventType: string | null;
    // Execute the next setup or assertion step for this scenario.
    waitEvent: string | null;
    // Execute the next setup or assertion step for this scenario.
    query: string | null;
  // Execute the next setup or assertion step for this scenario.
  }>;
  // Concurrency/isolation step for the race under test.
  blockingEdges: Array<{
    // Execute the next setup or assertion step for this scenario.
    pid: number;
    // Concurrency/isolation step for the race under test.
    blockedBy: number[];
  // Execute the next setup or assertion step for this scenario.
  }>;
};

/**
 * Backends whose blocking chain reaches `blockerPid`, including soft blockers
 * queued behind an earlier waiter on the same lock. Direct `pg_blocking_pids`
 * alone under-counts parallel advisory waiters.
 */
export async function listBlockedBehind(
  // Execute the next setup or assertion step for this scenario.
  db: PrismaClient,
  // Concurrency/isolation step for the race under test.
  blockerPid: number,
// Execute the next setup or assertion step for this scenario.
): Promise<number[]> {
  // rows: synchronize actors so the race window is observable.
  const rows = await db.$queryRaw<{ pid: number }[]>`
    WITH RECURSIVE blocked AS (
      SELECT pid
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> ${blockerPid}
        AND ${blockerPid} = ANY (pg_blocking_pids(pid))
      UNION
      SELECT a.pid
      FROM pg_stat_activity a
      INNER JOIN blocked b ON b.pid = ANY (pg_blocking_pids(a.pid))
      WHERE a.datname = current_database()
        AND a.pid <> ${blockerPid}
    )
    SELECT DISTINCT pid::int AS pid
    FROM blocked
    WHERE EXISTS (
      SELECT 1
      FROM pg_stat_activity s
      WHERE s.pid = blocked.pid
        AND s.wait_event_type = 'Lock'
    )
  `;
  // Return the arranged value/result to the caller.
  return rows.map((r) => r.pid);
}

/** Count sessions whose blocking chain reaches the barrier holder pid. */
async function countBlockedBehind(
  // Execute the next setup or assertion step for this scenario.
  db: PrismaClient,
  // Concurrency/isolation step for the race under test.
  barrierPid: number,
// Execute the next setup or assertion step for this scenario.
): Promise<number> {
  // Return the arranged value/result to the caller.
  return (await listBlockedBehind(db, barrierPid)).length;
}

/** Poll until at least `count` Lock waiters sit behind `blockerPid`. */
export async function waitForBlockedBehind(
  // Execute the next setup or assertion step for this scenario.
  db: PrismaClient,
  // Concurrency/isolation step for the race under test.
  blockerPid: number,
  // Execute the next setup or assertion step for this scenario.
  count = 1,
  // Execute the next setup or assertion step for this scenario.
  timeoutMs = 15_000,
// Execute the next setup or assertion step for this scenario.
): Promise<number[]> {
  // deadline: bound how long the wait/poll may run.
  const deadline = Date.now() + timeoutMs;
  // Repeat/poll to widen the race window or wait for lock waiters.
  while (Date.now() < deadline) {
    // pids: synchronize actors so the race window is observable.
    const pids = await listBlockedBehind(db, blockerPid);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (pids.length >= count) return pids;
    // Brief yield so lock waiters/UI can settle before asserting.
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  // Fail fast when the expected race/waiter condition never appears.
  assert.fail(
    // Concurrency/isolation step for the race under test.
    `No PostgreSQL waiter blocked by backend ${blockerPid} (need ≥${count}, transitive queue)`,
  );
}

// Helper lockDiagnostics: concurrency/isolation coordination.
async function lockDiagnostics(
  // Execute the next setup or assertion step for this scenario.
  db: PrismaClient,
  // Concurrency/isolation step for the race under test.
  barrierPid: number,
// Concurrency/isolation step for the race under test.
): Promise<LockDiag> {
  // waiters: repetition count to amplify race windows.
  const waiters = await db.$queryRaw<
    // Execute the next setup or assertion step for this scenario.
    Array<{
      // Execute the next setup or assertion step for this scenario.
      pid: number;
      // Execute the next setup or assertion step for this scenario.
      state: string | null;
      // Execute the next setup or assertion step for this scenario.
      waitEventType: string | null;
      // Execute the next setup or assertion step for this scenario.
      waitEvent: string | null;
      // Execute the next setup or assertion step for this scenario.
      query: string | null;
    }>
  >`
    WITH RECURSIVE blocked(pid) AS (
      SELECT pid FROM pg_stat_activity
      WHERE datname = current_database()
        AND ${barrierPid} = ANY (pg_blocking_pids(pid))
      UNION
      SELECT a.pid
      FROM pg_stat_activity a
      JOIN blocked b ON b.pid = ANY (pg_blocking_pids(a.pid))
      WHERE a.datname = current_database()
    )
    SELECT a.pid,
           a.state,
           a.wait_event_type AS "waitEventType",
           a.wait_event AS "waitEvent",
           left(a.query, 240) AS query
    FROM pg_stat_activity a
    JOIN blocked b ON b.pid = a.pid
    WHERE a.datname = current_database()
  `;
  // blockingEdges: synchronize actors so the race window is observable.
  const blockingEdges = await db.$queryRaw<
    // Concurrency/isolation step for the race under test.
    Array<{ pid: number; blockedBy: number[] }>
  >`
    SELECT pid, pg_blocking_pids(pid) AS "blockedBy"
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND cardinality(pg_blocking_pids(pid)) > 0
  `;
  // Return the arranged value/result to the caller.
  return {
    // Concurrency/isolation step for the race under test.
    blockedByBarrier: waiters.length,
    // Execute the next setup or assertion step for this scenario.
    waiters,
    // Concurrency/isolation step for the race under test.
    blockingEdges,
  };
}

/** Hold a real PostgreSQL lock until the requested operations are observed
 * waiting on it (directly or through another waiter). Sleeps only poll DB
 * evidence; elapsed time alone never releases the barrier. */
export async function withDatabaseBarrier<T>(
  // Execute the next setup or assertion step for this scenario.
  db: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  acquire: (tx: Prisma.TransactionClient) => Promise<unknown>,
  // Execute the next setup or assertion step for this scenario.
  run: (waitFor: (count: number) => Promise<void>) => Promise<T>,
  // Execute the next setup or assertion step for this scenario.
  waiterCount = 2,
// Execute the next setup or assertion step for this scenario.
): Promise<T> {
  // Execute the next setup or assertion step for this scenario.
  let release!: () => void;
  // Execute the next setup or assertion step for this scenario.
  let ready!: (pid: number) => void;
  // Execute the next setup or assertion step for this scenario.
  let failReady!: (error: unknown) => void;
  // Bind gate for later setup or assertions in this scope.
  const gate = new Promise<void>((resolve) => {
    // Execute the next setup or assertion step for this scenario.
    release = resolve;
  });
  // Bind held for later setup or assertions in this scope.
  const held = new Promise<number>((resolve, reject) => {
    // Execute the next setup or assertion step for this scenario.
    ready = resolve;
    // Execute the next setup or assertion step for this scenario.
    failReady = reject;
  });
  // Bind holder for later setup or assertions in this scope.
  const holder = db.$transaction(
    // Execute the next setup or assertion step for this scenario.
    async (tx) => {
      // Await async work before asserting or releasing locks.
      const [row] = await tx.$queryRaw<{ pid: number }[]>`
        SELECT pg_backend_pid() AS pid
      `;
      // Await async work before asserting or releasing locks.
      await acquire(tx);
      // Execute the next setup or assertion step for this scenario.
      ready(row!.pid);
      // Await async work before asserting or releasing locks.
      await gate;
    },
    // Runner option controlling stability or isolation of the suite.
    { timeout: 20_000, maxWait: 20_000 },
  );
  // Fire-and-await side effect required before the next assertion.
  void holder.catch(failReady);
  // Execute the next setup or assertion step for this scenario.
  let operation: Promise<T> | undefined;
  // Execute the next setup or assertion step for this scenario.
  let operationSettled: PromiseSettledResult<T> | undefined;
  // Try path where partial failure must not leak suite state.
  try {
    // pid: unique stamp so parallel runs do not collide.
    const pid = await held;
    // Bind waitFor for later setup or assertions in this scope.
    const waitFor = async (count: number) => {
      // deadline: bound how long the wait/poll may run.
      const deadline = Date.now() + 15_000;
      // Repeat/poll to widen the race window or wait for lock waiters.
      while (Date.now() < deadline) {
        // Conditional path for setup, cleanup, or alternate outcomes.
        if ((await countBlockedBehind(db, pid)) >= count) return;
        // Brief yield so lock waiters/UI can settle before asserting.
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      // diag: synchronize actors so the race window is observable.
      const diag = await lockDiagnostics(db, pid);
      // Bind opSummary for later setup or assertions in this scope.
      const opSummary =
        // Execute the next setup or assertion step for this scenario.
        operationSettled === undefined
          ? "operations still pending (no settlement yet)"
          : JSON.stringify(operationSettled, replaceErrors, 2);
      // Fail fast when the expected race/waiter condition never appears.
      assert.fail(
        // Concurrency/isolation step for the race under test.
        `expected ${count} PostgreSQL lock waiters behind barrier pid ${pid}; ` +
          // Concurrency/isolation step for the race under test.
          `observed ${diag.blockedByBarrier}.\n` +
          // Concurrency/isolation step for the race under test.
          `lockDiagnostics=${JSON.stringify(diag, null, 2)}\n` +
          // Execute the next setup or assertion step for this scenario.
          `operationSettlement=${opSummary}`,
      );
    };
    // Execute the next setup or assertion step for this scenario.
    operation = run(waitFor);
    // Observe rejection immediately while gathering lock evidence.
    const tracked = operation.then(
      // Execute the next setup or assertion step for this scenario.
      (value) => {
        // Execute the next setup or assertion step for this scenario.
        operationSettled = { status: "fulfilled", value };
        // Return the arranged value/result to the caller.
        return value;
      },
      // Execute the next setup or assertion step for this scenario.
      (reason) => {
        // Execute the next setup or assertion step for this scenario.
        operationSettled = { status: "rejected", reason };
        // Surface a hard failure when isolation or contract is violated.
        throw reason;
      },
    );
    // Fire-and-await side effect required before the next assertion.
    void tracked.catch(() => undefined);
    // Await async work before asserting or releasing locks.
    await waitFor(waiterCount);
    // Execute the next setup or assertion step for this scenario.
    release();
    // Await async work before asserting or releasing locks.
    await holder;
    // Return the arranged value/result to the caller.
    return await tracked;
  // Execute the next setup or assertion step for this scenario.
  } finally {
    // Execute the next setup or assertion step for this scenario.
    release();
    // Await async work before asserting or releasing locks.
    await holder.catch(() => undefined);
    // Drain started operations even when barrier evidence fails.
    if (operation) await operation.catch(() => undefined);
  }
}

// Local helper replaceErrors used by cases in this file.
function replaceErrors(_key: string, value: unknown): unknown {
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (value instanceof Error) {
    // Return the arranged value/result to the caller.
    return {
      // Fixture field name for the seeded actor/entity.
      name: value.name,
      // Execute the next setup or assertion step for this scenario.
      message: value.message,
      // Continue the call chain for setup or assertion detail.
      ...(value as { code?: string; status?: number }),
    };
  }
  // Return the arranged value/result to the caller.
  return value;
}

/** Queue the first operation before starting the second. PostgreSQL lock
 * waiters queue behind the conflicting holder; assertions still require the
 * requested winner and coherent final domain state. */
export async function orderedDatabaseRace(
  // Execute the next setup or assertion step for this scenario.
  db: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  acquire: (tx: Prisma.TransactionClient) => Promise<unknown>,
  // Execute the next setup or assertion step for this scenario.
  first: () => Promise<unknown>,
  // Execute the next setup or assertion step for this scenario.
  second: () => Promise<unknown>,
// Execute the next setup or assertion step for this scenario.
) {
  // Return the arranged value/result to the caller.
  return withDatabaseBarrier(db, acquire, async (waitFor) => {
    // Bind a for later setup or assertions in this scope.
    const a = first();
    // Fire-and-await side effect required before the next assertion.
    void a.catch(() => undefined);
    // Await async work before asserting or releasing locks.
    await waitFor(1);
    // Bind b for later setup or assertions in this scope.
    const b = second();
    // Return the arranged value/result to the caller.
    return Promise.allSettled([a, b]);
  });
}
