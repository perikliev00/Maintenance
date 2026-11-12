/**
 * Persist JobRun start/finish rows for ops visibility into background work.
 */
import { Prisma } from "@prisma/client";
// Shared DB client for JobRun create/update/list.
import { prisma } from "../../db";
// Notify open Audit / jobs panels when a run leaves "running".
import { publish } from "../../events/bus";

/** Create a `running` JobRun row for `jobKey`. */
export async function startJobRun(jobKey: string) {
  // Insert with status running; finishedAt left null until finishJobRun.
  const row = await prisma.jobRun.create({
    // Set data on the structure being built.
    data: { jobKey, status: "running" },
  });
  // Open Audit jobs panels can show "Running" without waiting for finish.
  publish("jobs.changed", {});
  // Return the computed result to the caller.
  return row;
}

/** Mark a JobRun finished with optional JSON summary and error message. */
export async function finishJobRun(
  // Set id on the structure being built.
  id: string,
  // Set status on the structure being built.
  status: "ok" | "error",
  // Run next step: summary?: Prisma.InputJsonValue,
  summary?: Prisma.InputJsonValue,
  // Run next step: error?: string,
  error?: string,
// Run next step: ) {
) {
  // Stamp finishedAt and store summary/error for the jobs panel.
  // summary is omitted when undefined; error cleared only when not passed.
  const row = await prisma.jobRun.update({
    // Set where on the structure being built.
    where: { id },
    // Set data on the structure being built.
    data: {
      // Run next step: status,
      status,
      // Set finishedAt on the structure being built.
      finishedAt: new Date(),
      // Set summary on the structure being built.
      summary: summary ?? undefined,
      // Set error on the structure being built.
      error: error ?? null,
    },
  });
  // Global ping — AuditPage refreshes the runs table without waiting for a
  // domain event that may never fire (zero-result / non-domain jobs).
  publish("jobs.changed", {});
  // Return the computed result to the caller.
  return row;
}

// Declare type JobRunLifecycleDeps for callers and internals.
type JobRunLifecycleDeps = {
  // Run next step: startJobRun?: (jobKey: string) => Promise<{ id: string }>;
  startJobRun?: (jobKey: string) => Promise<{ id: string }>;
  // Run next step: finishJobRun?: (
  finishJobRun?: (
    // Set id on the structure being built.
    id: string,
    // Set status on the structure being built.
    status: "ok" | "error",
    // Run next step: summary?: Prisma.InputJsonValue,
    summary?: Prisma.InputJsonValue,
    // Run next step: error?: string,
    error?: string,
  // Run next step: ) => Promise<unknown>;
  ) => Promise<unknown>;
};

// Define isPlainObjectSummary — core behavior for this module.
function isPlainObjectSummary(value: unknown): value is Prisma.InputJsonValue {
  // Return the computed result to the caller.
  return (
    // Run next step: value !== null &&
    value !== null &&
    // Run next step: typeof value === "object" &&
    typeof value === "object" &&
    // Run next step: !Array.isArray(value) &&
    !Array.isArray(value) &&
    // Run next step: !(value instanceof Date)
    !(value instanceof Date)
  );
}

/**
 * Start a JobRun, run `body`, finish ok/error. Plain-object results become the
 * JobRun summary. Injectable deps support unit tests (e.g. lockInactive).
 */
export async function withJobRun<T>(
  // Set jobKey on the structure being built.
  jobKey: string,
  // Set body on the structure being built.
  body: () => Promise<T>,
  // Set deps on the structure being built.
  deps: JobRunLifecycleDeps = {},
// Run next step: ): Promise<T> {
): Promise<T> {
  // Capture start for use in this scope.
  const start = deps.startJobRun ?? startJobRun;
  // Capture finish for use in this scope.
  const finish = deps.finishJobRun ?? finishJobRun;
  // Load run asynchronously for the next steps.
  const run = await start(jobKey);
  // Attempt the fallible work so errors can be handled below.
  try {
    // Load result asynchronously for the next steps.
    const result = await body();
    // Capture summary for use in this scope.
    const summary = isPlainObjectSummary(result) ? result : undefined;
    // Wait for the async step before continuing.
    await finish(run.id, "ok", summary);
    // Return the computed result to the caller.
    return result;
  // Run next step: } catch (err) {
  } catch (err) {
    // Capture message for use in this scope.
    const message = err instanceof Error ? err.message : String(err);
    // Wait for the async step before continuing.
    await finish(run.id, "error", undefined, message);
    // Abort with an error so callers can react.
    throw err;
  }
}

/**
 * Age before a `running` JobRun is treated as orphaned (crash / killed worker).
 *
 * Policy:
 * - Multi-instance safe: never abandons another live process's fresh runs.
 * - Scheduler sweeps on boot and on every interval tick (see `startJobScheduler`),
 *   so orphans clear within ~TTL + one interval after a crash — not only on restart.
 * - Keep TTL well above the longest expected job; shorten only with measured job times.
 */
export const DEFAULT_STALE_JOB_RUN_MS = 30 * 60 * 1000;

/**
 * Mark orphaned `running` JobRun rows as errors when older than `olderThanMs`.
 * Default threshold keeps concurrent API instances from killing each other's
 * in-flight runs; periodic scheduler sweeps clear stuck rows after the TTL.
 * @returns How many rows were closed.
 */
export async function abandonStaleRunningJobRuns(
  // Update older than ms as control flow progresses.
  olderThanMs = DEFAULT_STALE_JOB_RUN_MS,
// Run next step: ): Promise<number> {
): Promise<number> {
  // Capture cutoff for use in this scope.
  const cutoff = new Date(Date.now() - Math.max(0, olderThanMs));
  // Load result asynchronously for the next steps.
  const result = await prisma.jobRun.updateMany({
    // Set where on the structure being built.
    where: {
      // Set status on the structure being built.
      status: "running",
      // Set startedAt on the structure being built.
      startedAt: { lte: cutoff },
    },
    // Set data on the structure being built.
    data: {
      // Set status on the structure being built.
      status: "error",
      // Set finishedAt on the structure being built.
      finishedAt: new Date(),
      // Set error on the structure being built.
      error: "Abandoned after process interrupt/restart",
    },
  });
  // Branch when this condition holds so the right path runs.
  if (result.count > 0) {
    // Run next step: publish("jobs.changed", {});
    publish("jobs.changed", {});
  }
  // Return the computed result to the caller.
  return result.count;
}

/** Recent job runs newest-first; limit clamped to 1..200 (default 50). */
export async function listJobRuns(limit = 50) {
  // Clamp take so callers cannot request unbounded history.
  return prisma.jobRun.findMany({
    // Set orderBy on the structure being built.
    orderBy: { startedAt: "desc" },
    // Set take on the structure being built.
    take: Math.min(Math.max(limit, 1), 200),
  });
}
