/**
 * Shared job-execution lock: in-process fast path + Postgres advisory lock so
 * multiple API instances cannot run overlapping scheduled/manual job cycles.
 *
 * Deployment assumptions (session advisory locks):
 * - Direct Postgres (or session-pooling). PgBouncer transaction pooling breaks this.
 * - Lock client uses connection_limit=1 so try_lock / unlock / hold share one backend session.
 * - Job duration should stay under the pool/server idle timeout that would drop that session.
 */
import { PrismaClient } from "@prisma/client";

/** Stable int key for pg_try_advisory_lock (jobs coordinator). */
export const JOB_EXECUTION_ADVISORY_KEY = 87_201_501;

let activeExecution: Promise<unknown> | null = null;

/** Force a single pooled connection so session advisory locks stay on one backend. */
export function advisoryLockDatabaseUrl(
  url: string | undefined,
): string | undefined {
  if (!url?.trim()) return undefined;
  const parsed = new URL(url);
  parsed.searchParams.set("connection_limit", "1");
  let out = parsed.toString();
  if (url.startsWith("postgresql://") && out.startsWith("postgres://")) {
    out = `postgresql://${out.slice("postgres://".length)}`;
  } else if (
    url.startsWith("postgresql://") &&
    !out.startsWith("postgresql://")
  ) {
    out = out.replace(/^https?:\/\//, "postgresql://");
  }
  return out;
}

/**
 * Single-process guard shared by scheduled and operator-triggered job runs.
 * Also acquires a session-level Postgres advisory lock on a dedicated
 * connection_limit=1 client so a second process/instance returns
 * `{ acquired: false }` instead of racing.
 */
export async function runWithJobExecutionLock<T>(
  run: () => Promise<T>,
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  if (activeExecution) return { acquired: false };

  const lockUrl = advisoryLockDatabaseUrl(process.env.DATABASE_URL);
  const lockClient = new PrismaClient(
    lockUrl ? { datasources: { db: { url: lockUrl } } } : undefined,
  );
  try {
    const rows = await lockClient.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_lock(${JOB_EXECUTION_ADVISORY_KEY}) AS locked
    `;
    if (!rows[0]?.locked) {
      return { acquired: false };
    }

    const execution = Promise.resolve().then(run);
    activeExecution = execution;
    try {
      return { acquired: true, value: await execution };
    } finally {
      if (activeExecution === execution) activeExecution = null;
      try {
        await lockClient.$executeRaw`
          SELECT pg_advisory_unlock(${JOB_EXECUTION_ADVISORY_KEY})
        `;
      } catch {
        /* unlock best-effort; disconnect releases session locks */
      }
    }
  } finally {
    await lockClient.$disconnect().catch(() => undefined);
  }
}

export async function waitForJobExecution() {
  await activeExecution;
}
