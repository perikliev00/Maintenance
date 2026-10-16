/**
 * Persist JobRun start/finish rows for ops visibility into background work.
 */
import { Prisma } from "@prisma/client";
// Shared DB client for JobRun create/update/list.
import { prisma } from "../../db";

/** Create a `running` JobRun row for `jobKey`. */
export async function startJobRun(jobKey: string) {
  // Insert with status running; finishedAt left null until finishJobRun.
  return prisma.jobRun.create({
    data: { jobKey, status: "running" },
  });
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
  return prisma.jobRun.update({
    where: { id },
    data: {
      status,
      finishedAt: new Date(),
      summary: summary ?? undefined,
      error: error ?? null,
    },
  });
}

/** Recent job runs newest-first; limit clamped to 1..200 (default 50). */
export async function listJobRuns(limit = 50) {
  // Clamp take so callers cannot request unbounded history.
  return prisma.jobRun.findMany({
    orderBy: { startedAt: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
  });
}
