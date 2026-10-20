import assert from "node:assert/strict";
import type { Prisma, PrismaClient } from "@prisma/client";

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
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const held = new Promise<number>((resolve, reject) => { ready = resolve; failReady = reject; });
  const holder = db.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    await acquire(tx);
    ready(row!.pid);
    await gate;
  }, { timeout: 20_000, maxWait: 20_000 });
  void holder.catch(failReady);
  let operation: Promise<T> | undefined;
  try {
    const pid = await held;
    const waitFor = async (count: number) => {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const [row] = await db.$queryRaw<{ count: number }[]>`
          WITH RECURSIVE blocked(pid) AS (
            SELECT pid FROM pg_stat_activity
            WHERE datname = current_database() AND ${pid} = ANY(pg_blocking_pids(pid))
            UNION
            SELECT a.pid FROM pg_stat_activity a JOIN blocked b
              ON b.pid = ANY(pg_blocking_pids(a.pid))
            WHERE a.datname = current_database()
          ) SELECT count(*)::int AS count FROM blocked
        `;
        if ((row?.count ?? 0) >= count) return;
        // Row-level waiters sometimes show as Lock waits / ungranted locks
        // without an immediate pg_blocking_pids edge (transactionid waits).
        const [lockWaits] = await db.$queryRaw<{ count: number }[]>`
          SELECT count(*)::int AS count
          FROM pg_stat_activity
          WHERE wait_event_type = 'Lock'
            AND datname = current_database()
            AND pid <> pg_backend_pid()
            AND pid <> ${pid}
        `;
        const [ungranted] = await db.$queryRaw<{ count: number }[]>`
          SELECT count(*)::int AS count FROM pg_locks WHERE NOT granted
        `;
        if (
          (lockWaits?.count ?? 0) >= count ||
          (ungranted?.count ?? 0) >= count
        ) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.fail(`expected ${count} PostgreSQL lock waiters behind barrier pid ${pid}`);
    };
    operation = run(waitFor);
    // Observe rejection immediately while gathering lock evidence.
    void operation.catch(() => undefined);
    await waitFor(waiterCount);
    release();
    await holder;
    return await operation;
  } finally {
    release();
    await holder.catch(() => undefined);
    // Drain started operations even when barrier evidence fails.
    if (operation) await operation.catch(() => undefined);
  }
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
    void a.catch(() => undefined);
    await waitFor(1);
    const b = second();
    return Promise.allSettled([a, b]);
  });
}
