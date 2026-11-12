// Import module node:assert/strict for this service.
import assert from "node:assert/strict";
// Import module node:test for this service.
import { after, before, describe, it } from "node:test";
// Import module @prisma/client for this service.
import { PrismaClient } from "@prisma/client";
// Import module ../../db for this service.
import { prisma } from "../../db";
// Import module ../../../tests/assertTestDatabase for this service.
import { assertTestDatabase } from "../../../tests/assertTestDatabase";
// Import module dependency for this service.
import {
  // Run next step: JOB_EXECUTION_ADVISORY_KEY,
  JOB_EXECUTION_ADVISORY_KEY,
  // Run next step: advisoryLockDatabaseUrl,
  advisoryLockDatabaseUrl,
  // Run next step: runWithJobExecutionLock,
  runWithJobExecutionLock,
// Run next step: } from "./executionLock";
} from "./executionLock";

// Run next step: describe("shared scheduled/manual job execution lock", () =>…
describe("shared scheduled/manual job execution lock", () => {
  // Run next step: before(async () => {
  before(async () => {
    // Wait for the async step before continuing.
    await assertTestDatabase(prisma);
  });

  // Run next step: after(async () => {
  after(async () => {
    // Wait for the async step before continuing.
    await prisma.$disconnect();
  });

  // Run next step: it("advisoryLockDatabaseUrl forces connection_limit=1", () =…
  it("advisoryLockDatabaseUrl forces connection_limit=1", () => {
    // Capture out for use in this scope.
    const out = advisoryLockDatabaseUrl(
      // Set postgresql on the structure being built.
      "postgresql://u:p@127.0.0.1:5432/maintenance_p1_test?connection_limit=20&schema=public",
    );
    // Run next step: assert.ok(out);
    assert.ok(out);
    // Capture parsed for use in this scope.
    const parsed = new URL(out);
    // Run next step: assert.equal(
    assert.equal(
      // Run next step: parsed.searchParams.get("connection_limit"),
      parsed.searchParams.get("connection_limit"),
      // Run next step: "1",
      "1",
      // Run next step: "lock client must pin a single backend session",
      "lock client must pin a single backend session",
    );
    // Run next step: assert.match(out, /^postgresql:\/\//);
    assert.match(out, /^postgresql:\/\//);
  });

  // Run next step: it("advisoryLockDatabaseUrl returns undefined for empty inpu…
  it("advisoryLockDatabaseUrl returns undefined for empty input", () => {
    // Run next step: assert.equal(advisoryLockDatabaseUrl(undefined), undefined);
    assert.equal(advisoryLockDatabaseUrl(undefined), undefined);
    // Run next step: assert.equal(advisoryLockDatabaseUrl(" "), undefined);
    assert.equal(advisoryLockDatabaseUrl("   "), undefined);
  });

  // Run next step: it("rejects a concurrent trigger until the active job comple…
  it("rejects a concurrent trigger until the active job completes", async () => {
    // Capture finish for use in this scope.
    let finish!: () => void;
    // Capture active for use in this scope.
    const active = runWithJobExecutionLock(
      // Run next step: () =>
      () =>
        // Run next step: new Promise<string>((resolve) => {
        new Promise<string>((resolve) => {
          // Update finish as control flow progresses.
          finish = () => resolve("done");
        }),
    );
    // Wait for the async step before continuing.
    await Promise.resolve();
    // Wait for the async step before continuing.
    await new Promise((r) => setTimeout(r, 50));
    // Load concurrent asynchronously for the next steps.
    const concurrent = await runWithJobExecutionLock(async () => "should not run");
    // Run next step: assert.deepEqual(concurrent, { acquired: false });
    assert.deepEqual(concurrent, { acquired: false });
    // Run next step: finish();
    finish();
    // Run next step: assert.deepEqual(await active, { acquired: true, value: "don…
    assert.deepEqual(await active, { acquired: true, value: "done" });
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Wait for the async step before continuing.
      await runWithJobExecutionLock(async () => "next"),
      // Run next step: { acquired: true, value: "next" },
      { acquired: true, value: "next" },
    );
  });

  // Run next step: it("returns acquired:false when another session holds the Po…
  it("returns acquired:false when another session holds the Postgres advisory lock", async () => {
    // Capture lock url for use in this scope.
    const lockUrl = advisoryLockDatabaseUrl(process.env.DATABASE_URL);
    // Run next step: assert.ok(lockUrl, "DATABASE_URL required for advisory-lock …
    assert.ok(lockUrl, "DATABASE_URL required for advisory-lock regression");
    // Capture holder for use in this scope.
    const holder = new PrismaClient({
      // Set datasources on the structure being built.
      datasources: { db: { url: lockUrl } },
    });
    // Attempt the fallible work so errors can be handled below.
    try {
      // Load held asynchronously for the next steps.
      const held = await holder.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_lock(${JOB_EXECUTION_ADVISORY_KEY}) AS locked
      `;
      // Run next step: assert.equal(
      assert.equal(
        // Run next step: held[0]?.locked,
        held[0]?.locked,
        // Run next step: true,
        true,
        // Run next step: "test holder must acquire the advisory lock",
        "test holder must acquire the advisory lock",
      );

      // Load blocked asynchronously for the next steps.
      const blocked = await runWithJobExecutionLock(async () => "must not run");
      // Run next step: assert.deepEqual(
      assert.deepEqual(
        // Run next step: blocked,
        blocked,
        // Run next step: { acquired: false },
        { acquired: false },
        // Run next step: "cross-session advisory lock must block runWithJobExecutionL…
        "cross-session advisory lock must block runWithJobExecutionLock",
      );
    // Run next step: } finally {
    } finally {
      // Attempt the fallible work so errors can be handled below.
      try {
        // Wait for the async step before continuing.
        await holder.$executeRaw`
          SELECT pg_advisory_unlock(${JOB_EXECUTION_ADVISORY_KEY})
        `;
      // Run next step: } catch {
      } catch {
        /* best-effort */
      }
      // Wait for the async step before continuing.
      await holder.$disconnect().catch(() => undefined);
    }

    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Wait for the async step before continuing.
      await runWithJobExecutionLock(async () => "after-release"),
      // Run next step: { acquired: true, value: "after-release" },
      { acquired: true, value: "after-release" },
    );
  });
});
