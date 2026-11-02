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
    data: { jobKey, status: "running" },
  });
  // Open Audit jobs panels can show "Running" without waiting for finish.
  publish("jobs.changed", {});
  return row;
}

/** Mark a JobRun finished with optional JSON summary and error message. */
export async function finishJobRun(
  id: string,
  status: "ok" | "error",
  summary?: Prisma.InputJsonValue,
  error?: string,
) {
  // Stamp finishedAt and store summary/error for the jobs panel.
  // summary is omitted when undefined; error cleared only when not passed.
  const row = await prisma.jobRun.update({
    where: { id },
    data: {
      status,
      finishedAt: new Date(),
      summary: summary ?? undefined,
      error: error ?? null,
    },
  });
  // Global ping — AuditPage refreshes the runs table without waiting for a
  // domain event that may never fire (zero-result / non-domain jobs).
  publish("jobs.changed", {});
  return row;
}

type JobRunLifecycleDeps = {
  startJobRun?: (jobKey: string) => Promise<{ id: string }>;
  finishJobRun?: (
    id: string,
    status: "ok" | "error",
    summary?: Prisma.InputJsonValue,
    error?: string,
  ) => Promise<unknown>;
};

function isPlainObjectSummary(value: unknown): value is Prisma.InputJsonValue {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

/**
 * Start a JobRun, run `body`, finish ok/error. Plain-object results become the
 * JobRun summary. Injectable deps support unit tests (e.g. lockInactive).
 */
export async function withJobRun<T>(
  jobKey: string,
  body: () => Promise<T>,
  deps: JobRunLifecycleDeps = {},
): Promise<T> {
  const start = deps.startJobRun ?? startJobRun;
  const finish = deps.finishJobRun ?? finishJobRun;
  const run = await start(jobKey);
  try {
    const result = await body();
    const summary = isPlainObjectSummary(result) ? result : undefined;
    await finish(run.id, "ok", summary);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finish(run.id, "error", undefined, message);
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
  olderThanMs = DEFAULT_STALE_JOB_RUN_MS,
): Promise<number> {
  const cutoff = new Date(Date.now() - Math.max(0, olderThanMs));
  const result = await prisma.jobRun.updateMany({
    where: {
      status: "running",
      startedAt: { lte: cutoff },
    },
    data: {
      status: "error",
      finishedAt: new Date(),
      error: "Abandoned after process interrupt/restart",
    },
  });
  if (result.count > 0) {
    publish("jobs.changed", {});
  }
  return result.count;
}

/** Recent job runs newest-first; limit clamped to 1..200 (default 50). */
export async function listJobRuns(limit = 50) {
  // Clamp take so callers cannot request unbounded history.
  return prisma.jobRun.findMany({
    orderBy: { startedAt: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
  });
}
