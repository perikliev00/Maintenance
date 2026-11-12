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

// Capture active execution for use in this scope.
let activeExecution: Promise<unknown> | null = null;

/** Force a single pooled connection so session advisory locks stay on one backend. */
export function advisoryLockDatabaseUrl(
  // Set url on the structure being built.
  url: string | undefined,
// Run next step: ): string | undefined {
): string | undefined {
  // Branch when this condition holds so the right path runs.
  if (!url?.trim()) return undefined;
  // Capture parsed for use in this scope.
  const parsed = new URL(url);
  // Store a keyed value for later lookup.
  parsed.searchParams.set("connection_limit", "1");
  // Capture out for use in this scope.
  let out = parsed.toString();
  // Branch when this condition holds so the right path runs.
  if (url.startsWith("postgresql://") && out.startsWith("postgres://")) {
    // Update out as control flow progresses.
    out = `postgresql://${out.slice("postgres://".length)}`;
  // Run next step: } else if (
  } else if (
    // Run next step: url.startsWith("postgresql://") &&
    url.startsWith("postgresql://") &&
    // Run next step: !out.startsWith("postgresql://")
    !out.startsWith("postgresql://")
  // Run next step: ) {
  ) {
    // Update out as control flow progresses.
    out = out.replace(/^https?:\/\//, "postgresql://");
  }
  // Return the computed result to the caller.
  return out;
}

/**
 * Single-process guard shared by scheduled and operator-triggered job runs.
 * Also acquires a session-level Postgres advisory lock on a dedicated
 * connection_limit=1 client so a second process/instance returns
 * `{ acquired: false }` instead of racing.
 */
export async function runWithJobExecutionLock<T>(
  // Set run on the structure being built.
  run: () => Promise<T>,
// Run next step: ): Promise<{ acquired: true; value: T } | { acquired: false …
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  // Branch when this condition holds so the right path runs.
  if (activeExecution) return { acquired: false };

  // Capture lock url for use in this scope.
  const lockUrl = advisoryLockDatabaseUrl(process.env.DATABASE_URL);
  // Capture lock client for use in this scope.
  const lockClient = new PrismaClient(
    // Run next step: lockUrl ? { datasources: { db: { url: lockUrl } } } : undefi…
    lockUrl ? { datasources: { db: { url: lockUrl } } } : undefined,
  );
  // Attempt the fallible work so errors can be handled below.
  try {
    // Load rows asynchronously for the next steps.
    const rows = await lockClient.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_lock(${JOB_EXECUTION_ADVISORY_KEY}) AS locked
    `;
    // Branch when this condition holds so the right path runs.
    if (!rows[0]?.locked) {
      // Return the computed result to the caller.
      return { acquired: false };
    }

    // Capture execution for use in this scope.
    const execution = Promise.resolve().then(run);
    // Update active execution as control flow progresses.
    activeExecution = execution;
    // Attempt the fallible work so errors can be handled below.
    try {
      // Return the computed result to the caller.
      return { acquired: true, value: await execution };
    // Run next step: } finally {
    } finally {
      // Branch when this condition holds so the right path runs.
      if (activeExecution === execution) activeExecution = null;
      // Attempt the fallible work so errors can be handled below.
      try {
        // Wait for the async step before continuing.
        await lockClient.$executeRaw`
          SELECT pg_advisory_unlock(${JOB_EXECUTION_ADVISORY_KEY})
        `;
      // Run next step: } catch {
      } catch {
        /* unlock best-effort; disconnect releases session locks */
      }
    }
  // Run next step: } finally {
  } finally {
    // Wait for the async step before continuing.
    await lockClient.$disconnect().catch(() => undefined);
  }
}

// Define waitForJobExecution — core behavior for this module.
export async function waitForJobExecution() {
  // Wait for the async step before continuing.
  await activeExecution;
}
