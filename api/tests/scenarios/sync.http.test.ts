import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { prisma } from "../../src/db";
import { assertTestDatabase } from "../assertTestDatabase";
import { closeServer, listenApp, loginBearer, postJson } from "../httpHarness";
import { createCleaningWorld, cleanupCleaningWorld, resetCleaningWork, CLN_PASSWORD, hotelTodayYmd, type CleaningWorld } from "../cleaning/fixtures";
import { createCleaningTask } from "../../src/services/cleaning";
import { invalidateGrantCache } from "../../src/services/roleGrants";

let world: CleaningWorld;
let api: string;
let server: Awaited<ReturnType<typeof listenApp>>["server"];
let ownerToken: string;
let hkToken: string;
let optionId: string;
const commands = (overrides: Record<string, unknown> = {}) => ({
  commandId: randomUUID(),
  type: "ticket.report",
  payload: {
    locationId: world.locationAId,
    issueOptionId: optionId,
    blocksRoom: false,
    // Keep priority normal so resolve does not require notes unless tests opt in.
    priority: "normal",
    ...overrides,
  },
});

describe("P1 sync HTTP and PostgreSQL", () => {
  before(async () => {
    await assertTestDatabase(prisma);
    process.env.E2E_DISABLE_RATE_LIMIT = "1";
    world = await createCleaningWorld(prisma);
    ({ api, server } = await listenApp());
    ownerToken = (await loginBearer(api, world.owner.email, CLN_PASSWORD)).token;
    hkToken = (await loginBearer(api, world.hk1.email, CLN_PASSWORD)).token;
    optionId = (await prisma.issueOption.findFirstOrThrow({ where: { isActive: true, maintenanceCategory: { isActive: true } } })).id;
  });
  beforeEach(async () => { await resetCleaningWork(prisma, world); });
  after(async () => {
    if (server) await closeServer(server);
    if (world) {
      await prisma.syncRun.deleteMany({ where: { user: { employeeId: { in: world.employeeIds } } } });
      await prisma.notification.deleteMany({ where: { locationId: { in: [world.locationAId, world.locationBId] } } });
      await prisma.auditEvent.deleteMany({ where: { OR: [{ actorEmployeeId: { in: world.employeeIds } }, { locationId: { in: [world.locationAId, world.locationBId] } }] } });
      await prisma.ticketEvent.deleteMany({ where: { ticket: { locationId: { in: [world.locationAId, world.locationBId] } } } });
      await cleanupCleaningWorld(prisma, world);
    }
    await prisma.$disconnect();
  });
  it("temporary command storage errors are retryable inside HTTP 200; validation stays permanent", async () => {
    const command = commands();
    const trigger = `sync_retry_${randomUUID().replaceAll("-", "")}`;
    await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."commandId" = '${command.commandId}' THEN RAISE EXCEPTION 'temporary_sync_storage_failure'; END IF; RETURN NEW; END $$`);
    try {
      await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON "MaintenanceTicket" FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
      try {
        const response = await postJson(api, ownerToken, "/sync/push", { commands: [command] });
        assert.equal(response.status, 200);
        assert.deepEqual((response.body as any).results, [{ commandId: command.commandId, status: "error", message: "Temporary command failure", retryable: true }]);
        assert.equal(await prisma.maintenanceTicket.count({ where: { commandId: command.commandId } }), 0);
      } finally { await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON "MaintenanceTicket"`); }
    } finally { await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`); }
    const response = await postJson(api, ownerToken, "/sync/push", { commands: [command] });
    assert.equal(response.status, 200);
    assert.equal((response.body as any).results[0].status, "ok");
    assert.equal(await prisma.maintenanceTicket.count({ where: { commandId: command.commandId } }), 1);
    const invalid = { ...commands(), payload: { locationId: 42 } };
    const rejected = await postJson(api, ownerToken, "/sync/push", { commands: [invalid] });
    assert.equal(rejected.status, 200);
    assert.equal((rejected.body as any).results[0].retryable, false);
    assert.equal((rejected.body as any).results[0].code, "validation");
  });
  it("P0-10 original offline owner is enforced against the actual cookie session before batch or fallback writes", async () => {
    const command = commands();
    const session = await loginBearer(api, world.owner.email, CLN_PASSWORD);
    const csrf = "offline-identity-test";
    const before = {
      runs: await prisma.syncRun.count({ where: { userId: world.owner.userId } }),
      audit: await prisma.auditEvent.count({ where: { locationId: world.locationAId } }),
      notifications: await prisma.notification.count({ where: { locationId: world.locationAId } }),
    };
    for (const [url, body] of [
      ["/sync/push", { commands: [command] }],
      ["/maintenance/tickets", { ...command.payload, commandId: command.commandId }],
    ] as const) {
      const response = await fetch(`${api}${url}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `session=${session.token}; csrf=${csrf}`, "X-CSRF-Token": csrf, "X-Offline-User": world.hk1.userId },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 409);
      assert.equal((await response.json() as { error: string }).error, "identity_changed");
    }
    assert.equal(await prisma.maintenanceTicket.count({ where: { commandId: command.commandId } }), 0);
    assert.equal(await prisma.syncRun.count({ where: { userId: world.owner.userId } }), before.runs);
    assert.equal(await prisma.auditEvent.count({ where: { locationId: world.locationAId } }), before.audit);
    assert.equal(await prisma.notification.count({ where: { locationId: world.locationAId } }), before.notifications);
    // Matching binding is a real positive control through cookie auth + CSRF.
    const accepted = await fetch(`${api}/sync/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `session=${session.token}; csrf=${csrf}`, "X-CSRF-Token": csrf, "X-Offline-User": world.owner.userId },
      body: JSON.stringify({ commands: [command] }),
    });
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json() as any).results[0].status, "ok");
    const row = await prisma.maintenanceTicket.findUniqueOrThrow({ where: { commandId: command.commandId } });
    assert.equal(row.reportedByEmployeeId, world.owner.employeeId);
    const fallbackId = randomUUID();
    // Use location B so option-based duplicate detection does not reject the control write.
    const acceptedFallback = await fetch(`${api}/maintenance/tickets`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `session=${session.token}; csrf=${csrf}`, "X-CSRF-Token": csrf, "X-Offline-User": world.owner.userId },
      body: JSON.stringify({
        ...command.payload,
        locationId: world.locationBId,
        commandId: fallbackId,
      }),
    });
    assert.equal(acceptedFallback.status, 201);
    assert.equal((await prisma.maintenanceTicket.findUniqueOrThrow({ where: { commandId: fallbackId } })).reportedByEmployeeId, world.owner.employeeId);
  });
  it("P1-101 mixed batch preserves each result and continues after domain failure", async () => {
    const task = await createCleaningTask({ locationId: world.locationAId, hotelDate: await hotelTodayYmd(), assignedEmployeeId: world.hk1.employeeId });
    const batch = [
      { commandId: randomUUID(), type: "cleaning.start", payload: { taskId: task.id, expectedVersion: 999 } },
      { commandId: randomUUID(), type: "ticket.resolve", payload: { ticketId: "missing" } },
      { commandId: randomUUID(), type: "unknown.command", payload: {} },
      { commandId: randomUUID(), type: "cleaning.start", payload: { taskId: task.id, expectedVersion: task.version } },
    ];
    const res = await postJson(api, hkToken, "/sync/push", { commands: batch });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const body = res.body as any;
    assert.deepEqual(body.results.map((r: any) => [r.commandId, r.status]), batch.map((c, i) => [c.commandId, ["conflict", "forbidden", "error", "ok"][i]]));
    const run = await prisma.syncRun.findUniqueOrThrow({ where: { id: body.syncRunId } });
    assert.equal(run.status, "partial"); assert.equal(run.accepted, 1); assert.equal(run.rejected, 3);
    assert.equal(await prisma.cleaningSession.count({ where: { taskId: task.id, status: "running" } }), 1);
  });
  it("P1-112 foreign and revoked device attribution is rejected before commands; own device succeeds for push/pull", async () => {
    const foreign = await prisma.device.create({ data: { userId: world.hk2.userId, employeeId: world.hk2.employeeId, label: "foreign", fingerprint: randomUUID() } });
    const revoked = await prisma.device.create({ data: { userId: world.owner.userId, employeeId: world.owner.employeeId, label: "revoked", fingerprint: randomUUID(), revokedAt: new Date() } });
    const own = await prisma.device.create({ data: { userId: world.owner.userId, employeeId: world.owner.employeeId, label: "own", fingerprint: randomUUID() } });
    for (const device of [foreign, revoked]) {
      const cmd = commands();
      const before = await prisma.device.findUniqueOrThrow({ where: { id: device.id } });
      const res = await postJson(api, ownerToken, "/sync/push", { deviceId: device.id, commands: [cmd] });
      assert.equal(res.status, 403, JSON.stringify(res.body));
      assert.equal(await prisma.maintenanceTicket.count({ where: { commandId: cmd.commandId } }), 0);
      assert.equal(await prisma.syncRun.count({ where: { deviceId: device.id } }), 0);
      const pull = await fetch(`${api}/sync/pull?deviceId=${device.id}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
      assert.equal(pull.status, 403);
      assert.deepEqual(await prisma.device.findUniqueOrThrow({ where: { id: device.id } }), before);
    }
    const res = await postJson(api, ownerToken, "/sync/push", { deviceId: own.id, commands: [commands()] });
    assert.equal(res.status, 200);
    assert.equal((await prisma.syncRun.findUniqueOrThrow({ where: { id: (res.body as any).syncRunId } })).deviceId, own.id);
    assert.ok((await prisma.device.findUniqueOrThrow({ where: { id: own.id } })).lastSyncedAt);
  });
  it("P1-111 malformed payload is rejected without boolean/id coercion and following command still commits", async () => {
    for (const payload of [
      { locationId: world.locationAId, issueOptionId: optionId, blocksRoom: "false" },
      { locationId: world.locationAId, issueOptionId: optionId, priority: "invented" },
      { locationId: { toString: "bad" }, issueOptionId: optionId },
    ]) {
      // Isolate each iteration from prior successful reports on the same option.
      await resetCleaningWork(prisma, world);
      const invalid = { commandId: randomUUID(), type: "ticket.report", payload };
      const good = commands();
      const res = await postJson(api, ownerToken, "/sync/push", { commands: [invalid, good] });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual((res.body as any).results.map((r: any) => r.status), ["error", "ok"]);
      assert.equal(await prisma.maintenanceTicket.count({ where: { commandId: invalid.commandId } }), 0);
      assert.equal(await prisma.maintenanceTicket.count({ where: { commandId: good.commandId } }), 1);
    }
  });
  it("P1-105 P1-106 P1-107 current assignee and grants are rechecked even with a rebased version", async () => {
    const task = await createCleaningTask({ locationId: world.locationAId, hotelDate: await hotelTodayYmd(), assignedEmployeeId: world.hk1.employeeId });
    await prisma.cleaningTask.update({ where: { id: task.id }, data: { assignedEmployeeId: world.hk2.employeeId, version: { increment: 1 } } });
    const before = await prisma.cleaningTask.findUniqueOrThrow({ where: { id: task.id } });
    const location = await prisma.location.findUniqueOrThrow({ where: { id: world.locationAId } });
    for (const expectedVersion of [task.version, before.version]) {
      const cmd = { commandId: randomUUID(), type: "cleaning.start", payload: { taskId: task.id, expectedVersion } };
      const res = await postJson(api, hkToken, "/sync/push", { commands: [cmd] });
      assert.equal(res.status, 200);
      assert.equal((res.body as any).results[0].status, "conflict");
      assert.equal((res.body as any).results[0].details.assignedEmployeeId, world.hk2.employeeId);
    }
    assert.deepEqual(await prisma.cleaningTask.findUniqueOrThrow({ where: { id: task.id } }), before);
    assert.deepEqual(await prisma.location.findUniqueOrThrow({ where: { id: world.locationAId } }), location);
    assert.equal(await prisma.cleaningSession.count({ where: { taskId: task.id } }), 0);
    const grants = await prisma.roleGrant.findMany({ where: { role: "housekeeper", kind: "action", key: "tickets.report" } });
    try {
      await prisma.roleGrant.deleteMany({ where: { role: "housekeeper", kind: "action", key: "tickets.report" } }); invalidateGrantCache();
      const res = await postJson(api, hkToken, "/sync/push", { commands: [commands()] });
      assert.equal(res.status, 200); assert.equal((res.body as any).results[0].status, "forbidden");
    } finally {
      for (const grant of grants) await prisma.roleGrant.create({ data: grant }); invalidateGrantCache();
    }
  });
  it("P1-96 actual commit precedes lost HTTP response; identical retry creates one ticket/event/audit", async () => {
    const cmd = commands();
    let observedCommit = false;
    const proxy = http.createServer((req, res) => {
      const upstream = http.request(`${api}${req.url}`, { method: req.method, headers: req.headers }, response => {
        response.resume();
        response.on("end", () => { void (async () => {
          observedCommit = await prisma.maintenanceTicket.count({ where: { commandId: cmd.commandId } }) === 1;
          res.destroy();
        })(); });
      });
      upstream.on("error", () => res.destroy()); req.pipe(upstream);
    });
    await new Promise<void>(resolve => proxy.listen(0, "127.0.0.1", resolve));
    try {
      const address = proxy.address() as import("node:net").AddressInfo;
      await assert.rejects(postJson(`http://127.0.0.1:${address.port}`, ownerToken, "/sync/push", { commands: [cmd] }), /fetch failed/);
      assert.equal(observedCommit, true, "real commit was observed before destroying downstream socket");
      const ticket = await prisma.maintenanceTicket.findUniqueOrThrow({ where: { commandId: cmd.commandId } });
      const events = await prisma.ticketEvent.findMany({ where: { ticketId: ticket.id } });
      const audit = await prisma.auditEvent.findMany({ where: { entityId: ticket.id } });
      assert.ok(events.length > 0); assert.ok(audit.length > 0);
      const retry = await postJson(api, ownerToken, "/sync/push", { commands: [cmd] });
      assert.equal(retry.status, 200); assert.equal((retry.body as any).results[0].status, "ok");
      assert.equal(await prisma.maintenanceTicket.count({ where: { commandId: cmd.commandId } }), 1);
      assert.deepEqual(await prisma.ticketEvent.findMany({ where: { ticketId: ticket.id } }), events);
      assert.deepEqual(await prisma.auditEvent.findMany({ where: { entityId: ticket.id } }), audit);
    } finally { await closeServer(proxy); }
  });
  it("P1-104 start/wait/resume/resolve batch applies sequentially even with equal client times", async () => {
    const reported = await postJson(api, ownerToken, "/sync/push", { commands: [commands()] });
    assert.equal(reported.status, 200); const ticketId = (reported.body as any).results[0].data.ticket.id;
    await prisma.maintenanceTicket.update({ where: { id: ticketId }, data: { status: "assigned", assigneeId: world.owner.employeeId } });
    const batch = ["ticket.start", "ticket.wait", "ticket.resume", "ticket.resolve"].map(type => ({
      commandId: randomUUID(),
      type,
      payload:
        type === "ticket.resolve"
          ? { ticketId, resolutionNotes: "scenario resolve" }
          : { ticketId },
      clientTime: "2026-01-01T00:00:00Z",
    }));
    const res = await postJson(api, ownerToken, "/sync/push", { commands: batch }); assert.equal(res.status, 200);
    assert.deepEqual((res.body as any).results.map((r: any) => r.status), ["ok", "ok", "ok", "ok"]);
    assert.deepEqual((res.body as any).results.map((r: any) => r.data.status), ["in_progress", "waiting", "in_progress", "resolved"]);
    assert.equal((await prisma.maintenanceTicket.findUniqueOrThrow({ where: { id: ticketId } })).status, "resolved");
    const events = await prisma.ticketEvent.findMany({ where: { ticketId, commandId: { in: batch.map(c => c.commandId) } } });
    assert.equal(events.length, 4);
  });
});
