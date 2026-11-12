import assert from "node:assert/strict";
import type { Prisma, PrismaClient } from "@prisma/client";

// Shape LockDiag documents the fixture/response fields this suite touches.
type LockDiag = {
  blockedByBarrier: number;
  waiters: Array<{
    pid: number;
    state: string | null;
    waitEventType: string | null;
    waitEvent: string | null;
    query: string | null;
  }>;
  blockingEdges: Array<{
    pid: number;
    blockedBy: number[];
  }>;
};

/**
 * Backends whose blocking chain reaches `blockerPid`, including soft blockers
 * queued behind an earlier waiter on the same lock. Direct `pg_blocking_pids`
 * alone under-counts parallel advisory waiters.
 */
export async function listBlockedBehind(
  db: PrismaClient,
  blockerPid: number,
): Promise<number[]> {
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
  return rows.map((r) => r.pid);
}

/** Count sessions whose blocking chain reaches the barrier holder pid. */
async function countBlockedBehind(
  db: PrismaClient,
  barrierPid: number,
): Promise<number> {
  return (await listBlockedBehind(db, barrierPid)).length;
}

/** Poll until at least `count` Lock waiters sit behind `blockerPid`. */
export async function waitForBlockedBehind(
  db: PrismaClient,
  blockerPid: number,
  count = 1,
  timeoutMs = 15_000,
): Promise<number[]> {
  // deadline: bound how long the wait/poll may run.
  const deadline = Date.now() + timeoutMs;
  // Repeat/poll to widen the race window or wait for lock waiters.
  while (Date.now() < deadline) {
    const pids = await listBlockedBehind(db, blockerPid);
    if (pids.length >= count) return pids;
    // Brief yield so lock waiters/UI can settle before asserting.
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  // Fail fast when the expected race/waiter condition never appears.
  assert.fail(
    `No PostgreSQL waiter blocked by backend ${blockerPid} (need ≥${count}, transitive queue)`,
  );
}

// Helper lockDiagnostics: concurrency/isolation coordination.
async function lockDiagnostics(
  db: PrismaClient,
  barrierPid: number,
): Promise<LockDiag> {
  // waiters: repetition count to amplify race windows.
  const waiters = await db.$queryRaw<
    Array<{
      pid: number;
      state: string | null;
      waitEventType: string | null;
      waitEvent: string | null;
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
  const blockingEdges = await db.$queryRaw<
    Array<{ pid: number; blockedBy: number[] }>
  >`
    SELECT pid, pg_blocking_pids(pid) AS "blockedBy"
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND cardinality(pg_blocking_pids(pid)) > 0
  `;
  return {
    blockedByBarrier: waiters.length,
    waiters,
    blockingEdges,
  };
}

/** Hold a real PostgreSQL lock until the requested operations are observed
 * waiting on it (directly or through another waiter). Sleeps only poll DB
 * evidence; elapsed time alone never releases the barrier. */
export async function withDatabaseBarrier<T>(
  db: PrismaClient,
  acquire: (tx: Prisma.TransactionClient) => Promise<unknown>,
  run: (waitFor: (count: number) => Promise<void>) => Promise<T>,
  waiterCount = 2,
): Promise<T> {
  let release!: () => void;
  let ready!: (pid: number) => void;
  let failReady!: (error: unknown) => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const held = new Promise<number>((resolve, reject) => {
    ready = resolve;
    failReady = reject;
  });
  const holder = db.$transaction(
    async (tx) => {
      const [row] = await tx.$queryRaw<{ pid: number }[]>`
        SELECT pg_backend_pid() AS pid
      `;
      await acquire(tx);
      ready(row!.pid);
      await gate;
    },
    { timeout: 20_000, maxWait: 20_000 },
  );
  // Fire-and-await side effect required before the next assertion.
  void holder.catch(failReady);
  let operation: Promise<T> | undefined;
  let operationSettled: PromiseSettledResult<T> | undefined;
  try {
    const pid = await held;
    const waitFor = async (count: number) => {
      // deadline: bound how long the wait/poll may run.
      const deadline = Date.now() + 15_000;
      // Repeat/poll to widen the race window or wait for lock waiters.
      while (Date.now() < deadline) {
        if ((await countBlockedBehind(db, pid)) >= count) return;
        // Brief yield so lock waiters/UI can settle before asserting.
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const diag = await lockDiagnostics(db, pid);
      const opSummary =
        operationSettled === undefined
          ? "operations still pending (no settlement yet)"
          : JSON.stringify(operationSettled, replaceErrors, 2);
      // Fail fast when the expected race/waiter condition never appears.
      assert.fail(
        `expected ${count} PostgreSQL lock waiters behind barrier pid ${pid}; ` +
          `observed ${diag.blockedByBarrier}.\n` +
          `lockDiagnostics=${JSON.stringify(diag, null, 2)}\n` +
          `operationSettlement=${opSummary}`,
      );
    };
    operation = run(waitFor);
    // Observe rejection immediately while gathering lock evidence.
    const tracked = operation.then(
      (value) => {
        operationSettled = { status: "fulfilled", value };
        return value;
      },
      (reason) => {
        operationSettled = { status: "rejected", reason };
        // Surface a hard failure when isolation or contract is violated.
        throw reason;
      },
    );
    // Fire-and-await side effect required before the next assertion.
    void tracked.catch(() => undefined);
    await waitFor(waiterCount);
    release();
    await holder;
    return await tracked;
  } finally {
    release();
    await holder.catch(() => undefined);
    // Drain started operations even when barrier evidence fails.
    if (operation) await operation.catch(() => undefined);
  }
}

// Local helper replaceErrors used by cases in this file.
function replaceErrors(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(value as { code?: string; status?: number }),
    };
  }
  return value;
}

/** Queue the first operation before starting the second. PostgreSQL lock
 * waiters queue behind the conflicting holder; assertions still require the
 * requested winner and coherent final domain state. */
export async function orderedDatabaseRace(
  db: PrismaClient,
  acquire: (tx: Prisma.TransactionClient) => Promise<unknown>,
  first: () => Promise<unknown>,
  second: () => Promise<unknown>,
) {
  return withDatabaseBarrier(db, acquire, async (waitFor) => {
    const a = first();
    // Fire-and-await side effect required before the next assertion.
    void a.catch(() => undefined);
    await waitFor(1);
    const b = second();
    return Promise.allSettled([a, b]);
  });
}
