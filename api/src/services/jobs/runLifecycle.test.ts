/**
 * JobRun lifecycle: finish publishes jobs.changed; abandoned running rows recover.
 */
import assert from "node:assert/strict";
// Import module node:test for this service.
import { after, before, describe, it } from "node:test";
// Import module ../../db for this service.
import { prisma } from "../../db";
// Import module ../../events/bus for this service.
import { subscribe, type LiveEvent } from "../../events/bus";
// Import module ../../../tests/assertTestDatabase for this service.
import { assertTestDatabase } from "../../../tests/assertTestDatabase";
// Import module dependency for this service.
import {
  // Run next step: abandonStaleRunningJobRuns,
  abandonStaleRunningJobRuns,
  // Run next step: finishJobRun,
  finishJobRun,
  // Run next step: startJobRun,
  startJobRun,
// Run next step: } from "./runLifecycle";
} from "./runLifecycle";

// Run next step: describe("JobRun lifecycle (abandoned running)", () => {
describe("JobRun lifecycle (abandoned running)", () => {
  // Capture created ids for use in this scope.
  const createdIds: string[] = [];

  // Run next step: before(async () => {
  before(async () => {
    // Wait for the async step before continuing.
    await assertTestDatabase(prisma);
  });

  // Run next step: after(async () => {
  after(async () => {
    // Branch when this condition holds so the right path runs.
    if (createdIds.length) {
      // Wait for the async step before continuing.
      await prisma.jobRun.deleteMany({ where: { id: { in: createdIds } } });
    }
    // Wait for the async step before continuing.
    await prisma.$disconnect();
  });

  // Run next step: it("startJobRun alone publishes jobs.changed", async () => {
  it("startJobRun alone publishes jobs.changed", async () => {
    // Capture seen for use in this scope.
    const seen: LiveEvent[] = [];
    // Capture unsub for use in this scope.
    const unsub = subscribe((event) => {
      // Branch when this condition holds so the right path runs.
      if (event.type === "jobs.changed") seen.push(event);
    });
    // Attempt the fallible work so errors can be handled below.
    try {
      // Capture before for use in this scope.
      const before = seen.length;
      // Load run asynchronously for the next steps.
      const run = await startJobRun("stale_open_attendance");
      // Append an entry to the accumulating collection.
      createdIds.push(run.id);
      // Run next step: assert.equal(
      assert.equal(
        // Run next step: seen.length,
        seen.length,
        // Run next step: before + 1,
        before + 1,
        // Run next step: "startJobRun must publish jobs.changed by itself",
        "startJobRun must publish jobs.changed by itself",
      );
      // Leave running for abandon coverage elsewhere; finish to keep suite tidy.
      await finishJobRun(run.id, "ok", { scanned: 0, flagged: 0 });
    // Run next step: } finally {
    } finally {
      // Run next step: unsub();
      unsub();
    }
  });

  // Run next step: it("finishJobRun publishes jobs.changed", async () => {
  it("finishJobRun publishes jobs.changed", async () => {
    // Capture seen for use in this scope.
    const seen: LiveEvent[] = [];
    // Capture unsub for use in this scope.
    const unsub = subscribe((event) => {
      // Branch when this condition holds so the right path runs.
      if (event.type === "jobs.changed") seen.push(event);
    });
    // Attempt the fallible work so errors can be handled below.
    try {
      // Load run asynchronously for the next steps.
      const run = await startJobRun("overdue_sessions");
      // Append an entry to the accumulating collection.
      createdIds.push(run.id);
      // Run next step: seen.length = 0;
      seen.length = 0;
      // Wait for the async step before continuing.
      await finishJobRun(run.id, "ok", { scanned: 0, flagged: 0 });
      // Run next step: assert.equal(seen.length, 1, "finishJobRun must publish inde…
      assert.equal(seen.length, 1, "finishJobRun must publish independently");
      // Load row asynchronously for the next steps.
      const row = await prisma.jobRun.findUniqueOrThrow({ where: { id: run.id } });
      // Run next step: assert.equal(row.status, "ok");
      assert.equal(row.status, "ok");
      // Run next step: assert.ok(row.finishedAt);
      assert.ok(row.finishedAt);
    // Run next step: } finally {
    } finally {
      // Run next step: unsub();
      unsub();
    }
  });

  // Run next step: it("abandonStaleRunningJobRuns closes orphaned running rows …
  it("abandonStaleRunningJobRuns closes orphaned running rows past TTL", async () => {
    // Load run asynchronously for the next steps.
    const run = await startJobRun("ticket_sla_breach");
    // Append an entry to the accumulating collection.
    createdIds.push(run.id);
    // Force startedAt older than the default multi-instance TTL.
    await prisma.jobRun.update({
      // Set where on the structure being built.
      where: { id: run.id },
      // Set data on the structure being built.
      data: { startedAt: new Date(Date.now() - 31 * 60_000) },
    });
    // Capture seen for use in this scope.
    const seen: LiveEvent[] = [];
    // Capture unsub for use in this scope.
    const unsub = subscribe((event) => {
      // Branch when this condition holds so the right path runs.
      if (event.type === "jobs.changed") seen.push(event);
    });
    // Attempt the fallible work so errors can be handled below.
    try {
      // Load count asynchronously for the next steps.
      const count = await abandonStaleRunningJobRuns();
      // Run next step: assert.ok(count >= 1);
      assert.ok(count >= 1);
      // Load row asynchronously for the next steps.
      const row = await prisma.jobRun.findUniqueOrThrow({ where: { id: run.id } });
      // Run next step: assert.equal(row.status, "error");
      assert.equal(row.status, "error");
      // Run next step: assert.match(row.error ?? "", /Abandoned/);
      assert.match(row.error ?? "", /Abandoned/);
      // Run next step: assert.ok(seen.length >= 1);
      assert.ok(seen.length >= 1);
    // Run next step: } finally {
    } finally {
      // Run next step: unsub();
      unsub();
    }
  });

  // Run next step: it("abandonStaleRunningJobRuns keeps fresh running rows (mul…
  it("abandonStaleRunningJobRuns keeps fresh running rows (multi-instance)", async () => {
    // Load run asynchronously for the next steps.
    const run = await startJobRun("lock_inactive_users");
    // Append an entry to the accumulating collection.
    createdIds.push(run.id);
    // Wait for the async step before continuing.
    await abandonStaleRunningJobRuns();
    // Load row asynchronously for the next steps.
    const row = await prisma.jobRun.findUniqueOrThrow({ where: { id: run.id } });
    // Run next step: assert.equal(row.status, "running");
    assert.equal(row.status, "running");
    // Run next step: assert.equal(row.error, null);
    assert.equal(row.error, null);
    // Run next step: assert.equal(row.finishedAt, null);
    assert.equal(row.finishedAt, null);
    // Wait for the async step before continuing.
    await finishJobRun(run.id, "ok", { locked: 0 });
  });
});

