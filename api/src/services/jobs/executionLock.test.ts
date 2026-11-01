import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { prisma } from "../../db";
import { assertTestDatabase } from "../../../tests/assertTestDatabase";
import {
  JOB_EXECUTION_ADVISORY_KEY,
  advisoryLockDatabaseUrl,
  runWithJobExecutionLock,
} from "./executionLock";

describe("shared scheduled/manual job execution lock", () => {
  before(async () => {
    await assertTestDatabase(prisma);
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it("advisoryLockDatabaseUrl forces connection_limit=1", () => {
    const out = advisoryLockDatabaseUrl(
      "postgresql://u:p@127.0.0.1:5432/maintenance_p1_test?connection_limit=20&schema=public",
    );
    assert.ok(out);
    const parsed = new URL(out);
    assert.equal(
      parsed.searchParams.get("connection_limit"),
      "1",
      "lock client must pin a single backend session",
    );
    assert.match(out, /^postgresql:\/\//);
  });

  it("advisoryLockDatabaseUrl returns undefined for empty input", () => {
    assert.equal(advisoryLockDatabaseUrl(undefined), undefined);
    assert.equal(advisoryLockDatabaseUrl("   "), undefined);
  });

  it("rejects a concurrent trigger until the active job completes", async () => {
    let finish!: () => void;
    const active = runWithJobExecutionLock(
      () =>
        new Promise<string>((resolve) => {
          finish = () => resolve("done");
        }),
    );
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 50));
    const concurrent = await runWithJobExecutionLock(async () => "should not run");
    assert.deepEqual(concurrent, { acquired: false });
    finish();
    assert.deepEqual(await active, { acquired: true, value: "done" });
    assert.deepEqual(
      await runWithJobExecutionLock(async () => "next"),
      { acquired: true, value: "next" },
    );
  });

  it("returns acquired:false when another session holds the Postgres advisory lock", async () => {
    const lockUrl = advisoryLockDatabaseUrl(process.env.DATABASE_URL);
    assert.ok(lockUrl, "DATABASE_URL required for advisory-lock regression");
    const holder = new PrismaClient({
      datasources: { db: { url: lockUrl } },
    });
    try {
      const held = await holder.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_lock(${JOB_EXECUTION_ADVISORY_KEY}) AS locked
      `;
      assert.equal(
        held[0]?.locked,
        true,
        "test holder must acquire the advisory lock",
      );

      const blocked = await runWithJobExecutionLock(async () => "must not run");
      assert.deepEqual(
        blocked,
        { acquired: false },
        "cross-session advisory lock must block runWithJobExecutionLock",
      );
    } finally {
      try {
        await holder.$executeRaw`
          SELECT pg_advisory_unlock(${JOB_EXECUTION_ADVISORY_KEY})
        `;
      } catch {
        /* best-effort */
      }
      await holder.$disconnect().catch(() => undefined);
    }

    assert.deepEqual(
      await runWithJobExecutionLock(async () => "after-release"),
      { acquired: true, value: "after-release" },
    );
  });
});
