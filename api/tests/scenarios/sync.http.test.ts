// Load isolated P1 test env before any Prisma/DB clients connect.
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Import bindings from node:http.
import http from "node:http";
// Import bindings from node:crypto.
import { randomUUID } from "node:crypto";
// Node test runner and strict assertions for API suite checks.
import { after, before, beforeEach, describe, it } from "node:test";
// Import bindings from ../../src/db.
import { prisma } from "../../src/db";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// HTTP harness to listen an in-process API for request-level tests.
import { closeServer, listenApp, loginBearer, postJson } from "../httpHarness";
// Shared test fixtures for seeding users, locations, and domain entities.
import { createCleaningWorld, cleanupCleaningWorld, resetCleaningWork, CLN_PASSWORD, hotelTodayYmd, type CleaningWorld } from "../cleaning/fixtures";
// Import bindings from ../../src/services/cleaning.
import { createCleaningTask } from "../../src/services/cleaning";
// Import bindings from ../../src/services/roleGrants.
import { invalidateGrantCache } from "../../src/services/roleGrants";

// Execute the next setup or assertion step for this scenario.
let world: CleaningWorld;
// Execute the next setup or assertion step for this scenario.
let api: string;
// Execute the next setup or assertion step for this scenario.
let server: Awaited<ReturnType<typeof listenApp>>["server"];
// Execute the next setup or assertion step for this scenario.
let ownerToken: string;
// Execute the next setup or assertion step for this scenario.
let hkToken: string;
// Execute the next setup or assertion step for this scenario.
let optionId: string;
// Bind commands for later setup or assertions in this scope.
const commands = (overrides: Record<string, unknown> = {}) => ({
  // Execute the next setup or assertion step for this scenario.
  commandId: randomUUID(),
  // Execute the next setup or assertion step for this scenario.
  type: "ticket.report",
  // Execute the next setup or assertion step for this scenario.
  payload: {
    // Execute the next setup or assertion step for this scenario.
    locationId: world.locationAId,
    // Execute the next setup or assertion step for this scenario.
    issueOptionId: optionId,
    // Concurrency/isolation step for the race under test.
    blocksRoom: false,
    // Keep priority normal so resolve does not require notes unless tests opt in.
    priority: "normal",
    // Continue the call chain for setup or assertion detail.
    ...overrides,
  },
});

