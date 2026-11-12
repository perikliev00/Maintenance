/**
 * JobRun lifecycle: finish publishes jobs.changed; abandoned running rows recover.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../db";
import { subscribe, type LiveEvent } from "../../events/bus";
import { assertTestDatabase } from "../../../tests/assertTestDatabase";
import {
  abandonStaleRunningJobRuns,
  finishJobRun,
  startJobRun,
} from "./runLifecycle";

describe("JobRun lifecycle (abandoned running)", () => {
  // Capture created ids for use in this scope.
  const createdIds: string[] = [];

  before(async () => {
    await assertTestDatabase(prisma);
  });

  after(async () => {
    if (createdIds.length) {
      await prisma.jobRun.deleteMany({ where: { id: { in: createdIds } } });
    }
    await prisma.$disconnect();
  });

  it("startJobRun alone publishes jobs.changed", async () => {
    const seen: LiveEvent[] = [];
    const unsub = subscribe((event) => {
      if (event.type === "jobs.changed") seen.push(event);
    });
    try {
      const before = seen.length;
      const run = await startJobRun("stale_open_attendance");
      // Append an entry to the accumulating collection.
      createdIds.push(run.id);
      assert.equal(
        seen.length,
        before + 1,
        "startJobRun must publish jobs.changed by itself",
      );
      // Leave running for abandon coverage elsewhere; finish to keep suite tidy.
      await finishJobRun(run.id, "ok", { scanned: 0, flagged: 0 });
    } finally {
      unsub();
    }
  });

  it("finishJobRun publishes jobs.changed", async () => {
    const seen: LiveEvent[] = [];
    const unsub = subscribe((event) => {
      if (event.type === "jobs.changed") seen.push(event);
    });
    try {
      const run = await startJobRun("overdue_sessions");
      // Append an entry to the accumulating collection.
      createdIds.push(run.id);
      seen.length = 0;
      await finishJobRun(run.id, "ok", { scanned: 0, flagged: 0 });
      assert.equal(seen.length, 1, "finishJobRun must publish independently");
      const row = await prisma.jobRun.findUniqueOrThrow({ where: { id: run.id } });
      assert.equal(row.status, "ok");
      assert.ok(row.finishedAt);
    } finally {
      unsub();
    }
  });

  it("abandonStaleRunningJobRuns closes orphaned running rows past TTL", async () => {
    const run = await startJobRun("ticket_sla_breach");
    // Append an entry to the accumulating collection.
    createdIds.push(run.id);
    // Force startedAt older than the default multi-instance TTL.
    await prisma.jobRun.update({
      where: { id: run.id },
      data: { startedAt: new Date(Date.now() - 31 * 60_000) },
    });
    const seen: LiveEvent[] = [];
    const unsub = subscribe((event) => {
      if (event.type === "jobs.changed") seen.push(event);
    });
    try {
      const count = await abandonStaleRunningJobRuns();
      assert.ok(count >= 1);
      const row = await prisma.jobRun.findUniqueOrThrow({ where: { id: run.id } });
      assert.equal(row.status, "error");
      assert.match(row.error ?? "", /Abandoned/);
      assert.ok(seen.length >= 1);
    } finally {
      unsub();
    }
  });

  it("abandonStaleRunningJobRuns keeps fresh running rows (multi-instance)", async () => {
    const run = await startJobRun("lock_inactive_users");
    // Append an entry to the accumulating collection.
    createdIds.push(run.id);
    await abandonStaleRunningJobRuns();
    const row = await prisma.jobRun.findUniqueOrThrow({ where: { id: run.id } });
    assert.equal(row.status, "running");
    assert.equal(row.error, null);
    assert.equal(row.finishedAt, null);
    await finishJobRun(run.id, "ok", { locked: 0 });
  });
});

