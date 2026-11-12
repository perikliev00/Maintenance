// Import local module ../../tests/dbBarrier.
import { withDatabaseBarrier } from "../../tests/dbBarrier";
/**
 * HTTP integration: people block/unblock/archive/restore, last-owner race,
 * stale expectedStatus, unfinished work on archive.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { after, before, describe, it } from "node:test";
// Continue named import list.
import {
  // Bring InvitationStatus into scope from the import.
  InvitationStatus,
  // Bring PrismaClient into scope from the import.
  PrismaClient,
  // Bring Role into scope from the import.
  Role,
  // Bring TaskStatus into scope from the import.
  TaskStatus,
} from "@prisma/client";
import dotenv from "dotenv";
// Continue named import list.
import {
  // Bring cleanupEmployeeGraph into scope from the import.
  cleanupEmployeeGraph,
  // Bring createEmployeeWithUser into scope from the import.
  createEmployeeWithUser,
  type EmployeeUserFixture,
} from "../../tests/fixtures";
// Continue named import list.
import {
  // Bring closeServer into scope from the import.
  closeServer,
  // Bring getJson into scope from the import.
  getJson,
  // Bring listenApp into scope from the import.
  listenApp,
  // Bring loginBearer into scope from the import.
  loginBearer,
  // Bring postJson into scope from the import.
  postJson,
} from "../../tests/httpHarness";
// Import local module ../startup/requiredDefaults.
import { initializeRequiredDefaults } from "../startup/requiredDefaults";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-secret-for-people-lifecycle-http";

const prisma = new PrismaClient();

// Async helper accessVersionOf keeps handler bodies thin.
async function accessVersionOf(employeeId: string): Promise<number> {
  const row = await prisma.employee.findUniqueOrThrow({
    where: { id: employeeId },
    select: { accessVersion: true },
  });
  // Return value or early exit.
  return row.accessVersion;
}

// Test suite grouping related cases.
describe("people lifecycle HTTP", () => {
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  // Mutable api updated as the flow proceeds.
  let api = "";
  const fixtureIds: string[] = [];
  let ownerActor: EmployeeUserFixture;
  let managerActor: EmployeeUserFixture;
  let target: EmployeeUserFixture;

  // Setup hook run before tests.
  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Await side-effecting async work.
    await initializeRequiredDefaults();
    const stamp = Date.now();

    ownerActor = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-LC-OA-${stamp}`,
      email: `t-lc-oa-${stamp}@test.local`,
      role: Role.owner,
      fullName: "T Lifecycle Owner",
    });
    managerActor = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-LC-MGR-${stamp}`,
      email: `t-lc-mgr-${stamp}@test.local`,
      role: Role.manager,
      fullName: "T Lifecycle Manager",
    });
    target = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-LC-TGT-${stamp}`,
      email: `t-lc-tgt-${stamp}@test.local`,
      role: Role.housekeeper,
      fullName: "T Lifecycle Target",
    });
    fixtureIds.push(
      // Pass ownerActor.employeeId through.
      ownerActor.employeeId,
      // Pass managerActor.employeeId through.
      managerActor.employeeId,
      // Pass target.employeeId through.
      target.employeeId,
    );

    const listened = await listenApp();
    server = listened.server;
    api = listened.api;
  });

  // Teardown hook run after tests.
  after(async () => {
    // Branch when this condition holds.
    if (server) await closeServer(server);
    // Await side-effecting async work.
    await cleanupEmployeeGraph(prisma, fixtureIds);
    // Await side-effecting async work.
    await prisma.$disconnect();
  });

  // Single test case asserting expected behavior.
  it("blocks then unblocks: sessions/invites/devices stopped; unblock does not restore them", async () => {
    // Await side-effecting async work.
    await prisma.user.update({
      where: { id: target.userId },
      data: { isActive: true },
    });
    // Await side-effecting async work.
    await prisma.employee.update({
      where: { id: target.employeeId },
      data: { archivedAt: null },
    });

    const device = await prisma.device.create({
      data: {
        userId: target.userId,
        employeeId: target.employeeId,
        label: "Phone",
        fingerprint: `fp-lc-${Date.now()}`,
      },
    });
    // Await side-effecting async work.
    await prisma.authSession.create({
      data: {
        userId: target.userId,
        deviceId: device.id,
        refreshTokenHash: `rh-lc-${Date.now()}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    // Await side-effecting async work.
    await prisma.invitation.create({
      data: {
        codeHash: `ch-lc-${Date.now()}`,
        codeHint: "abcd",
        employeeId: target.employeeId,
        role: Role.housekeeper,
        email: target.email,
        status: InvitationStatus.issued,
        expiresAt: new Date(Date.now() + 86_400_000),
        createdByUserId: ownerActor.userId,
      },
    });

    const { token: actorTok } = await loginBearer(
      api,
      // Pass managerActor.email through.
      managerActor.email,
      // Pass string literal argument.
      "test-password-t03",
    );
    const v0 = await accessVersionOf(target.employeeId);
    const blocked = await postJson(
      api,
      actorTok,
      `/people/${target.employeeId}/block`,
      { expectedStatus: "active", accessVersion: v0 },
    );
    assert.equal(blocked.status, 200, JSON.stringify(blocked.body));
    assert.equal((blocked.body as { status?: string }).status, "blocked");
    assert.equal(
      (blocked.body as { accessVersion?: number }).accessVersion,
      v0 + 1,
    );

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: target.userId },
    });
    assert.equal(user.isActive, false);
    const sessions = await prisma.authSession.findMany({
      where: { userId: target.userId },
    });
    assert.ok(sessions.every((s) => s.revokedAt != null));
    const invites = await prisma.invitation.findMany({
      where: {
        employeeId: target.employeeId,
        status: InvitationStatus.issued,
      },
    });
    assert.equal(invites.length, 0);
    const devices = await prisma.device.findMany({
      where: { employeeId: target.employeeId, revokedAt: null },
    });
    assert.equal(devices.length, 0);

    const loginRes = await fetch(`${api}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: target.email,
        password: "test-password-t03",
      }),
    });
    assert.equal(loginRes.status, 401);

    const v1 = await accessVersionOf(target.employeeId);
    const unblocked = await postJson(
      api,
      actorTok,
      `/people/${target.employeeId}/unblock`,
      { expectedStatus: "blocked", accessVersion: v1 },
    );
    assert.equal(unblocked.status, 200, JSON.stringify(unblocked.body));
    assert.equal((unblocked.body as { status?: string }).status, "active");

    const devicesAfter = await prisma.device.findMany({
      where: { employeeId: target.employeeId, revokedAt: null },
    });
    assert.equal(devicesAfter.length, 0);

    const audit = await prisma.auditEvent.findFirst({
      where: { entityId: target.employeeId, action: "people.block" },
      orderBy: { occurredAt: "desc" },
    });
    assert.ok(audit);
  });

  // Single test case asserting expected behavior.
  it("rejects stale expectedStatus and self-block", async () => {
    // Await side-effecting async work.
    await prisma.user.update({
      where: { id: target.userId },
      data: { isActive: true },
    });
    // Await side-effecting async work.
    await prisma.employee.update({
      where: { id: target.employeeId },
      data: { archivedAt: null },
    });

    const { token: actorTok } = await loginBearer(
      api,
      // Pass managerActor.email through.
      managerActor.email,
      // Pass string literal argument.
      "test-password-t03",
    );
    const v = await accessVersionOf(target.employeeId);
    const stale = await postJson(
      api,
      actorTok,
      `/people/${target.employeeId}/unblock`,
      { expectedStatus: "blocked", accessVersion: v },
    );
    assert.equal(stale.status, 409);
    assert.equal((stale.body as { error?: string }).error, "stale_state");

    const selfV = await accessVersionOf(managerActor.employeeId);
    const selfBlock = await postJson(
      api,
      actorTok,
      `/people/${managerActor.employeeId}/block`,
      { expectedStatus: "active", accessVersion: selfV },
    );
    assert.equal(selfBlock.status, 403);
  });

  // Single test case asserting expected behavior.
  it("rejects ABA unblock after blocked→active→blocked with old accessVersion", async () => {
    // Await side-effecting async work.
    await prisma.user.update({
      where: { id: target.userId },
      data: { isActive: false },
    });
    // Await side-effecting async work.
    await prisma.employee.update({
      where: { id: target.employeeId },
      data: { archivedAt: null },
    });
    const oldVersion = await accessVersionOf(target.employeeId);

    const { token: actorTok } = await loginBearer(
      api,
      // Pass managerActor.email through.
      managerActor.email,
      // Pass string literal argument.
      "test-password-t03",
    );

    const unblocked = await postJson(
      api,
      actorTok,
      `/people/${target.employeeId}/unblock`,
      { expectedStatus: "blocked", accessVersion: oldVersion },
    );
    assert.equal(unblocked.status, 200, JSON.stringify(unblocked.body));

    const vAfterUnblock = await accessVersionOf(target.employeeId);
    const reblocked = await postJson(
      api,
      actorTok,
      `/people/${target.employeeId}/block`,
      { expectedStatus: "active", accessVersion: vAfterUnblock },
    );
    assert.equal(reblocked.status, 200, JSON.stringify(reblocked.body));

    // Stale decision from before the cycle must not unblock again.
    const staleUnblock = await postJson(
      api,
      actorTok,
      `/people/${target.employeeId}/unblock`,
      { expectedStatus: "blocked", accessVersion: oldVersion },
    );
    assert.equal(staleUnblock.status, 409);
    assert.equal(
      (staleUnblock.body as { error?: string }).error,
      // Pass string literal argument.
      "stale_state",
    );
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: target.userId },
    });
    assert.equal(user.isActive, false);
  });

  // Single test case asserting expected behavior.
  it("archive refuses unfinished work; restore leaves account blocked", async () => {
    const stamp = Date.now();
    const worker = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-LC-WK-${stamp}`,
      email: `t-lc-wk-${stamp}@test.local`,
      role: Role.housekeeper,
      fullName: "T Lifecycle Worker",
    });
    fixtureIds.push(worker.employeeId);

    const location = await prisma.location.findFirst({
      where: { catalogStatus: "active" },
    });
    assert.ok(location, "need an active location in isolation DB");

    // Await side-effecting async work.
    await prisma.cleaningTask.create({
      data: {
        locationId: location.id,
        assignedEmployeeId: worker.employeeId,
        status: TaskStatus.assigned,
        serviceType: "stayover",
        hotelDate: new Date("2026-10-28T00:00:00.000Z"),
      },
    });

    const { token: actorTok } = await loginBearer(
      api,
      // Pass managerActor.email through.
      managerActor.email,
      // Pass string literal argument.
      "test-password-t03",
    );
    const v0 = await accessVersionOf(worker.employeeId);
    const refused = await postJson(
      api,
      actorTok,
      `/people/${worker.employeeId}/archive`,
      { expectedStatus: "active", accessVersion: v0 },
    );
    assert.equal(refused.status, 409);
    assert.equal((refused.body as { error?: string }).error, "unfinished_work");

    // Await side-effecting async work.
    await prisma.cleaningTask.updateMany({
      where: { assignedEmployeeId: worker.employeeId },
      data: { status: TaskStatus.completed },
    });

    const archived = await postJson(
      api,
      actorTok,
      `/people/${worker.employeeId}/archive`,
      { expectedStatus: "active", accessVersion: v0 },
    );
    assert.equal(archived.status, 200, JSON.stringify(archived.body));
    assert.equal((archived.body as { status?: string }).status, "archived");

    const vArchived = await accessVersionOf(worker.employeeId);
    const restored = await postJson(
      api,
      actorTok,
      `/people/${worker.employeeId}/restore`,
      { expectedStatus: "archived", accessVersion: vArchived },
    );
    assert.equal(restored.status, 200, JSON.stringify(restored.body));
    assert.equal((restored.body as { status?: string }).status, "blocked");
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: worker.userId },
    });
    assert.equal(user.isActive, false);
  });

  // Single test case asserting expected behavior.
  it("concurrent block of last two active owners leaves one active", async () => {
    const stamp = Date.now();
    const a = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-LC-O1-${stamp}`,
      email: `t-lc-o1-${stamp}@test.local`,
      role: Role.owner,
      fullName: "T Lifecycle Owner1",
    });
    const b = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-LC-O2-${stamp}`,
      email: `t-lc-o2-${stamp}@test.local`,
      role: Role.owner,
      fullName: "T Lifecycle Owner2",
    });
    fixtureIds.push(a.employeeId, b.employeeId);

    const priorOwners = (
      // Await side-effecting async work.
      await prisma.user.findMany({
        where: { role: Role.owner, isActive: true },
        select: { id: true },
      })
    ).map((r) => r.id);

    // Try block for operations that may throw.
    try {
      // Mutable raced updated as the flow proceeds.
      let raced = false;
      // Iterate to process each item.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        // Await side-effecting async work.
        await prisma.user.updateMany({
          where: {
            role: Role.owner,
            isActive: true,
            id: { notIn: [a.userId, b.userId] },
          },
          data: { isActive: false },
        });
        // Await side-effecting async work.
        await prisma.user.updateMany({
          where: { id: { in: [a.userId, b.userId] } },
          data: { role: Role.owner, isActive: true },
        });
        // Await side-effecting async work.
        await prisma.employee.updateMany({
          where: { id: { in: [a.employeeId, b.employeeId] } },
          data: { archivedAt: null },
        });

        const beforeRace = await prisma.user.count({
          where: { role: Role.owner, isActive: true },
        });
        // Branch when this condition holds.
        if (beforeRace !== 2) continue;

        const [{ token: tokA }, { token: tokB }] = await Promise.all([
          loginBearer(api, a.email, "test-password-t03"),
          loginBearer(api, b.email, "test-password-t03"),
        ]);
        const [vA, vB] = await Promise.all([
          accessVersionOf(a.employeeId),
          accessVersionOf(b.employeeId),
        ]);

        const [rAb, rBa] = await withDatabaseBarrier(
          prisma,
          (tx) =>
            tx.$queryRaw`
              SELECT id FROM "User"
              WHERE id IN (${a.userId}, ${b.userId})
              ORDER BY id FOR UPDATE
            `,
          () =>
            Promise.all([
              postJson(api, tokA, `/people/${b.employeeId}/block`, {
                expectedStatus: "active",
                accessVersion: vB,
              }),
              postJson(api, tokB, `/people/${a.employeeId}/block`, {
                expectedStatus: "active",
                accessVersion: vA,
              }),
            ]),
        );

        assert.deepEqual([rAb.status, rBa.status].sort(), [200, 409]);
        const remaining = await prisma.user.count({
          where: { role: Role.owner, isActive: true },
        });
        assert.equal(remaining, 1);
        raced = true;
        break;
      }
      assert.equal(raced, true, "failed to establish exclusive 2-owner race");
    } finally {
      // Await side-effecting async work.
      await prisma.user.updateMany({
        where: { id: { in: priorOwners } },
        data: { role: Role.owner, isActive: true },
      });
    }
  });

  // Single test case asserting expected behavior.
  it("GET person and devices omit fingerprint; list hides archived by default", async () => {
    const stamp = Date.now();
    const archivedEmp = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-LC-AR-${stamp}`,
      email: `t-lc-ar-${stamp}@test.local`,
      role: Role.technician,
      fullName: "T Lifecycle Archived",
    });
    fixtureIds.push(archivedEmp.employeeId);
    // Await side-effecting async work.
    await prisma.user.update({
      where: { id: archivedEmp.userId },
      data: { isActive: false },
    });
    // Await side-effecting async work.
    await prisma.employee.update({
      where: { id: archivedEmp.employeeId },
      data: { archivedAt: new Date() },
    });

    // Await side-effecting async work.
    await prisma.user.update({
      where: { id: target.userId },
      data: { isActive: true },
    });
    // Await side-effecting async work.
    await prisma.employee.update({
      where: { id: target.employeeId },
      data: { archivedAt: null },
    });
    // Await side-effecting async work.
    await prisma.device.create({
      data: {
        userId: target.userId,
        employeeId: target.employeeId,
        label: "Visible",
        fingerprint: `visible-fp-${stamp}`,
      },
    });

    const { token: actorTok } = await loginBearer(
      api,
      // Pass managerActor.email through.
      managerActor.email,
      // Pass string literal argument.
      "test-password-t03",
    );
    // Scope with q= so a polluted shared DB (many prior fixtures) cannot hide
    // this row behind the default limit=100 page window.
    const archivedQ = encodeURIComponent(archivedEmp.employeeNumber);
    const listed = await getJson(
      api,
      actorTok,
      `/people?limit=100&q=${archivedQ}`,
    );
    assert.equal(listed.status, 200);
    const items = (listed.body as { items: Array<{ employeeId: string }> })
      .items;
    assert.ok(!items.some((p) => p.employeeId === archivedEmp.employeeId));

    const withArchived = await getJson(
      api,
      actorTok,
      `/people?limit=100&includeArchived=true&includeInactive=true&q=${archivedQ}`,
    );
    assert.equal(withArchived.status, 200);
    const archivedItems = (
      withArchived.body as {
        items: Array<{ employeeId: string; status: string }>;
      }
    ).items;
    assert.ok(
      archivedItems.some(
        (p) =>
          p.employeeId === archivedEmp.employeeId && p.status === "archived",
      ),
      `expected archived person in scoped list; got ${JSON.stringify(archivedItems).slice(0, 400)}`,
    );

    const detail = await getJson(api, actorTok, `/people/${target.employeeId}`);
    assert.equal(detail.status, 200);

    const devices = await getJson(
      api,
      actorTok,
      `/devices?employeeId=${target.employeeId}`,
    );
    assert.equal(devices.status, 200);
    const rows = devices.body as Array<Record<string, unknown>>;
    assert.ok(rows.length >= 1);
    assert.ok(rows.every((r) => !("fingerprint" in r)));
  });

  // Single test case asserting expected behavior.
  it("two concurrent blocks with the same accessVersion yield one success", async () => {
    const stamp = Date.now();
    const worker = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-LC-DBL-${stamp}`,
      email: `t-lc-dbl-${stamp}@test.local`,
      role: Role.housekeeper,
      fullName: "T Lifecycle Double Block",
    });
    fixtureIds.push(worker.employeeId);

    const [{ token: tokA }, { token: tokB }] = await Promise.all([
      loginBearer(api, managerActor.email, "test-password-t03"),
      loginBearer(api, ownerActor.email, "test-password-t03"),
    ]);
    const version = await accessVersionOf(worker.employeeId);

    const [r1, r2] = await withDatabaseBarrier(
      prisma,
      (tx) =>
        tx.$queryRaw`
          SELECT id FROM "User" WHERE id = ${worker.userId} FOR UPDATE
        `,
      () =>
        Promise.all([
          postJson(api, tokA, `/people/${worker.employeeId}/block`, {
            expectedStatus: "active",
            accessVersion: version,
          }),
          postJson(api, tokB, `/people/${worker.employeeId}/block`, {
            expectedStatus: "active",
            accessVersion: version,
          }),
        ]),
    );

    const statuses = [r1.status, r2.status].sort();
    assert.deepEqual(statuses, [200, 409]);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: worker.userId },
    });
    assert.equal(user.isActive, false);
    assert.equal(await accessVersionOf(worker.employeeId), version + 1);
  });

  // Single test case asserting expected behavior.
  it("archives and restores employee without a User under Employee lock", async () => {
    const stamp = Date.now();
    const emp = await prisma.employee.create({
      data: {
        employeeNumber: `T-LC-NU-${stamp}`,
        fullName: "T Lifecycle No User",
      },
    });
    fixtureIds.push(emp.id);

    const { token: actorTok } = await loginBearer(
      api,
      // Pass managerActor.email through.
      managerActor.email,
      // Pass string literal argument.
      "test-password-t03",
    );
    const v0 = await accessVersionOf(emp.id);
    const archived = await postJson(
      api,
      actorTok,
      `/people/${emp.id}/archive`,
      { expectedStatus: "not_activated", accessVersion: v0 },
    );
    assert.equal(archived.status, 200, JSON.stringify(archived.body));
    assert.equal((archived.body as { status?: string }).status, "archived");

    const v1 = await accessVersionOf(emp.id);
    const restored = await postJson(
      api,
      actorTok,
      `/people/${emp.id}/restore`,
      { expectedStatus: "archived", accessVersion: v1 },
    );
    assert.equal(restored.status, 200, JSON.stringify(restored.body));
    assert.equal(
      (restored.body as { status?: string }).status,
      // Pass string literal argument.
      "not_activated",
    );
  });

  // Single test case asserting expected behavior.
  it("manager cannot revoke owner device; owner can", async () => {
    const stamp = Date.now();
    const privileged = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-LC-OWNDEV-${stamp}`,
      email: `t-lc-owndev-${stamp}@test.local`,
      role: Role.owner,
      fullName: "T Lifecycle Owner Device",
    });
    fixtureIds.push(privileged.employeeId);
    const device = await prisma.device.create({
      data: {
        userId: privileged.userId,
        employeeId: privileged.employeeId,
        label: "OwnerPhone",
        fingerprint: `fp-own-${stamp}`,
      },
    });

    const { token: mgrTok } = await loginBearer(
      api,
      // Pass managerActor.email through.
      managerActor.email,
      // Pass string literal argument.
      "test-password-t03",
    );
    const forbidden = await postJson(
      api,
      mgrTok,
      `/devices/${device.id}/revoke`,
      {},
    );
    assert.equal(forbidden.status, 403);

    const still = await prisma.device.findUniqueOrThrow({
      where: { id: device.id },
    });
    assert.equal(still.revokedAt, null);

    const { token: ownerTok } = await loginBearer(
      api,
      // Pass ownerActor.email through.
      ownerActor.email,
      // Pass string literal argument.
      "test-password-t03",
    );
    const ok = await postJson(api, ownerTok, `/devices/${device.id}/revoke`, {});
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  });
});
