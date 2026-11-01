/**
 * AppSetting optimistic concurrency + audit integrity (BUG-01 / BUG-02).
 * Requires isolated PostgreSQL (maintenance_p1_test).
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/db";
import { AppError } from "../../src/errors";
import { assertTestDatabase } from "../assertTestDatabase";
import {
  cleanupCleaningWorld,
  createCleaningWorld,
  type CleaningWorld,
} from "../cleaning/fixtures";
import {
  closeServer,
  getJson,
  listenApp,
  loginBearer,
  patchJson,
} from "../httpHarness";
import {
  getSetting,
  getSystemStatus,
  updateSetting,
} from "../../src/services/settings";

describe("settings concurrency + audit CAS", () => {
  let world: CleaningWorld;
  let api: string;
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  let token: string;
  let modulesBaseline: Awaited<ReturnType<typeof getSetting<"modules">>>;

  before(async () => {
    await assertTestDatabase(prisma);
    process.env.E2E_DISABLE_RATE_LIMIT = "1";
    world = await createCleaningWorld(prisma);
    modulesBaseline = await getSetting("modules");
    ({ api, server } = await listenApp());
    token = (await loginBearer(api, world.owner.email, "test-password-cln")).token;
  });

  after(async () => {
    if (server) await closeServer(server);
    if (world) {
      await updateSetting({
        key: "modules",
        value: modulesBaseline,
        actorEmployeeId: world.owner.employeeId,
        reason: "restore",
      });
      await prisma.auditEvent.deleteMany({
        where: {
          entityType: "setting",
          entityId: "modules",
          actorEmployeeId: world.owner.employeeId,
        },
      });
      await cleanupCleaningWorld(prisma, world);
    }
    await prisma.$disconnect();
  });

  async function modulesVersion(): Promise<number> {
    const row = await prisma.appSetting.findUniqueOrThrow({
      where: { key: "modules" },
    });
    return row.version;
  }

  it("BUG-01 concurrent CAS: first writer wins, second gets 409, first value kept", async () => {
    const current = await getSetting("modules");
    const v0 = await modulesVersion();
    const firstValue = { ...current, attendance: !current.attendance };
    const secondValue = { ...current, analytics: !current.analytics };

    const auditsBefore = await prisma.auditEvent.count({
      where: { entityType: "setting", entityId: "modules" },
    });

    const [a, b] = await Promise.all([
      updateSetting({
        key: "modules",
        value: firstValue,
        actorEmployeeId: world.owner.employeeId,
        reason: "writer-a",
        expectedVersion: v0,
      }).then(
        (row) => ({ ok: true as const, row }),
        (err) => ({ ok: false as const, err }),
      ),
      updateSetting({
        key: "modules",
        value: secondValue,
        actorEmployeeId: world.owner.employeeId,
        reason: "writer-b",
        expectedVersion: v0,
      }).then(
        (row) => ({ ok: true as const, row }),
        (err) => ({ ok: false as const, err }),
      ),
    ]);

    const wins = [a, b].filter((r) => r.ok);
    const losses = [a, b].filter((r) => !r.ok);
    assert.equal(wins.length, 1, "exactly one writer should commit");
    assert.equal(losses.length, 1, "exactly one writer should conflict");
    const loss = losses[0]!;
    assert.ok(!loss.ok);
    assert.ok(loss.err instanceof AppError);
    assert.equal(loss.err.status, 409);
    assert.equal(loss.err.code, "version_conflict");

    const stored = await getSetting("modules");
    const winner = wins[0]!;
    assert.ok(winner.ok);
    assert.deepEqual(stored, winner.row.value);
    assert.equal(await modulesVersion(), v0 + 1);

    const auditsAfter = await prisma.auditEvent.count({
      where: { entityType: "setting", entityId: "modules" },
    });
    assert.equal(
      auditsAfter,
      auditsBefore + 1,
      "rejected conflict must not create an audit row",
    );
  });

  it("BUG-02 audit before matches the CAS-accepted prior value", async () => {
    const current = await getSetting("modules");
    const v = await modulesVersion();
    const next = { ...current, live: !current.live };
    const reason = `audit-before-${Date.now()}`;

    await updateSetting({
      key: "modules",
      value: next,
      actorEmployeeId: world.owner.employeeId,
      reason,
      expectedVersion: v,
    });

    const audit = await prisma.auditEvent.findFirst({
      where: { entityType: "setting", entityId: "modules", reason },
      orderBy: { occurredAt: "desc" },
    });
    assert.ok(audit);
    assert.deepEqual(audit.before, current);
    assert.deepEqual(audit.after, next);
  });

  it("HTTP PATCH with stale expectedVersion returns 409 and leaves row unchanged", async () => {
    const before = await prisma.appSetting.findUniqueOrThrow({
      where: { key: "modules" },
    });
    const current = await getSetting("modules");
    const res = await patchJson(api, token, "/settings/modules", {
      value: { ...current, team: !current.team },
      reason: "stale-http",
      expectedVersion: before.version - 1,
    });
    assert.equal(res.status, 409);
    assert.equal((res.body as { error?: string }).error, "version_conflict");
    assert.deepEqual(
      await prisma.appSetting.findUniqueOrThrow({ where: { key: "modules" } }),
      before,
    );
  });

  it("HTTP PATCH with current expectedVersion succeeds and bumps version", async () => {
    const before = await prisma.appSetting.findUniqueOrThrow({
      where: { key: "modules" },
    });
    const current = await getSetting("modules");
    const next = { ...current, control: !current.control };
    const res = await patchJson(api, token, "/settings/modules", {
      value: next,
      reason: "fresh-http",
      expectedVersion: before.version,
    });
    assert.equal(res.status, 200);
    assert.equal((res.body as { version?: number }).version, before.version + 1);
    const after = await prisma.appSetting.findUniqueOrThrow({
      where: { key: "modules" },
    });
    assert.equal(after.version, before.version + 1);
    assert.deepEqual(after.value, next);
  });

  it("GET /settings exposes version for clients", async () => {
    const res = await getJson(api, token, "/settings");
    assert.equal(res.status, 200);
    const modules = (res.body as { modules?: { version?: number } }).modules;
    assert.equal(typeof modules?.version, "number");
    assert.ok((modules?.version ?? 0) >= 1);
  });

  it("BUG-05 getSystemStatus returns counts as numbers when DB is healthy", async () => {
    const status = await getSystemStatus();
    assert.equal(status.api.ok, true);
    assert.equal(status.database.ok, true);
    for (const key of [
      "rooms",
      "commonAreas",
      "openTickets",
      "runningSessions",
    ] as const) {
      assert.equal(typeof status.counts[key], "number");
      assert.ok((status.counts[key] as number) >= 0);
    }
    assert.equal(typeof status.fetchedAt, "string");
  });

  it("GET /settings/system is authorized; anonymous is 401", async () => {
    const ok = await getJson(api, token, "/settings/system");
    assert.equal(ok.status, 200);
    const counts = (ok.body as { counts?: Record<string, unknown> }).counts;
    assert.ok(counts);
    const unauth = await fetch(`${api}/settings/system`);
    assert.equal(unauth.status, 401);
  });

  it("HTTP PATCH without expectedVersion is 400 and does not mutate", async () => {
    const before = await prisma.appSetting.findUniqueOrThrow({
      where: { key: "modules" },
    });
    const current = await getSetting("modules");
    const res = await patchJson(api, token, "/settings/modules", {
      value: { ...current, analytics: !current.analytics },
      reason: "missing-version",
    });
    assert.equal(res.status, 400);
    assert.deepEqual(
      await prisma.appSetting.findUniqueOrThrow({ where: { key: "modules" } }),
      before,
    );
  });

  it("security: housekeeper without settings.manage gets 403", async () => {
    const hk = await loginBearer(api, world.hk1.email, "test-password-cln");
    const before = await prisma.appSetting.findUniqueOrThrow({
      where: { key: "modules" },
    });
    const res = await patchJson(api, hk.token, "/settings/modules", {
      value: before.value,
      reason: "forbidden",
      expectedVersion: before.version,
    });
    assert.equal(res.status, 403);
    assert.deepEqual(
      await prisma.appSetting.findUniqueOrThrow({ where: { key: "modules" } }),
      before,
    );
    const system = await getJson(api, hk.token, "/settings/system");
    assert.equal(system.status, 403);
  });

  it("security: unauthenticated PATCH is 401; invalid payload does not mutate", async () => {
    const before = await prisma.appSetting.findUniqueOrThrow({
      where: { key: "modules" },
    });
    const audits = await prisma.auditEvent.count({
      where: { entityType: "setting", entityId: "modules" },
    });
    const unauth = await fetch(`${api}/settings/modules`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        value: { rooms: false },
        reason: "no-auth",
        expectedVersion: before.version,
      }),
    });
    assert.equal(unauth.status, 401);

    const bad = await patchJson(api, token, "/settings/modules", {
      value: { rooms: "yes" },
      reason: "invalid",
      expectedVersion: before.version,
    });
    assert.equal(bad.status, 400);
    assert.deepEqual(
      await prisma.appSetting.findUniqueOrThrow({ where: { key: "modules" } }),
      before,
    );
    assert.equal(
      await prisma.auditEvent.count({
        where: { entityType: "setting", entityId: "modules" },
      }),
      audits,
    );
  });
});
