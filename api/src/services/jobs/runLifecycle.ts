import { Prisma } from "@prisma/client";
import { prisma } from "../../db";

export async function startJobRun(jobKey: string) {
  return prisma.jobRun.create({
    data: { jobKey, status: "running" },
  });
}

export async function finishJobRun(
  id: string,
  status: "ok" | "error",
  summary?: Prisma.InputJsonValue,
  error?: string,
) {
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

export async function listJobRuns(limit = 50) {
  return prisma.jobRun.findMany({
    orderBy: { startedAt: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
  });
}
