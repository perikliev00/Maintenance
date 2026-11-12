/**
 * AppSetting optimistic concurrency + audit integrity .
 * Requires isolated PostgreSQL (maintenance_p1_test).
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Node test runner and strict assertions for API suite checks.
import { after, before, describe, it } from "node:test";
// Import bindings from ../../src/db.
import { prisma } from "../../src/db";
// Import bindings from ../../src/errors.
import { AppError } from "../../src/errors";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  cleanupCleaningWorld,
  // Execute the next setup or assertion step for this scenario.
  createCleaningWorld,
  // Shape CleaningWorld documents the fixture/response fields this suite touches.
  type CleaningWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "../cleaning/fixtures";
// Import module bindings used by this suite.
import {
  // Start or stop the in-process API server for this suite.
  closeServer,
  // Execute the next setup or assertion step for this scenario.
  getJson,
  // Execute the next setup or assertion step for this scenario.
  listenApp,
  // Session/CSRF step exercising auth lifecycle.
  loginBearer,
  // Execute the next setup or assertion step for this scenario.
  patchJson,
// Execute the next setup or assertion step for this scenario.
} from "../httpHarness";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  getSetting,
  // Execute the next setup or assertion step for this scenario.
  getSystemStatus,
  // Execute the next setup or assertion step for this scenario.
  updateSetting,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/settings";

// Suite: settings concurrency + audit CAS.
describe("settings concurrency + audit CAS", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: CleaningWorld;
  // Execute the next setup or assertion step for this scenario.
  let api: string;
  // Execute the next setup or assertion step for this scenario.
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  // Execute the next setup or assertion step for this scenario.
  let token: string;
  // Execute the next setup or assertion step for this scenario.
  let modulesBaseline: Awaited<ReturnType<typeof getSetting<"modules">>>;

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    // Override env for isolation, rate-limit disable, or scheduler quieting.
    process.env.E2E_DISABLE_RATE_LIMIT = "1";
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createCleaningWorld(prisma);
    // Await async work before asserting or releasing locks.
    modulesBaseline = await getSetting("modules");
    // Start or stop the in-process API server for this suite.
    ({ api, server } = await listenApp());
    // Await async work before asserting or releasing locks.
    token = (await loginBearer(api, world.owner.email, "test-password-cln")).token;
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Guard optional cleanup or alternate assertion paths.
    if (server) await closeServer(server);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) {
      // Await async work before asserting or releasing locks.
      await updateSetting({
        // Execute the next setup or assertion step for this scenario.
        key: "modules",
        // Execute the next setup or assertion step for this scenario.
        value: modulesBaseline,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.owner.employeeId,
        // Execute the next setup or assertion step for this scenario.
        reason: "restore",
      });
      // Await async work before asserting or releasing locks.
      await prisma.auditEvent.deleteMany({
        // SQL fragment used to observe locks or assert DB state.
        where: {
          // Execute the next setup or assertion step for this scenario.
          entityType: "setting",
          // Execute the next setup or assertion step for this scenario.
          entityId: "modules",
          // Execute the next setup or assertion step for this scenario.
          actorEmployeeId: world.owner.employeeId,
        },
      });
      // Await async work before asserting or releasing locks.
      await cleanupCleaningWorld(prisma, world);
    }
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Local helper modulesVersion used by cases in this file.
  async function modulesVersion(): Promise<number> {
    // row: synchronize actors so the race window is observable.
    const row = await prisma.appSetting.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { key: "modules" },
    });
    // Return the arranged value/result to the caller.
    return row.version;
  }

  // Case probes concurrency/isolation: concurrent CAS: first writer wins, second gets 409, first value kept.
  it("concurrent CAS: first writer wins, second gets 409, first value kept", async () => {
    // current: HTTP response captured for status/body checks.
    const current = await getSetting("modules");
    // v0: synchronize actors so the race window is observable.
    const v0 = await modulesVersion();
    // Bind firstValue for later setup or assertions in this scope.
    const firstValue = { ...current, attendance: !current.attendance };
    // Bind secondValue for later setup or assertions in this scope.
    const secondValue = { ...current, analytics: !current.analytics };

    // auditsBefore: synchronize actors so the race window is observable.
    const auditsBefore = await prisma.auditEvent.count({
      // SQL fragment used to observe locks or assert DB state.
      where: { entityType: "setting", entityId: "modules" },
    });

    // Run actors together to expose races and serialization bugs.
    const [a, b] = await Promise.all([
      // Execute the next setup or assertion step for this scenario.
      updateSetting({
        // Execute the next setup or assertion step for this scenario.
        key: "modules",
        // Execute the next setup or assertion step for this scenario.
        value: firstValue,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.owner.employeeId,
        // Execute the next setup or assertion step for this scenario.
        reason: "writer-a",
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: v0,
      // Execute the next setup or assertion step for this scenario.
      }).then(
        // Execute the next setup or assertion step for this scenario.
        (row) => ({ ok: true as const, row }),
        // Execute the next setup or assertion step for this scenario.
        (err) => ({ ok: false as const, err }),
      ),
      // Execute the next setup or assertion step for this scenario.
      updateSetting({
        // Execute the next setup or assertion step for this scenario.
        key: "modules",
        // Execute the next setup or assertion step for this scenario.
        value: secondValue,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.owner.employeeId,
        // Execute the next setup or assertion step for this scenario.
        reason: "writer-b",
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: v0,
      // Execute the next setup or assertion step for this scenario.
      }).then(
        // Execute the next setup or assertion step for this scenario.
        (row) => ({ ok: true as const, row }),
        // Execute the next setup or assertion step for this scenario.
        (err) => ({ ok: false as const, err }),
      ),
    ]);

    // Bind wins for later setup or assertions in this scope.
    const wins = [a, b].filter((r) => r.ok);
    // Bind losses for later setup or assertions in this scope.
    const losses = [a, b].filter((r) => !r.ok);
    // Assert collection size matches the expected post-condition.
    assert.equal(wins.length, 1, "exactly one writer should commit");
    // Assert collection size matches the expected post-condition.
    assert.equal(losses.length, 1, "exactly one writer should conflict");
    // Bind loss for later setup or assertions in this scope.
    const loss = losses[0]!;
    // Assert the observed value matches the intended post-condition.
    assert.ok(!loss.ok);
    // Assert the observed value matches the intended post-condition.
    assert.ok(loss.err instanceof AppError);
    // Assert HTTP status matches the contract for this path.
    assert.equal(loss.err.status, 409);
    // Assert the observed value matches the intended post-condition.
    assert.equal(loss.err.code, "version_conflict");

    // stored: HTTP response captured for status/body checks.
    const stored = await getSetting("modules");
    // Bind winner for later setup or assertions in this scope.
    const winner = wins[0]!;
    // Assert the observed value matches the intended post-condition.
    assert.ok(winner.ok);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(stored, winner.row.value);
    // Assert the observed value matches the intended post-condition.
    assert.equal(await modulesVersion(), v0 + 1);

    // auditsAfter: synchronize actors so the race window is observable.
    const auditsAfter = await prisma.auditEvent.count({
      // SQL fragment used to observe locks or assert DB state.
      where: { entityType: "setting", entityId: "modules" },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      auditsAfter,
      // Execute the next setup or assertion step for this scenario.
      auditsBefore + 1,
      // Execute the next setup or assertion step for this scenario.
      "rejected conflict must not create an audit row",
    );
  });

  // Case: audit before matches the CAS-accepted prior value.
  it("audit before matches the CAS-accepted prior value", async () => {
    // current: HTTP response captured for status/body checks.
    const current = await getSetting("modules");
    // v: synchronize actors so the race window is observable.
    const v = await modulesVersion();
    // Bind next for later setup or assertions in this scope.
    const next = { ...current, live: !current.live };
    // Bind reason for later setup or assertions in this scope.
    const reason = `audit-before-${Date.now()}`;

    // Await async work before asserting or releasing locks.
    await updateSetting({
      // Execute the next setup or assertion step for this scenario.
      key: "modules",
      // Execute the next setup or assertion step for this scenario.
      value: next,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      reason,
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: v,
    });

    // audit: synchronize actors so the race window is observable.
    const audit = await prisma.auditEvent.findFirst({
      // SQL fragment used to observe locks or assert DB state.
      where: { entityType: "setting", entityId: "modules", reason },
      // Execute the next setup or assertion step for this scenario.
      orderBy: { occurredAt: "desc" },
    });
    // Assert the observed value matches the intended post-condition.
    assert.ok(audit);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(audit.before, current);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(audit.after, next);
  });

  // Case: HTTP PATCH with stale expectedVersion returns 409 and leaves row unchanged.
  it("HTTP PATCH with stale expectedVersion returns 409 and leaves row unchanged", async () => {
    // before: synchronize actors so the race window is observable.
    const before = await prisma.appSetting.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { key: "modules" },
    });
    // current: HTTP response captured for status/body checks.
    const current = await getSetting("modules");
    // res: HTTP response captured for status/body checks.
    const res = await patchJson(api, token, "/settings/modules", {
      // Execute the next setup or assertion step for this scenario.
      value: { ...current, team: !current.team },
      // Execute the next setup or assertion step for this scenario.
      reason: "stale-http",
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: before.version - 1,
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 409);
    // Assert the observed value matches the intended post-condition.
    assert.equal((res.body as { error?: string }).error, "version_conflict");
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(
      // Await async work before asserting or releasing locks.
      await prisma.appSetting.findUniqueOrThrow({ where: { key: "modules" } }),
      // Execute the next setup or assertion step for this scenario.
      before,
    );
  });

  // Case: HTTP PATCH with current expectedVersion succeeds and bumps version.
  it("HTTP PATCH with current expectedVersion succeeds and bumps version", async () => {
    // before: synchronize actors so the race window is observable.
    const before = await prisma.appSetting.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { key: "modules" },
    });
    // current: HTTP response captured for status/body checks.
    const current = await getSetting("modules");
    // Bind next for later setup or assertions in this scope.
    const next = { ...current, control: !current.control };
    // res: HTTP response captured for status/body checks.
    const res = await patchJson(api, token, "/settings/modules", {
      // Execute the next setup or assertion step for this scenario.
      value: next,
      // Execute the next setup or assertion step for this scenario.
      reason: "fresh-http",
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: before.version,
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200);
    // Assert the observed value matches the intended post-condition.
    assert.equal((res.body as { version?: number }).version, before.version + 1);
    // after: synchronize actors so the race window is observable.
    const after = await prisma.appSetting.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { key: "modules" },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.version, before.version + 1);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(after.value, next);
  });

  // Case: GET /settings exposes version for clients.
  it("GET /settings exposes version for clients", async () => {
    // res: HTTP response captured for status/body checks.
    const res = await getJson(api, token, "/settings");
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200);
    // Bind modules for later setup or assertions in this scope.
    const modules = (res.body as { modules?: { version?: number } }).modules;
    // Assert the observed value matches the intended post-condition.
    assert.equal(typeof modules?.version, "number");
    // Assert the observed value matches the intended post-condition.
    assert.ok((modules?.version ?? 0) >= 1);
  });

  // Case: getSystemStatus returns counts as numbers when DB is healthy.
  it("getSystemStatus returns counts as numbers when DB is healthy", async () => {
    // status: HTTP response captured for status/body checks.
    const status = await getSystemStatus();
    // Assert HTTP status matches the contract for this path.
    assert.equal(status.api.ok, true);
    // Assert HTTP status matches the contract for this path.
    assert.equal(status.database.ok, true);
    // Iterate to cover variants or wait until a condition holds.
    for (const key of [
      // Execute the next setup or assertion step for this scenario.
      "rooms",
      // Execute the next setup or assertion step for this scenario.
      "commonAreas",
      // Execute the next setup or assertion step for this scenario.
      "openTickets",
      // Session/CSRF step exercising auth lifecycle.
      "runningSessions",
    // Execute the next setup or assertion step for this scenario.
    ] as const) {
      // Assert HTTP status matches the contract for this path.
      assert.equal(typeof status.counts[key], "number");
      // Assert HTTP status matches the contract for this path.
      assert.ok((status.counts[key] as number) >= 0);
    }
    // Assert HTTP status matches the contract for this path.
    assert.equal(typeof status.fetchedAt, "string");
  });

  // Case checks authz/session policy: GET /settings/system is authorized; anonymous is 401.
  it("GET /settings/system is authorized; anonymous is 401", async () => {
    // ok: HTTP response captured for status/body checks.
    const ok = await getJson(api, token, "/settings/system");
    // Assert HTTP status matches the contract for this path.
    assert.equal(ok.status, 200);
    // Bind counts for later setup or assertions in this scope.
    const counts = (ok.body as { counts?: Record<string, unknown> }).counts;
    // Assert collection size matches the expected post-condition.
    assert.ok(counts);
    // unauth: HTTP response captured for status/body checks.
    const unauth = await fetch(`${api}/settings/system`);
    // Assert HTTP status matches the contract for this path.
    assert.equal(unauth.status, 401);
  });

  // Case: HTTP PATCH without expectedVersion is 400 and does not mutate.
  it("HTTP PATCH without expectedVersion is 400 and does not mutate", async () => {
    // before: synchronize actors so the race window is observable.
    const before = await prisma.appSetting.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { key: "modules" },
    });
    // current: HTTP response captured for status/body checks.
    const current = await getSetting("modules");
    // res: HTTP response captured for status/body checks.
    const res = await patchJson(api, token, "/settings/modules", {
      // Execute the next setup or assertion step for this scenario.
      value: { ...current, analytics: !current.analytics },
      // Execute the next setup or assertion step for this scenario.
      reason: "missing-version",
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 400);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(
      // Await async work before asserting or releasing locks.
      await prisma.appSetting.findUniqueOrThrow({ where: { key: "modules" } }),
      // Execute the next setup or assertion step for this scenario.
      before,
    );
  });

  // Case: security: housekeeper without settings.manage gets 403.
  it("security: housekeeper without settings.manage gets 403", async () => {
    // hk: synchronize actors so the race window is observable.
    const hk = await loginBearer(api, world.hk1.email, "test-password-cln");
    // before: synchronize actors so the race window is observable.
    const before = await prisma.appSetting.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { key: "modules" },
    });
    // res: HTTP response captured for status/body checks.
    const res = await patchJson(api, hk.token, "/settings/modules", {
      // Execute the next setup or assertion step for this scenario.
      value: before.value,
      // Execute the next setup or assertion step for this scenario.
      reason: "forbidden",
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: before.version,
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 403);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(
      // Await async work before asserting or releasing locks.
      await prisma.appSetting.findUniqueOrThrow({ where: { key: "modules" } }),
      // Execute the next setup or assertion step for this scenario.
      before,
    );
    // system: HTTP response captured for status/body checks.
    const system = await getJson(api, hk.token, "/settings/system");
    // Assert HTTP status matches the contract for this path.
    assert.equal(system.status, 403);
  });

  // Case checks authz/session policy: security: unauthenticated PATCH is 401; invalid payload does not mutate.
  it("security: unauthenticated PATCH is 401; invalid payload does not mutate", async () => {
    // before: synchronize actors so the race window is observable.
    const before = await prisma.appSetting.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { key: "modules" },
    });
    // audits: synchronize actors so the race window is observable.
    const audits = await prisma.auditEvent.count({
      // SQL fragment used to observe locks or assert DB state.
      where: { entityType: "setting", entityId: "modules" },
    });
    // unauth: HTTP response captured for status/body checks.
    const unauth = await fetch(`${api}/settings/modules`, {
      // Configure method for the request/server under test.
      method: "PATCH",
      // Configure headers for the request/server under test.
      headers: { "Content-Type": "application/json" },
      // Configure body for the request/server under test.
      body: JSON.stringify({
        // Execute the next setup or assertion step for this scenario.
        value: { rooms: false },
        // Execute the next setup or assertion step for this scenario.
        reason: "no-auth",
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: before.version,
      }),
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(unauth.status, 401);

    // bad: HTTP response captured for status/body checks.
    const bad = await patchJson(api, token, "/settings/modules", {
      // Execute the next setup or assertion step for this scenario.
      value: { rooms: "yes" },
      // Execute the next setup or assertion step for this scenario.
      reason: "invalid",
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: before.version,
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(bad.status, 400);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(
      // Await async work before asserting or releasing locks.
      await prisma.appSetting.findUniqueOrThrow({ where: { key: "modules" } }),
      // Execute the next setup or assertion step for this scenario.
      before,
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Await async work before asserting or releasing locks.
      await prisma.auditEvent.count({
        // SQL fragment used to observe locks or assert DB state.
        where: { entityType: "setting", entityId: "modules" },
      }),
      // Execute the next setup or assertion step for this scenario.
      audits,
    );
  });
});
