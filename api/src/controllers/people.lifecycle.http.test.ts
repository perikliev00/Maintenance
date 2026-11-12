// Import local module ../../tests/dbBarrier.
import { withDatabaseBarrier } from "../../tests/dbBarrier";
/**
 * HTTP integration: people block/unblock/archive/restore, last-owner race,
 * stale expectedStatus, unfinished work on archive.
 */
import assert from "node:assert/strict";
// Import dependency node:path.
import path from "node:path";
// Import dependency node:test.
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
// Import dependency dotenv.
import dotenv from "dotenv";
// Continue named import list.
import {
  // Bring cleanupEmployeeGraph into scope from the import.
  cleanupEmployeeGraph,
  // Bring createEmployeeWithUser into scope from the import.
  createEmployeeWithUser,
  // Arrange or act for this test case.
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

// Arrange or act for this test case.
dotenv.config({
  // Provide path for the object/call below.
  path: path.resolve(__dirname, "../../.env"),
  // Provide override for the object/call below.
  override: true,
});
// Arrange or act for this test case.
process.env.JWT_SECRET =
  // Arrange or act for this test case.
  process.env.JWT_SECRET || "test-secret-for-people-lifecycle-http";

// Bind prisma for use in the handler below.
const prisma = new PrismaClient();

// Async helper accessVersionOf keeps handler bodies thin.
async function accessVersionOf(employeeId: string): Promise<number> {
  // Await async work into row.
  const row = await prisma.employee.findUniqueOrThrow({
    // Provide where for the object/call below.
    where: { id: employeeId },
    // Provide select for the object/call below.
    select: { accessVersion: true },
  });
  // Return value or early exit.
  return row.accessVersion;
}

// Test suite grouping related cases.
describe("people lifecycle HTTP", () => {
  // Arrange or act for this test case.
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  // Mutable api updated as the flow proceeds.
  let api = "";
  // Arrange or act for this test case.
  const fixtureIds: string[] = [];
  // Arrange or act for this test case.
  let ownerActor: EmployeeUserFixture;
  // Arrange or act for this test case.
  let managerActor: EmployeeUserFixture;
  // Arrange or act for this test case.
  let target: EmployeeUserFixture;

  // Setup hook run before tests.
  before(async () => {
    // Assert expected outcome for this case.
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Await side-effecting async work.
    await initializeRequiredDefaults();
    // Bind stamp for use in the handler below.
    const stamp = Date.now();

    // Arrange or act for this test case.
    ownerActor = await createEmployeeWithUser(prisma, {
      // Provide employeeNumber for the object/call below.
      employeeNumber: `T-LC-OA-${stamp}`,
      // Provide email for the object/call below.
      email: `t-lc-oa-${stamp}@test.local`,
      // Provide role for the object/call below.
      role: Role.owner,
      // Provide fullName for the object/call below.
      fullName: "T Lifecycle Owner",
    });
    // Arrange or act for this test case.
    managerActor = await createEmployeeWithUser(prisma, {
      // Provide employeeNumber for the object/call below.
      employeeNumber: `T-LC-MGR-${stamp}`,
      // Provide email for the object/call below.
      email: `t-lc-mgr-${stamp}@test.local`,
      // Provide role for the object/call below.
      role: Role.manager,
      // Provide fullName for the object/call below.
      fullName: "T Lifecycle Manager",
    });
    // Arrange or act for this test case.
    target = await createEmployeeWithUser(prisma, {
      // Provide employeeNumber for the object/call below.
      employeeNumber: `T-LC-TGT-${stamp}`,
      // Provide email for the object/call below.
      email: `t-lc-tgt-${stamp}@test.local`,
      // Provide role for the object/call below.
      role: Role.housekeeper,
      // Provide fullName for the object/call below.
      fullName: "T Lifecycle Target",
    });
    // Arrange or act for this test case.
    fixtureIds.push(
      // Pass ownerActor.employeeId through.
      ownerActor.employeeId,
      // Pass managerActor.employeeId through.
      managerActor.employeeId,
      // Pass target.employeeId through.
      target.employeeId,
    );

    // Await async work into listened.
    const listened = await listenApp();
    // Arrange or act for this test case.
    server = listened.server;
    // Arrange or act for this test case.
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
      // Provide where for the object/call below.
      where: { id: target.userId },
      // Provide data for the object/call below.
      data: { isActive: true },
    });
    // Await side-effecting async work.
    await prisma.employee.update({
      // Provide where for the object/call below.
      where: { id: target.employeeId },
      // Provide data for the object/call below.
      data: { archivedAt: null },
    });

    // Await async work into device.
    const device = await prisma.device.create({
      // Provide data for the object/call below.
      data: {
        // Provide userId for the object/call below.
        userId: target.userId,
        // Provide employeeId for the object/call below.
        employeeId: target.employeeId,
        // Provide label for the object/call below.
        label: "Phone",
        // Provide fingerprint for the object/call below.
        fingerprint: `fp-lc-${Date.now()}`,
      },
    });
    // Await side-effecting async work.
    await prisma.authSession.create({
      // Provide data for the object/call below.
      data: {
        // Provide userId for the object/call below.
        userId: target.userId,
        // Provide deviceId for the object/call below.
        deviceId: device.id,
        // Provide refreshTokenHash for the object/call below.
        refreshTokenHash: `rh-lc-${Date.now()}`,
        // Provide expiresAt for the object/call below.
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    // Await side-effecting async work.
    await prisma.invitation.create({
      // Provide data for the object/call below.
      data: {
        // Provide codeHash for the object/call below.
        codeHash: `ch-lc-${Date.now()}`,
        // Provide codeHint for the object/call below.
        codeHint: "abcd",
        // Provide employeeId for the object/call below.
        employeeId: target.employeeId,
        // Provide role for the object/call below.
        role: Role.housekeeper,
        // Provide email for the object/call below.
        email: target.email,
        // Provide status for the object/call below.
        status: InvitationStatus.issued,
        // Provide expiresAt for the object/call below.
        expiresAt: new Date(Date.now() + 86_400_000),
        // Provide createdByUserId for the object/call below.
        createdByUserId: ownerActor.userId,
      },
    });

    // Arrange or act for this test case.
    const { token: actorTok } = await loginBearer(
      // Pass api through.
      api,
      // Pass managerActor.email through.
      managerActor.email,
      // Pass string literal argument.
      "test-password-t03",
    );
    // Await async work into v0.
    const v0 = await accessVersionOf(target.employeeId);
    // Await async work into blocked.
    const blocked = await postJson(
      // Pass api through.
      api,
      // Pass actorTok through.
      actorTok,
      // Arrange or act for this test case.
      `/people/${target.employeeId}/block`,
      // Arrange or act for this test case.
      { expectedStatus: "active", accessVersion: v0 },
    );
    // Assert expected outcome for this case.
    assert.equal(blocked.status, 200, JSON.stringify(blocked.body));
    // Assert expected outcome for this case.
    assert.equal((blocked.body as { status?: string }).status, "blocked");
    // Assert expected outcome for this case.
    assert.equal(
      // Arrange or act for this test case.
      (blocked.body as { accessVersion?: number }).accessVersion,
      // Arrange or act for this test case.
      v0 + 1,
    );

    // Await async work into user.
    const user = await prisma.user.findUniqueOrThrow({
      // Provide where for the object/call below.
      where: { id: target.userId },
    });
    // Assert expected outcome for this case.
    assert.equal(user.isActive, false);
    // Await async work into sessions.
    const sessions = await prisma.authSession.findMany({
      // Provide where for the object/call below.
      where: { userId: target.userId },
    });
    // Assert expected outcome for this case.
    assert.ok(sessions.every((s) => s.revokedAt != null));
    // Await async work into invites.
    const invites = await prisma.invitation.findMany({
      // Provide where for the object/call below.
      where: {
        // Provide employeeId for the object/call below.
        employeeId: target.employeeId,
        // Provide status for the object/call below.
        status: InvitationStatus.issued,
      },
    });
    // Assert expected outcome for this case.
    assert.equal(invites.length, 0);
    // Await async work into devices.
    const devices = await prisma.device.findMany({
      // Provide where for the object/call below.
      where: { employeeId: target.employeeId, revokedAt: null },
    });
    // Assert expected outcome for this case.
    assert.equal(devices.length, 0);

    // Await async work into loginRes.
    const loginRes = await fetch(`${api}/auth/login`, {
      // Provide method for the object/call below.
      method: "POST",
      // Provide headers for the object/call below.
      headers: { "Content-Type": "application/json" },
      // Provide body for the object/call below.
      body: JSON.stringify({
        // Provide email for the object/call below.
        email: target.email,
        // Provide password for the object/call below.
        password: "test-password-t03",
      }),
    });
    // Assert expected outcome for this case.
    assert.equal(loginRes.status, 401);

    // Await async work into v1.
    const v1 = await accessVersionOf(target.employeeId);
    // Await async work into unblocked.
    const unblocked = await postJson(
      // Pass api through.
      api,
      // Pass actorTok through.
      actorTok,
      // Arrange or act for this test case.
      `/people/${target.employeeId}/unblock`,
      // Arrange or act for this test case.
      { expectedStatus: "blocked", accessVersion: v1 },
    );
    // Assert expected outcome for this case.
    assert.equal(unblocked.status, 200, JSON.stringify(unblocked.body));
    // Assert expected outcome for this case.
    assert.equal((unblocked.body as { status?: string }).status, "active");

    // Await async work into devicesAfter.
    const devicesAfter = await prisma.device.findMany({
      // Provide where for the object/call below.
      where: { employeeId: target.employeeId, revokedAt: null },
    });
    // Assert expected outcome for this case.
    assert.equal(devicesAfter.length, 0);

    // Await async work into audit.
    const audit = await prisma.auditEvent.findFirst({
      // Provide where for the object/call below.
      where: { entityId: target.employeeId, action: "people.block" },
      // Provide orderBy for the object/call below.
      orderBy: { occurredAt: "desc" },
    });
    // Assert expected outcome for this case.
    assert.ok(audit);
  });

  // Single test case asserting expected behavior.
  it("rejects stale expectedStatus and self-block", async () => {
    // Await side-effecting async work.
    await prisma.user.update({
      // Provide where for the object/call below.
      where: { id: target.userId },
      // Provide data for the object/call below.
      data: { isActive: true },
    });
    // Await side-effecting async work.
    await prisma.employee.update({
      // Provide where for the object/call below.
      where: { id: target.employeeId },
      // Provide data for the object/call below.
      data: { archivedAt: null },
    });

    // Arrange or act for this test case.
    const { token: actorTok } = await loginBearer(
      // Pass api through.
      api,
      // Pass managerActor.email through.
      managerActor.email,
      // Pass string literal argument.
      "test-password-t03",
    );
    // Await async work into v.
    const v = await accessVersionOf(target.employeeId);
    // Await async work into stale.
    const stale = await postJson(
      // Pass api through.
      api,
      // Pass actorTok through.
      actorTok,
      // Arrange or act for this test case.
      `/people/${target.employeeId}/unblock`,
      // Arrange or act for this test case.
      { expectedStatus: "blocked", accessVersion: v },
    );
    // Assert expected outcome for this case.
    assert.equal(stale.status, 409);
    // Assert expected outcome for this case.
    assert.equal((stale.body as { error?: string }).error, "stale_state");

    // Await async work into selfV.
    const selfV = await accessVersionOf(managerActor.employeeId);
    // Await async work into selfBlock.
    const selfBlock = await postJson(
      // Pass api through.
      api,
      // Pass actorTok through.
      actorTok,
      // Arrange or act for this test case.
      `/people/${managerActor.employeeId}/block`,
      // Arrange or act for this test case.
      { expectedStatus: "active", accessVersion: selfV },
    );
    // Assert expected outcome for this case.
    assert.equal(selfBlock.status, 403);
  });

  // Single test case asserting expected behavior.
  it("rejects ABA unblock after blocked→active→blocked with old accessVersion", async () => {
    // Await side-effecting async work.
    await prisma.user.update({
      // Provide where for the object/call below.
      where: { id: target.userId },
      // Provide data for the object/call below.
      data: { isActive: false },
    });
    // Await side-effecting async work.
    await prisma.employee.update({
      // Provide where for the object/call below.
      where: { id: target.employeeId },
      // Provide data for the object/call below.
      data: { archivedAt: null },
    });
    // Await async work into oldVersion.
    const oldVersion = await accessVersionOf(target.employeeId);

    // Arrange or act for this test case.
    const { token: actorTok } = await loginBearer(
      // Pass api through.
      api,
      // Pass managerActor.email through.
      managerActor.email,
      // Pass string literal argument.
      "test-password-t03",
    );

    // Await async work into unblocked.
    const unblocked = await postJson(
      // Pass api through.
      api,
      // Pass actorTok through.
      actorTok,
      // Arrange or act for this test case.
      `/people/${target.employeeId}/unblock`,
      // Arrange or act for this test case.
      { expectedStatus: "blocked", accessVersion: oldVersion },
    );
    // Assert expected outcome for this case.
    assert.equal(unblocked.status, 200, JSON.stringify(unblocked.body));

    // Await async work into vAfterUnblock.
    const vAfterUnblock = await accessVersionOf(target.employeeId);
    // Await async work into reblocked.
    const reblocked = await postJson(
      // Pass api through.
      api,
      // Pass actorTok through.
      actorTok,
      // Arrange or act for this test case.
      `/people/${target.employeeId}/block`,
      // Arrange or act for this test case.
      { expectedStatus: "active", accessVersion: vAfterUnblock },
    );
    // Assert expected outcome for this case.
    assert.equal(reblocked.status, 200, JSON.stringify(reblocked.body));

    // Stale decision from before the cycle must not unblock again.
    const staleUnblock = await postJson(
      // Pass api through.
      api,
      // Pass actorTok through.
      actorTok,
      // Arrange or act for this test case.
      `/people/${target.employeeId}/unblock`,
      // Arrange or act for this test case.
      { expectedStatus: "blocked", accessVersion: oldVersion },
    );
    // Assert expected outcome for this case.
    assert.equal(staleUnblock.status, 409);
    // Assert expected outcome for this case.
    assert.equal(
      // Arrange or act for this test case.
      (staleUnblock.body as { error?: string }).error,
      // Pass string literal argument.
      "stale_state",
    );
    // Await async work into user.
    const user = await prisma.user.findUniqueOrThrow({
      // Provide where for the object/call below.
      where: { id: target.userId },
    });
    // Assert expected outcome for this case.
    assert.equal(user.isActive, false);
  });

  // Single test case asserting expected behavior.
  it("archive refuses unfinished work; restore leaves account blocked", async () => {
    // Bind stamp for use in the handler below.
    const stamp = Date.now();
    // Await async work into worker.
    const worker = await createEmployeeWithUser(prisma, {
      // Provide employeeNumber for the object/call below.
      employeeNumber: `T-LC-WK-${stamp}`,
      // Provide email for the object/call below.
      email: `t-lc-wk-${stamp}@test.local`,
      // Provide role for the object/call below.
      role: Role.housekeeper,
      // Provide fullName for the object/call below.
      fullName: "T Lifecycle Worker",
    });
    // Arrange or act for this test case.
    fixtureIds.push(worker.employeeId);

    // Await async work into location.
    const location = await prisma.location.findFirst({
      // Provide where for the object/call below.
      where: { catalogStatus: "active" },
    });
    // Assert expected outcome for this case.
    assert.ok(location, "need an active location in isolation DB");

    // Await side-effecting async work.
    await prisma.cleaningTask.create({
      // Provide data for the object/call below.
      data: {
        // Provide locationId for the object/call below.
        locationId: location.id,
        // Provide assignedEmployeeId for the object/call below.
        assignedEmployeeId: worker.employeeId,
        // Provide status for the object/call below.
        status: TaskStatus.assigned,
        // Provide serviceType for the object/call below.
        serviceType: "stayover",
        // Provide hotelDate for the object/call below.
        hotelDate: new Date("2026-10-28T00:00:00.000Z"),
      },
    });

    // Arrange or act for this test case.
    const { token: actorTok } = await loginBearer(
      // Pass api through.
      api,
      // Pass managerActor.email through.
      managerActor.email,
      // Pass string literal argument.
      "test-password-t03",
    );
    // Await async work into v0.
    const v0 = await accessVersionOf(worker.employeeId);
    // Await async work into refused.
    const refused = await postJson(
      // Pass api through.
      api,
      // Pass actorTok through.
      actorTok,
      // Arrange or act for this test case.
      `/people/${worker.employeeId}/archive`,
      // Arrange or act for this test case.
      { expectedStatus: "active", accessVersion: v0 },
    );
    // Assert expected outcome for this case.
    assert.equal(refused.status, 409);
    // Assert expected outcome for this case.
    assert.equal((refused.body as { error?: string }).error, "unfinished_work");

    // Await side-effecting async work.
    await prisma.cleaningTask.updateMany({
      // Provide where for the object/call below.
      where: { assignedEmployeeId: worker.employeeId },
      // Provide data for the object/call below.
      data: { status: TaskStatus.completed },
    });

    // Await async work into archived.
    const archived = await postJson(
      // Pass api through.
      api,
      // Pass actorTok through.
      actorTok,
      // Arrange or act for this test case.
      `/people/${worker.employeeId}/archive`,
      // Arrange or act for this test case.
      { expectedStatus: "active", accessVersion: v0 },
    );
    // Assert expected outcome for this case.
    assert.equal(archived.status, 200, JSON.stringify(archived.body));
    // Assert expected outcome for this case.
    assert.equal((archived.body as { status?: string }).status, "archived");

    // Await async work into vArchived.
    const vArchived = await accessVersionOf(worker.employeeId);
    // Await async work into restored.
    const restored = await postJson(
      // Pass api through.
      api,
      // Pass actorTok through.
      actorTok,
      // Arrange or act for this test case.
      `/people/${worker.employeeId}/restore`,
      // Arrange or act for this test case.
      { expectedStatus: "archived", accessVersion: vArchived },
    );
    // Assert expected outcome for this case.
    assert.equal(restored.status, 200, JSON.stringify(restored.body));
    // Assert expected outcome for this case.
    assert.equal((restored.body as { status?: string }).status, "blocked");
    // Await async work into user.
    const user = await prisma.user.findUniqueOrThrow({
      // Provide where for the object/call below.
      where: { id: worker.userId },
    });
    // Assert expected outcome for this case.
    assert.equal(user.isActive, false);
  });

  // Single test case asserting expected behavior.
  it("concurrent block of last two active owners leaves one active", async () => {
    // Bind stamp for use in the handler below.
    const stamp = Date.now();
    // Await async work into a.
    const a = await createEmployeeWithUser(prisma, {
      // Provide employeeNumber for the object/call below.
      employeeNumber: `T-LC-O1-${stamp}`,
      // Provide email for the object/call below.
      email: `t-lc-o1-${stamp}@test.local`,
      // Provide role for the object/call below.
      role: Role.owner,
      // Provide fullName for the object/call below.
      fullName: "T Lifecycle Owner1",
    });
    // Await async work into b.
    const b = await createEmployeeWithUser(prisma, {
      // Provide employeeNumber for the object/call below.
      employeeNumber: `T-LC-O2-${stamp}`,
      // Provide email for the object/call below.
      email: `t-lc-o2-${stamp}@test.local`,
      // Provide role for the object/call below.
      role: Role.owner,
      // Provide fullName for the object/call below.
      fullName: "T Lifecycle Owner2",
    });
    // Arrange or act for this test case.
    fixtureIds.push(a.employeeId, b.employeeId);

    // Bind priorOwners for use in the handler below.
    const priorOwners = (
      // Await side-effecting async work.
      await prisma.user.findMany({
        // Provide where for the object/call below.
        where: { role: Role.owner, isActive: true },
        // Provide select for the object/call below.
        select: { id: true },
      })
    // Arrange or act for this test case.
    ).map((r) => r.id);

    // Try block for operations that may throw.
    try {
      // Mutable raced updated as the flow proceeds.
      let raced = false;
      // Iterate to process each item.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        // Await side-effecting async work.
        await prisma.user.updateMany({
          // Provide where for the object/call below.
          where: {
            // Provide role for the object/call below.
            role: Role.owner,
            // Provide isActive for the object/call below.
            isActive: true,
            // Provide id for the object/call below.
            id: { notIn: [a.userId, b.userId] },
          },
          // Provide data for the object/call below.
          data: { isActive: false },
        });
        // Await side-effecting async work.
        await prisma.user.updateMany({
          // Provide where for the object/call below.
          where: { id: { in: [a.userId, b.userId] } },
          // Provide data for the object/call below.
          data: { role: Role.owner, isActive: true },
        });
        // Await side-effecting async work.
        await prisma.employee.updateMany({
          // Provide where for the object/call below.
          where: { id: { in: [a.employeeId, b.employeeId] } },
          // Provide data for the object/call below.
          data: { archivedAt: null },
        });

        // Await async work into beforeRace.
        const beforeRace = await prisma.user.count({
          // Provide where for the object/call below.
          where: { role: Role.owner, isActive: true },
        });
        // Branch when this condition holds.
        if (beforeRace !== 2) continue;

        // Arrange or act for this test case.
        const [{ token: tokA }, { token: tokB }] = await Promise.all([
          // Arrange or act for this test case.
          loginBearer(api, a.email, "test-password-t03"),
          // Arrange or act for this test case.
          loginBearer(api, b.email, "test-password-t03"),
        ]);
        // Arrange or act for this test case.
        const [vA, vB] = await Promise.all([
          // Arrange or act for this test case.
          accessVersionOf(a.employeeId),
          // Arrange or act for this test case.
          accessVersionOf(b.employeeId),
        ]);

        // Arrange or act for this test case.
        const [rAb, rBa] = await withDatabaseBarrier(
          // Pass prisma through.
          prisma,
          // Arrange or act for this test case.
          (tx) =>
            // Arrange or act for this test case.
            tx.$queryRaw`
              SELECT id FROM "User"
              WHERE id IN (${a.userId}, ${b.userId})
              ORDER BY id FOR UPDATE
            `,
          // Arrange or act for this test case.
          () =>
            // Arrange or act for this test case.
            Promise.all([
              // Arrange or act for this test case.
              postJson(api, tokA, `/people/${b.employeeId}/block`, {
                // Provide expectedStatus for the object/call below.
                expectedStatus: "active",
                // Provide accessVersion for the object/call below.
                accessVersion: vB,
              }),
              // Arrange or act for this test case.
              postJson(api, tokB, `/people/${a.employeeId}/block`, {
                // Provide expectedStatus for the object/call below.
                expectedStatus: "active",
                // Provide accessVersion for the object/call below.
                accessVersion: vA,
              }),
            ]),
        );

        // Assert expected outcome for this case.
        assert.deepEqual([rAb.status, rBa.status].sort(), [200, 409]);
        // Await async work into remaining.
        const remaining = await prisma.user.count({
          // Provide where for the object/call below.
          where: { role: Role.owner, isActive: true },
        });
        // Assert expected outcome for this case.
        assert.equal(remaining, 1);
        // Arrange or act for this test case.
        raced = true;
        // Arrange or act for this test case.
        break;
      }
      // Assert expected outcome for this case.
      assert.equal(raced, true, "failed to establish exclusive 2-owner race");
    // Arrange or act for this test case.
    } finally {
      // Await side-effecting async work.
      await prisma.user.updateMany({
        // Provide where for the object/call below.
        where: { id: { in: priorOwners } },
        // Provide data for the object/call below.
        data: { role: Role.owner, isActive: true },
      });
    }
  });

  // Single test case asserting expected behavior.
  it("GET person and devices omit fingerprint; list hides archived by default", async () => {
    // Bind stamp for use in the handler below.
    const stamp = Date.now();
    // Await async work into archivedEmp.
    const archivedEmp = await createEmployeeWithUser(prisma, {
      // Provide employeeNumber for the object/call below.
      employeeNumber: `T-LC-AR-${stamp}`,
      // Provide email for the object/call below.
      email: `t-lc-ar-${stamp}@test.local`,
      // Provide role for the object/call below.
      role: Role.technician,
      // Provide fullName for the object/call below.
      fullName: "T Lifecycle Archived",
    });
    // Arrange or act for this test case.
    fixtureIds.push(archivedEmp.employeeId);
    // Await side-effecting async work.
    await prisma.user.update({
      // Provide where for the object/call below.
      where: { id: archivedEmp.userId },
      // Provide data for the object/call below.
      data: { isActive: false },
    });
    // Await side-effecting async work.
    await prisma.employee.update({
      // Provide where for the object/call below.
      where: { id: archivedEmp.employeeId },
      // Provide data for the object/call below.
      data: { archivedAt: new Date() },
    });

    // Await side-effecting async work.
    await prisma.user.update({
      // Provide where for the object/call below.
      where: { id: target.userId },
      // Provide data for the object/call below.
      data: { isActive: true },
    });
    // Await side-effecting async work.
    await prisma.employee.update({
      // Provide where for the object/call below.
      where: { id: target.employeeId },
      // Provide data for the object/call below.
      data: { archivedAt: null },
    });
    // Await side-effecting async work.
    await prisma.device.create({
      // Provide data for the object/call below.
      data: {
        // Provide userId for the object/call below.
        userId: target.userId,
        // Provide employeeId for the object/call below.
        employeeId: target.employeeId,
        // Provide label for the object/call below.
        label: "Visible",
        // Provide fingerprint for the object/call below.
        fingerprint: `visible-fp-${stamp}`,
      },
    });

    // Arrange or act for this test case.
    const { token: actorTok } = await loginBearer(
      // Pass api through.
      api,
      // Pass managerActor.email through.
      managerActor.email,
      // Pass string literal argument.
      "test-password-t03",
    );
    // Scope with q= so a polluted shared DB (many prior fixtures) cannot hide
    // this row behind the default limit=100 page window.
    const archivedQ = encodeURIComponent(archivedEmp.employeeNumber);
    // Await async work into listed.
    const listed = await getJson(
      // Pass api through.
      api,
      // Pass actorTok through.
      actorTok,
      // Arrange or act for this test case.
      `/people?limit=100&q=${archivedQ}`,
    );
    // Assert expected outcome for this case.
    assert.equal(listed.status, 200);
    // Bind items for use in the handler below.
    const items = (listed.body as { items: Array<{ employeeId: string }> })
      // Arrange or act for this test case.
      .items;
    // Assert expected outcome for this case.
    assert.ok(!items.some((p) => p.employeeId === archivedEmp.employeeId));

    // Await async work into withArchived.
    const withArchived = await getJson(
      // Pass api through.
      api,
      // Pass actorTok through.
      actorTok,
      // Arrange or act for this test case.
      `/people?limit=100&includeArchived=true&includeInactive=true&q=${archivedQ}`,
    );
    // Assert expected outcome for this case.
    assert.equal(withArchived.status, 200);
    // Bind archivedItems for use in the handler below.
    const archivedItems = (
      // Arrange or act for this test case.
      withArchived.body as {
        // Provide items for the object/call below.
        items: Array<{ employeeId: string; status: string }>;
      }
    // Arrange or act for this test case.
    ).items;
    // Assert expected outcome for this case.
    assert.ok(
      // Arrange or act for this test case.
      archivedItems.some(
        // Arrange or act for this test case.
        (p) =>
          // Arrange or act for this test case.
          p.employeeId === archivedEmp.employeeId && p.status === "archived",
      ),
      // Arrange or act for this test case.
      `expected archived person in scoped list; got ${JSON.stringify(archivedItems).slice(0, 400)}`,
    );

    // Await async work into detail.
    const detail = await getJson(api, actorTok, `/people/${target.employeeId}`);
    // Assert expected outcome for this case.
    assert.equal(detail.status, 200);

    // Await async work into devices.
    const devices = await getJson(
      // Pass api through.
      api,
      // Pass actorTok through.
      actorTok,
      // Arrange or act for this test case.
      `/devices?employeeId=${target.employeeId}`,
    );
    // Assert expected outcome for this case.
    assert.equal(devices.status, 200);
    // Bind rows for use in the handler below.
    const rows = devices.body as Array<Record<string, unknown>>;
    // Assert expected outcome for this case.
    assert.ok(rows.length >= 1);
    // Assert expected outcome for this case.
    assert.ok(rows.every((r) => !("fingerprint" in r)));
  });

  // Single test case asserting expected behavior.
  it("two concurrent blocks with the same accessVersion yield one success", async () => {
    // Bind stamp for use in the handler below.
    const stamp = Date.now();
    // Await async work into worker.
    const worker = await createEmployeeWithUser(prisma, {
      // Provide employeeNumber for the object/call below.
      employeeNumber: `T-LC-DBL-${stamp}`,
      // Provide email for the object/call below.
      email: `t-lc-dbl-${stamp}@test.local`,
      // Provide role for the object/call below.
      role: Role.housekeeper,
      // Provide fullName for the object/call below.
      fullName: "T Lifecycle Double Block",
    });
    // Arrange or act for this test case.
    fixtureIds.push(worker.employeeId);

    // Arrange or act for this test case.
    const [{ token: tokA }, { token: tokB }] = await Promise.all([
      // Arrange or act for this test case.
      loginBearer(api, managerActor.email, "test-password-t03"),
      // Arrange or act for this test case.
      loginBearer(api, ownerActor.email, "test-password-t03"),
    ]);
    // Await async work into version.
    const version = await accessVersionOf(worker.employeeId);

    // Arrange or act for this test case.
    const [r1, r2] = await withDatabaseBarrier(
      // Pass prisma through.
      prisma,
      // Arrange or act for this test case.
      (tx) =>
        // Arrange or act for this test case.
        tx.$queryRaw`
          SELECT id FROM "User" WHERE id = ${worker.userId} FOR UPDATE
        `,
      // Arrange or act for this test case.
      () =>
        // Arrange or act for this test case.
        Promise.all([
          // Arrange or act for this test case.
          postJson(api, tokA, `/people/${worker.employeeId}/block`, {
            // Provide expectedStatus for the object/call below.
            expectedStatus: "active",
            // Provide accessVersion for the object/call below.
            accessVersion: version,
          }),
          // Arrange or act for this test case.
          postJson(api, tokB, `/people/${worker.employeeId}/block`, {
            // Provide expectedStatus for the object/call below.
            expectedStatus: "active",
            // Provide accessVersion for the object/call below.
            accessVersion: version,
          }),
        ]),
    );

    // Bind statuses for use in the handler below.
    const statuses = [r1.status, r2.status].sort();
    // Assert expected outcome for this case.
    assert.deepEqual(statuses, [200, 409]);
    // Await async work into user.
    const user = await prisma.user.findUniqueOrThrow({
      // Provide where for the object/call below.
      where: { id: worker.userId },
    });
    // Assert expected outcome for this case.
    assert.equal(user.isActive, false);
    // Assert expected outcome for this case.
    assert.equal(await accessVersionOf(worker.employeeId), version + 1);
  });

  // Single test case asserting expected behavior.
  it("archives and restores employee without a User under Employee lock", async () => {
    // Bind stamp for use in the handler below.
    const stamp = Date.now();
    // Await async work into emp.
    const emp = await prisma.employee.create({
      // Provide data for the object/call below.
      data: {
        // Provide employeeNumber for the object/call below.
        employeeNumber: `T-LC-NU-${stamp}`,
        // Provide fullName for the object/call below.
        fullName: "T Lifecycle No User",
      },
    });
    // Arrange or act for this test case.
    fixtureIds.push(emp.id);

    // Arrange or act for this test case.
    const { token: actorTok } = await loginBearer(
      // Pass api through.
      api,
      // Pass managerActor.email through.
      managerActor.email,
      // Pass string literal argument.
      "test-password-t03",
    );
    // Await async work into v0.
    const v0 = await accessVersionOf(emp.id);
    // Await async work into archived.
    const archived = await postJson(
      // Pass api through.
      api,
      // Pass actorTok through.
      actorTok,
      // Arrange or act for this test case.
      `/people/${emp.id}/archive`,
      // Arrange or act for this test case.
      { expectedStatus: "not_activated", accessVersion: v0 },
    );
    // Assert expected outcome for this case.
    assert.equal(archived.status, 200, JSON.stringify(archived.body));
    // Assert expected outcome for this case.
    assert.equal((archived.body as { status?: string }).status, "archived");

    // Await async work into v1.
    const v1 = await accessVersionOf(emp.id);
    // Await async work into restored.
    const restored = await postJson(
      // Pass api through.
      api,
      // Pass actorTok through.
      actorTok,
      // Arrange or act for this test case.
      `/people/${emp.id}/restore`,
      // Arrange or act for this test case.
      { expectedStatus: "archived", accessVersion: v1 },
    );
    // Assert expected outcome for this case.
    assert.equal(restored.status, 200, JSON.stringify(restored.body));
    // Assert expected outcome for this case.
    assert.equal(
      // Arrange or act for this test case.
      (restored.body as { status?: string }).status,
      // Pass string literal argument.
      "not_activated",
    );
  });

  // Single test case asserting expected behavior.
  it("manager cannot revoke owner device; owner can", async () => {
    // Bind stamp for use in the handler below.
    const stamp = Date.now();
    // Await async work into privileged.
    const privileged = await createEmployeeWithUser(prisma, {
      // Provide employeeNumber for the object/call below.
      employeeNumber: `T-LC-OWNDEV-${stamp}`,
      // Provide email for the object/call below.
      email: `t-lc-owndev-${stamp}@test.local`,
      // Provide role for the object/call below.
      role: Role.owner,
      // Provide fullName for the object/call below.
      fullName: "T Lifecycle Owner Device",
    });
    // Arrange or act for this test case.
    fixtureIds.push(privileged.employeeId);
    // Await async work into device.
    const device = await prisma.device.create({
      // Provide data for the object/call below.
      data: {
        // Provide userId for the object/call below.
        userId: privileged.userId,
        // Provide employeeId for the object/call below.
        employeeId: privileged.employeeId,
        // Provide label for the object/call below.
        label: "OwnerPhone",
        // Provide fingerprint for the object/call below.
        fingerprint: `fp-own-${stamp}`,
      },
    });

    // Arrange or act for this test case.
    const { token: mgrTok } = await loginBearer(
      // Pass api through.
      api,
      // Pass managerActor.email through.
      managerActor.email,
      // Pass string literal argument.
      "test-password-t03",
    );
    // Await async work into forbidden.
    const forbidden = await postJson(
      // Pass api through.
      api,
      // Pass mgrTok through.
      mgrTok,
      // Arrange or act for this test case.
      `/devices/${device.id}/revoke`,
      // Arrange or act for this test case.
      {},
    );
    // Assert expected outcome for this case.
    assert.equal(forbidden.status, 403);

    // Await async work into still.
    const still = await prisma.device.findUniqueOrThrow({
      // Provide where for the object/call below.
      where: { id: device.id },
    });
    // Assert expected outcome for this case.
    assert.equal(still.revokedAt, null);

    // Arrange or act for this test case.
    const { token: ownerTok } = await loginBearer(
      // Pass api through.
      api,
      // Pass ownerActor.email through.
      ownerActor.email,
      // Pass string literal argument.
      "test-password-t03",
    );
    // Await async work into ok.
    const ok = await postJson(api, ownerTok, `/devices/${device.id}/revoke`, {});
    // Assert expected outcome for this case.
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  });
});