// Suite: P1 sync HTTP and PostgreSQL.
describe("P1 sync HTTP and PostgreSQL", () => {
  // Arrange shared preconditions before cases run.
  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    // Override env for isolation, rate-limit disable, or scheduler quieting.
    process.env.E2E_DISABLE_RATE_LIMIT = "1";
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createCleaningWorld(prisma);
    // Start or stop the in-process API server for this suite.
    ({ api, server } = await listenApp());
    // Await async work before asserting or releasing locks.
    ownerToken = (await loginBearer(api, world.owner.email, CLN_PASSWORD)).token;
    // Await async work before asserting or releasing locks.
    hkToken = (await loginBearer(api, world.hk1.email, CLN_PASSWORD)).token;
    // Await async work before asserting or releasing locks.
    optionId = (await prisma.issueOption.findFirstOrThrow({ where: { isActive: true, maintenanceCategory: { isActive: true } } })).id;
  });
  // Arrange shared preconditions before cases run.
  beforeEach(async () => { await resetCleaningWork(prisma, world); });
  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Guard optional cleanup or alternate assertion paths.
    if (server) await closeServer(server);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) {
      // Await async work before asserting or releasing locks.
      await prisma.syncRun.deleteMany({ where: { user: { employeeId: { in: world.employeeIds } } } });
      // Await async work before asserting or releasing locks.
      await prisma.notification.deleteMany({ where: { locationId: { in: [world.locationAId, world.locationBId] } } });
      // Await async work before asserting or releasing locks.
      await prisma.auditEvent.deleteMany({ where: { OR: [{ actorEmployeeId: { in: world.employeeIds } }, { locationId: { in: [world.locationAId, world.locationBId] } }] } });
      // Await async work before asserting or releasing locks.
      await prisma.ticketEvent.deleteMany({ where: { ticket: { locationId: { in: [world.locationAId, world.locationBId] } } } });
      // Await async work before asserting or releasing locks.
      await cleanupCleaningWorld(prisma, world);
    }
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });
  // Case: temporary command storage errors are retryable inside HTTP 200; validation stays permanent.
  it("temporary command storage errors are retryable inside HTTP 200; validation stays permanent", async () => {
    // Bind command for later setup or assertions in this scope.
    const command = commands();
    // trigger: unique stamp so parallel runs do not collide.
    const trigger = `sync_retry_${randomUUID().replaceAll("-", "")}`;
    // Await async work before asserting or releasing locks.
    await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."commandId" = '${command.commandId}' THEN RAISE EXCEPTION 'temporary_sync_storage_failure'; END IF; RETURN NEW; END $$`);
    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON "MaintenanceTicket" FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
      // Try path where partial failure must not leak suite state.
      try {
        // response: HTTP response captured for status/body checks.
        const response = await postJson(api, ownerToken, "/sync/push", { commands: [command] });
        // Assert HTTP status matches the contract for this path.
        assert.equal(response.status, 200);
        // Assert HTTP status matches the contract for this path.
        assert.deepEqual((response.body as any).results, [{ commandId: command.commandId, status: "error", message: "Temporary command failure", retryable: true }]);
        // Assert collection size matches the expected post-condition.
        assert.equal(await prisma.maintenanceTicket.count({ where: { commandId: command.commandId } }), 0);
      // Await async work before asserting or releasing locks.
      } finally { await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON "MaintenanceTicket"`); }
    // Await async work before asserting or releasing locks.
    } finally { await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`); }
    // response: HTTP response captured for status/body checks.
    const response = await postJson(api, ownerToken, "/sync/push", { commands: [command] });
    // Assert HTTP status matches the contract for this path.
    assert.equal(response.status, 200);
    // Assert HTTP status matches the contract for this path.
    assert.equal((response.body as any).results[0].status, "ok");
    // Assert collection size matches the expected post-condition.
    assert.equal(await prisma.maintenanceTicket.count({ where: { commandId: command.commandId } }), 1);
    // invalid: unique stamp so parallel runs do not collide.
    const invalid = { ...commands(), payload: { locationId: 42 } };
    // rejected: HTTP response captured for status/body checks.
    const rejected = await postJson(api, ownerToken, "/sync/push", { commands: [invalid] });
    // Assert HTTP status matches the contract for this path.
    assert.equal(rejected.status, 200);
    // Assert the observed value matches the intended post-condition.
    assert.equal((rejected.body as any).results[0].retryable, false);
    // Assert the observed value matches the intended post-condition.
    assert.equal((rejected.body as any).results[0].code, "validation");
  });
  // Case: original offline owner is enforced against the actual cookie session before batch or fallback writes.
  it("original offline owner is enforced against the actual cookie session before batch or fallback writes", async () => {
    // Bind command for later setup or assertions in this scope.
    const command = commands();
    // session: session cookie jar for authenticated requests.
    const session = await loginBearer(api, world.owner.email, CLN_PASSWORD);
    // csrf: credential/token material for auth flows.
    const csrf = "offline-identity-test";
    // Bind before for later setup or assertions in this scope.
    const before = {
      // Await async work before asserting or releasing locks.
      runs: await prisma.syncRun.count({ where: { userId: world.owner.userId } }),
      // Await async work before asserting or releasing locks.
      audit: await prisma.auditEvent.count({ where: { locationId: world.locationAId } }),
      // Await async work before asserting or releasing locks.
      notifications: await prisma.notification.count({ where: { locationId: world.locationAId } }),
    };
    // Iterate to cover variants or wait until a condition holds.
    for (const [url, body] of [
      // Execute the next setup or assertion step for this scenario.
      ["/sync/push", { commands: [command] }],
      // Execute the next setup or assertion step for this scenario.
      ["/maintenance/tickets", { ...command.payload, commandId: command.commandId }],
    // Execute the next setup or assertion step for this scenario.
    ] as const) {
      // response: HTTP response captured for status/body checks.
      const response = await fetch(`${api}${url}`, {
        // Configure method for the request/server under test.
        method: "POST",
        // Configure headers for the request/server under test.
        headers: { "Content-Type": "application/json", Cookie: `session=${session.token}; csrf=${csrf}`, "X-CSRF-Token": csrf, "X-Offline-User": world.hk1.userId },
        // Configure body for the request/server under test.
        body: JSON.stringify(body),
      });
      // Assert HTTP status matches the contract for this path.
      assert.equal(response.status, 409);
      // Assert the observed value matches the intended post-condition.
      assert.equal((await response.json() as { error: string }).error, "identity_changed");
    }
    // Assert collection size matches the expected post-condition.
    assert.equal(await prisma.maintenanceTicket.count({ where: { commandId: command.commandId } }), 0);
    // Assert collection size matches the expected post-condition.
    assert.equal(await prisma.syncRun.count({ where: { userId: world.owner.userId } }), before.runs);
    // Assert collection size matches the expected post-condition.
    assert.equal(await prisma.auditEvent.count({ where: { locationId: world.locationAId } }), before.audit);
    // Assert collection size matches the expected post-condition.
    assert.equal(await prisma.notification.count({ where: { locationId: world.locationAId } }), before.notifications);
    // Matching binding is a real positive control through cookie auth + CSRF.
    const accepted = await fetch(`${api}/sync/push`, {
      // Configure method for the request/server under test.
      method: "POST",
      // Configure headers for the request/server under test.
      headers: { "Content-Type": "application/json", Cookie: `session=${session.token}; csrf=${csrf}`, "X-CSRF-Token": csrf, "X-Offline-User": world.owner.userId },
      // Configure body for the request/server under test.
      body: JSON.stringify({ commands: [command] }),
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(accepted.status, 200);
    // Assert HTTP status matches the contract for this path.
    assert.equal((await accepted.json() as any).results[0].status, "ok");
    // row: synchronize actors so the race window is observable.
    const row = await prisma.maintenanceTicket.findUniqueOrThrow({ where: { commandId: command.commandId } });
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.reportedByEmployeeId, world.owner.employeeId);
    // fallbackId: unique stamp so parallel runs do not collide.
    const fallbackId = randomUUID();
    // Use location B so option-based duplicate detection does not reject the control write.
    const acceptedFallback = await fetch(`${api}/maintenance/tickets`, {
      // Configure method for the request/server under test.
      method: "POST",
      // Configure headers for the request/server under test.
      headers: { "Content-Type": "application/json", Cookie: `session=${session.token}; csrf=${csrf}`, "X-CSRF-Token": csrf, "X-Offline-User": world.owner.userId },
      // Configure body for the request/server under test.
      body: JSON.stringify({
        // Continue the call chain for setup or assertion detail.
        ...command.payload,
        // Execute the next setup or assertion step for this scenario.
        locationId: world.locationBId,
        // Execute the next setup or assertion step for this scenario.
        commandId: fallbackId,
      }),
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(acceptedFallback.status, 201);
    // Assert the observed value matches the intended post-condition.
    assert.equal((await prisma.maintenanceTicket.findUniqueOrThrow({ where: { commandId: fallbackId } })).reportedByEmployeeId, world.owner.employeeId);
  });
  // Case: mixed batch preserves each result and continues after domain failure.
  it("mixed batch preserves each result and continues after domain failure", async () => {
    // task: seeded entity required before the mutation under test.
    const task = await createCleaningTask({ locationId: world.locationAId, hotelDate: await hotelTodayYmd(), assignedEmployeeId: world.hk1.employeeId });
    // Bind batch for later setup or assertions in this scope.
    const batch = [
      // Execute the next setup or assertion step for this scenario.
      { commandId: randomUUID(), type: "cleaning.start", payload: { taskId: task.id, expectedVersion: 999 } },
      // Execute the next setup or assertion step for this scenario.
      { commandId: randomUUID(), type: "ticket.resolve", payload: { ticketId: "missing" } },
      // Execute the next setup or assertion step for this scenario.
      { commandId: randomUUID(), type: "unknown.command", payload: {} },
      // Execute the next setup or assertion step for this scenario.
      { commandId: randomUUID(), type: "cleaning.start", payload: { taskId: task.id, expectedVersion: task.version } },
    ];
    // res: HTTP response captured for status/body checks.
    const res = await postJson(api, hkToken, "/sync/push", { commands: batch });
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200, JSON.stringify(res.body));
    // Bind body for later setup or assertions in this scope.
    const body = res.body as any;
    // Assert HTTP status matches the contract for this path.
    assert.deepEqual(body.results.map((r: any) => [r.commandId, r.status]), batch.map((c, i) => [c.commandId, ["conflict", "forbidden", "error", "ok"][i]]));
    // run: synchronize actors so the race window is observable.
    const run = await prisma.syncRun.findUniqueOrThrow({ where: { id: body.syncRunId } });
    // Assert HTTP status matches the contract for this path.
    assert.equal(run.status, "partial"); assert.equal(run.accepted, 1); assert.equal(run.rejected, 3);
    // Assert HTTP status matches the contract for this path.
    assert.equal(await prisma.cleaningSession.count({ where: { taskId: task.id, status: "running" } }), 1);
  });
  // Case: foreign and revoked device attribution is rejected before commands; own device succeeds for push/pull.
  it("foreign and revoked device attribution is rejected before commands; own device succeeds for push/pull", async () => {
    // foreign: unique stamp so parallel runs do not collide.
    const foreign = await prisma.device.create({ data: { userId: world.hk2.userId, employeeId: world.hk2.employeeId, label: "foreign", fingerprint: randomUUID() } });
    // revoked: unique stamp so parallel runs do not collide.
    const revoked = await prisma.device.create({ data: { userId: world.owner.userId, employeeId: world.owner.employeeId, label: "revoked", fingerprint: randomUUID(), revokedAt: new Date() } });
    // own: unique stamp so parallel runs do not collide.
    const own = await prisma.device.create({ data: { userId: world.owner.userId, employeeId: world.owner.employeeId, label: "own", fingerprint: randomUUID() } });
    // Iterate to cover variants or wait until a condition holds.
    for (const device of [foreign, revoked]) {
      // Bind cmd for later setup or assertions in this scope.
      const cmd = commands();
      // before: synchronize actors so the race window is observable.
      const before = await prisma.device.findUniqueOrThrow({ where: { id: device.id } });
      // res: HTTP response captured for status/body checks.
      const res = await postJson(api, ownerToken, "/sync/push", { deviceId: device.id, commands: [cmd] });
      // Assert HTTP status matches the contract for this path.
      assert.equal(res.status, 403, JSON.stringify(res.body));
      // Assert collection size matches the expected post-condition.
      assert.equal(await prisma.maintenanceTicket.count({ where: { commandId: cmd.commandId } }), 0);
      // Assert collection size matches the expected post-condition.
      assert.equal(await prisma.syncRun.count({ where: { deviceId: device.id } }), 0);
      // pull: HTTP response captured for status/body checks.
      const pull = await fetch(`${api}/sync/pull?deviceId=${device.id}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
      // Assert HTTP status matches the contract for this path.
      assert.equal(pull.status, 403);
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual(await prisma.device.findUniqueOrThrow({ where: { id: device.id } }), before);
    }
    // res: HTTP response captured for status/body checks.
    const res = await postJson(api, ownerToken, "/sync/push", { deviceId: own.id, commands: [commands()] });
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200);
    // Assert the observed value matches the intended post-condition.
    assert.equal((await prisma.syncRun.findUniqueOrThrow({ where: { id: (res.body as any).syncRunId } })).deviceId, own.id);
    // Assert the observed value matches the intended post-condition.
    assert.ok((await prisma.device.findUniqueOrThrow({ where: { id: own.id } })).lastSyncedAt);
  });
  // Case: malformed payload is rejected without boolean/id coercion and following command still commits.
  it("malformed payload is rejected without boolean/id coercion and following command still commits", async () => {
    // Iterate to cover variants or wait until a condition holds.
    for (const payload of [
      // Concurrency/isolation step for the race under test.
      { locationId: world.locationAId, issueOptionId: optionId, blocksRoom: "false" },
      // Execute the next setup or assertion step for this scenario.
      { locationId: world.locationAId, issueOptionId: optionId, priority: "invented" },
      // Execute the next setup or assertion step for this scenario.
      { locationId: { toString: "bad" }, issueOptionId: optionId },
    // Execute the next setup or assertion step for this scenario.
    ]) {
      // Isolate each iteration from prior successful reports on the same option.
      await resetCleaningWork(prisma, world);
      // invalid: unique stamp so parallel runs do not collide.
      const invalid = { commandId: randomUUID(), type: "ticket.report", payload };
      // Bind good for later setup or assertions in this scope.
      const good = commands();
      // res: HTTP response captured for status/body checks.
      const res = await postJson(api, ownerToken, "/sync/push", { commands: [invalid, good] });
      // Assert HTTP status matches the contract for this path.
      assert.equal(res.status, 200, JSON.stringify(res.body));
      // Assert HTTP status matches the contract for this path.
      assert.deepEqual((res.body as any).results.map((r: any) => r.status), ["error", "ok"]);
      // Assert collection size matches the expected post-condition.
      assert.equal(await prisma.maintenanceTicket.count({ where: { commandId: invalid.commandId } }), 0);
      // Assert collection size matches the expected post-condition.
      assert.equal(await prisma.maintenanceTicket.count({ where: { commandId: good.commandId } }), 1);
    }
  });
  // Case: current assignee and grants are rechecked even with a rebased version.
  it("current assignee and grants are rechecked even with a rebased version", async () => {
    // task: seeded entity required before the mutation under test.
    const task = await createCleaningTask({ locationId: world.locationAId, hotelDate: await hotelTodayYmd(), assignedEmployeeId: world.hk1.employeeId });
    // Await async work before asserting or releasing locks.
    await prisma.cleaningTask.update({ where: { id: task.id }, data: { assignedEmployeeId: world.hk2.employeeId, version: { increment: 1 } } });
    // before: synchronize actors so the race window is observable.
    const before = await prisma.cleaningTask.findUniqueOrThrow({ where: { id: task.id } });
    // location: synchronize actors so the race window is observable.
    const location = await prisma.location.findUniqueOrThrow({ where: { id: world.locationAId } });
    // Iterate to cover variants or wait until a condition holds.
    for (const expectedVersion of [task.version, before.version]) {
      // cmd: unique stamp so parallel runs do not collide.
      const cmd = { commandId: randomUUID(), type: "cleaning.start", payload: { taskId: task.id, expectedVersion } };
      // res: HTTP response captured for status/body checks.
      const res = await postJson(api, hkToken, "/sync/push", { commands: [cmd] });
      // Assert HTTP status matches the contract for this path.
      assert.equal(res.status, 200);
      // Assert HTTP status matches the contract for this path.
      assert.equal((res.body as any).results[0].status, "conflict");
      // Assert the observed value matches the intended post-condition.
      assert.equal((res.body as any).results[0].details.assignedEmployeeId, world.hk2.employeeId);
    }
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await prisma.cleaningTask.findUniqueOrThrow({ where: { id: task.id } }), before);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await prisma.location.findUniqueOrThrow({ where: { id: world.locationAId } }), location);
    // Assert collection size matches the expected post-condition.
    assert.equal(await prisma.cleaningSession.count({ where: { taskId: task.id } }), 0);
    // grants: synchronize actors so the race window is observable.
    const grants = await prisma.roleGrant.findMany({ where: { role: "housekeeper", kind: "action", key: "tickets.report" } });
    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await prisma.roleGrant.deleteMany({ where: { role: "housekeeper", kind: "action", key: "tickets.report" } }); invalidateGrantCache();
      // res: HTTP response captured for status/body checks.
      const res = await postJson(api, hkToken, "/sync/push", { commands: [commands()] });
      // Assert HTTP status matches the contract for this path.
      assert.equal(res.status, 200); assert.equal((res.body as any).results[0].status, "forbidden");
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Iterate to cover variants or wait until a condition holds.
      for (const grant of grants) await prisma.roleGrant.create({ data: grant }); invalidateGrantCache();
    }
  });
  // Case: actual commit precedes lost HTTP response; identical retry creates one ticket/event/audit.
  it("actual commit precedes lost HTTP response; identical retry creates one ticket/event/audit", async () => {
    // Bind cmd for later setup or assertions in this scope.
    const cmd = commands();
    // Bind observedCommit for later setup or assertions in this scope.
    let observedCommit = false;
    // Bind proxy for later setup or assertions in this scope.
    const proxy = http.createServer((req, res) => {
      // Bind upstream for later setup or assertions in this scope.
      const upstream = http.request(`${api}${req.url}`, { method: req.method, headers: req.headers }, response => {
        // Execute the next setup or assertion step for this scenario.
        response.resume();
        // Execute the next setup or assertion step for this scenario.
        response.on("end", () => { void (async () => {
          // Await async work before asserting or releasing locks.
          observedCommit = await prisma.maintenanceTicket.count({ where: { commandId: cmd.commandId } }) === 1;
          // Execute the next setup or assertion step for this scenario.
          res.destroy();
        // Execute the next setup or assertion step for this scenario.
        })(); });
      });
      // Execute the next setup or assertion step for this scenario.
      upstream.on("error", () => res.destroy()); req.pipe(upstream);
    });
    // Await async work before asserting or releasing locks.
    await new Promise<void>(resolve => proxy.listen(0, "127.0.0.1", resolve));
    // Try path where partial failure must not leak suite state.
    try {
      // Bind address for later setup or assertions in this scope.
      const address = proxy.address() as import("node:net").AddressInfo;
      // Await async work before asserting or releasing locks.
      await assert.rejects(postJson(`http://127.0.0.1:${address.port}`, ownerToken, "/sync/push", { commands: [cmd] }), /fetch failed/);
      // Assert the observed value matches the intended post-condition.
      assert.equal(observedCommit, true, "real commit was observed before destroying downstream socket");
      // ticket: synchronize actors so the race window is observable.
      const ticket = await prisma.maintenanceTicket.findUniqueOrThrow({ where: { commandId: cmd.commandId } });
      // events: synchronize actors so the race window is observable.
      const events = await prisma.ticketEvent.findMany({ where: { ticketId: ticket.id } });
      // audit: synchronize actors so the race window is observable.
      const audit = await prisma.auditEvent.findMany({ where: { entityId: ticket.id } });
      // Assert collection size matches the expected post-condition.
      assert.ok(events.length > 0); assert.ok(audit.length > 0);
      // retry: HTTP response captured for status/body checks.
      const retry = await postJson(api, ownerToken, "/sync/push", { commands: [cmd] });
      // Assert HTTP status matches the contract for this path.
      assert.equal(retry.status, 200); assert.equal((retry.body as any).results[0].status, "ok");
      // Assert collection size matches the expected post-condition.
      assert.equal(await prisma.maintenanceTicket.count({ where: { commandId: cmd.commandId } }), 1);
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual(await prisma.ticketEvent.findMany({ where: { ticketId: ticket.id } }), events);
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual(await prisma.auditEvent.findMany({ where: { entityId: ticket.id } }), audit);
    // Start or stop the in-process API server for this suite.
    } finally { await closeServer(proxy); }
  });
  // Case: start/wait/resume/resolve batch applies sequentially even with equal client times.
  it("start/wait/resume/resolve batch applies sequentially even with equal client times", async () => {
    // reported: HTTP response captured for status/body checks.
    const reported = await postJson(api, ownerToken, "/sync/push", { commands: [commands()] });
    // Assert HTTP status matches the contract for this path.
    assert.equal(reported.status, 200); const ticketId = (reported.body as any).results[0].data.ticket.id;
    // Await async work before asserting or releasing locks.
    await prisma.maintenanceTicket.update({ where: { id: ticketId }, data: { status: "assigned", assigneeId: world.owner.employeeId } });
    // Bind batch for later setup or assertions in this scope.
    const batch = ["ticket.start", "ticket.wait", "ticket.resume", "ticket.resolve"].map(type => ({
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
      // Execute the next setup or assertion step for this scenario.
      type,
      // Execute the next setup or assertion step for this scenario.
      payload:
        // Execute the next setup or assertion step for this scenario.
        type === "ticket.resolve"
          ? { ticketId, resolutionNotes: "scenario resolve" }
          : { ticketId },
      // Execute the next setup or assertion step for this scenario.
      clientTime: "2026-01-01T00:00:00Z",
    }));
    // res: HTTP response captured for status/body checks.
    const res = await postJson(api, ownerToken, "/sync/push", { commands: batch }); assert.equal(res.status, 200);
    // Assert HTTP status matches the contract for this path.
    assert.deepEqual((res.body as any).results.map((r: any) => r.status), ["ok", "ok", "ok", "ok"]);
    // Assert HTTP status matches the contract for this path.
    assert.deepEqual((res.body as any).results.map((r: any) => r.data.status), ["in_progress", "waiting", "in_progress", "resolved"]);
    // Assert HTTP status matches the contract for this path.
    assert.equal((await prisma.maintenanceTicket.findUniqueOrThrow({ where: { id: ticketId } })).status, "resolved");
    // events: synchronize actors so the race window is observable.
    const events = await prisma.ticketEvent.findMany({ where: { ticketId, commandId: { in: batch.map(c => c.commandId) } } });
    // Assert collection size matches the expected post-condition.
    assert.equal(events.length, 4);
  });
});
