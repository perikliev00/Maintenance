/**
 * HTTP wiring for POST /jobs/run shared execution lock (audit §3.4).
 * Domain lock coverage lives in executionLock.test.ts; this suite proves the
 * controller returns 409 while the lock is held and succeeds after release.
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/db";
import { assertTestDatabase } from "../assertTestDatabase";
import {
  closeServer,
  getJson,
  listenApp,
  loginBearer,
  postJson,
} from "../httpHarness";
import {
  cleanupCleaningWorld,
  createCleaningWorld,
  CLN_PASSWORD,
  type CleaningWorld,
} from "../cleaning/fixtures";
import { runWithJobExecutionLock } from "../../src/services/jobs/executionLock";
import { invalidateGrantCache } from "../../src/services/roleGrants";
import { GrantKind } from "@prisma/client";

describe("POST /jobs/run shared execution lock", () => {
  let world: CleaningWorld;
  let api: string;
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  let ownerToken: string;
  let hkToken: string;

  before(async () => {
    await assertTestDatabase(prisma);
    process.env.E2E_DISABLE_RATE_LIMIT = "1";
    world = await createCleaningWorld(prisma);
    ({ api, server } = await listenApp());
    ownerToken = (await loginBearer(api, world.owner.email, CLN_PASSWORD)).token;
    hkToken = (await loginBearer(api, world.hk1.email, CLN_PASSWORD)).token;
  });

  after(async () => {
    if (server) await closeServer(server);
    if (world) await cleanupCleaningWorld(prisma, world);
    await prisma.$disconnect();
  });

  it("returns 409 while the shared lock is held, then succeeds after release", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const active = runWithJobExecutionLock(async () => {
      await held;
      return "held";
    });
    // Let the lock acquire before racing the HTTP trigger.
    await Promise.resolve();

    const blocked = await postJson(api, ownerToken, "/jobs/run", {
      jobKey: "overdue_sessions",
    });
    assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
    assert.equal(
      (blocked.body as { error?: string }).error,
      "job_already_running",
    );

    release();
    assert.deepEqual(await active, { acquired: true, value: "held" });

    const ok = await postJson(api, ownerToken, "/jobs/run", {
      jobKey: "overdue_sessions",
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(typeof ok.body, "object");
    assert.ok(ok.body && typeof (ok.body as { flagged?: unknown }).flagged === "number");
  });

  it("denies callers without jobs.run", async () => {
    const denied = await postJson(api, hkToken, "/jobs/run", {
      jobKey: "overdue_sessions",
    });
    assert.equal(denied.status, 403, JSON.stringify(denied.body));
  });

  it("NEW-05: jobs.view alone cannot POST /jobs/run", async () => {
    await prisma.roleGrant.create({
      data: {
        role: "housekeeper",
        kind: GrantKind.action,
        key: "jobs.view",
      },
    });
    invalidateGrantCache();
    try {
      const listed = await getJson(api, hkToken, "/jobs/runs?limit=5");
      assert.equal(listed.status, 200, JSON.stringify(listed.body));

      const denied = await postJson(api, hkToken, "/jobs/run", {
        jobKey: "overdue_sessions",
      });
      assert.equal(denied.status, 403, JSON.stringify(denied.body));
    } finally {
      await prisma.roleGrant.deleteMany({
        where: {
          role: "housekeeper",
          kind: GrantKind.action,
          key: "jobs.view",
        },
      });
      invalidateGrantCache();
    }
  });
});
