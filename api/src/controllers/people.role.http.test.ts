// Import local module ../../tests/dbBarrier.
import { withDatabaseBarrier } from "../../tests/dbBarrier";
/**
 * HTTP integration: , , .
 */
import assert from "node:assert/strict";
// Import dependency node:path.
import path from "node:path";
// Import dependency node:test.
import { after, before, describe, it } from "node:test";
// Import dependency @prisma/client.
import { PrismaClient, Role } from "@prisma/client";
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
  // Bring patchJson into scope from the import.
  patchJson,
} from "../../tests/httpHarness";
// Import local module ../services/roleGrants.
import { ensureDefaultRoleGrants } from "../services/roleGrants";

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
  process.env.JWT_SECRET || "test-secret-for-people-role-http";

// Bind prisma for use in the handler below.
const prisma = new PrismaClient();

// Async helper snapshotOwnerIds keeps handler bodies thin.
async function snapshotOwnerIds(): Promise<string[]> {
  // Await async work into rows.
  const rows = await prisma.user.findMany({
    // Provide where for the object/call below.
    where: { role: Role.owner, isActive: true },
    // Provide select for the object/call below.
    select: { id: true },
  });
  // Return value or early exit.
  return rows.map((r) => r.id);
}

// Async helper restoreOwners keeps handler bodies thin.
async function restoreOwners(ids: string[]): Promise<void> {
  // Guard: skip or fail when the negated condition holds.
  if (!ids.length) return;
  // Await side-effecting async work.
  await prisma.user.updateMany({
    // Provide where for the object/call below.
    where: { id: { in: ids } },
    // Provide data for the object/call below.
    data: { role: Role.owner, isActive: true },
  });
}

// Test suite grouping related cases.
describe("people role HTTP", () => {
  // Arrange or act for this test case.
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  // Mutable api updated as the flow proceeds.
  let api = "";
  // Arrange or act for this test case.
  const fixtureIds: string[] = [];
  // Arrange or act for this test case.
  let ownerActor: EmployeeUserFixture;
  // Arrange or act for this test case.
  let target: EmployeeUserFixture;

  // Setup hook run before tests.
  before(async () => {
    // Assert expected outcome for this case.
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Await side-effecting async work.
    await ensureDefaultRoleGrants();
    // Bind stamp for use in the handler below.
    const stamp = Date.now();

    // Arrange or act for this test case.
    ownerActor = await createEmployeeWithUser(prisma, {
      // Provide employeeNumber for the object/call below.
      employeeNumber: `T-ROLE-OA-${stamp}`,
      // Provide email for the object/call below.
      email: `t-role-oa-${stamp}@test.local`,
      // Provide role for the object/call below.
      role: Role.owner,
      // Provide fullName for the object/call below.
      fullName: "T Role Owner Actor",
    });
    // Arrange or act for this test case.
    target = await createEmployeeWithUser(prisma, {
      // Provide employeeNumber for the object/call below.
      employeeNumber: `T-ROLE-TGT-${stamp}`,
      // Provide email for the object/call below.
      email: `t-role-tgt-${stamp}@test.local`,
      // Provide role for the object/call below.
      role: Role.housekeeper,
      // Provide fullName for the object/call below.
      fullName: "T Role Target",
    });
    // Arrange or act for this test case.
    fixtureIds.push(ownerActor.employeeId, target.employeeId);

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
  it("role change revokes sessions; new login uses new role", async () => {
    // Arrange or act for this test case.
    const { token: oldToken } = await loginBearer(
      // Pass api through.
      api,
      // Pass target.email through.
      target.email,
      // Pass string literal argument.
      "test-password-t03",
    );
    // Await async work into meBefore.
    const meBefore = await getJson(api, oldToken, "/auth/me");
    // Assert expected outcome for this case.
    assert.equal(meBefore.status, 200);

    // Arrange or act for this test case.
    const { token: actorTok } = await loginBearer(
      // Pass api through.
      api,
      // Pass ownerActor.email through.
      ownerActor.email,
      // Pass string literal argument.
      "test-password-t03",
    );
    // Await async work into changed.
    const changed = await patchJson(
      // Pass api through.
      api,
      // Pass actorTok through.
      actorTok,
      // Arrange or act for this test case.
      `/people/${target.userId}/role`,
      // Arrange or act for this test case.
      { role: Role.technician },
    );
    // Assert expected outcome for this case.
    assert.equal(changed.status, 200, JSON.stringify(changed.body));

    // Await async work into after.
    const after = await getJson(api, oldToken, "/auth/me");
    // Assert expected outcome for this case.
    assert.equal(after.status, 401);
    // Assert expected outcome for this case.
    assert.equal((after.body as { error?: string }).error, "unauthorized");
    // Assert expected outcome for this case.
    assert.equal(
      // Arrange or act for this test case.
      (after.body as { message?: string }).message,
      // Pass string literal argument.
      "Invalid token",
    );

    // Await async work into sessions.
    const sessions = await prisma.authSession.findMany({
      // Provide where for the object/call below.
      where: { userId: target.userId },
    });
    // Assert expected outcome for this case.
    assert.ok(sessions.length > 0);
    // Assert expected outcome for this case.
    assert.ok(sessions.every((s) => s.revokedAt != null));

    // Arrange or act for this test case.
    const { token: fresh, user } = await loginBearer(
      // Pass api through.
      api,
      // Pass target.email through.
      target.email,
      // Pass string literal argument.
      "test-password-t03",
    );
    // Assert expected outcome for this case.
    assert.equal(user.role, Role.technician);
    // Await async work into me.
    const me = await getJson(api, fresh, "/auth/me");
    // Assert expected outcome for this case.
    assert.equal(me.status, 200);
    // Assert expected outcome for this case.
    assert.equal((me.body as { role?: Role }).role, Role.technician);

    // Await side-effecting async work.
    await patchJson(api, actorTok, `/people/${target.userId}/role`, {
      // Provide role for the object/call below.
      role: Role.housekeeper,
    });
  });

  // Single test case asserting expected behavior.
  it("cannot demote last active owner", async () => {
    // Await async work into priorOwners.
    const priorOwners = await snapshotOwnerIds();
    // Bind stamp for use in the handler below.
    const stamp = Date.now();
    // Await async work into sole.
    const sole = await createEmployeeWithUser(prisma, {
      // Provide employeeNumber for the object/call below.
      employeeNumber: `T-ROLE-SOLE-${stamp}`,
      // Provide email for the object/call below.
      email: `t-role-sole-${stamp}@test.local`,
      // Provide role for the object/call below.
      role: Role.owner,
      // Provide fullName for the object/call below.
      fullName: "T Role Sole Owner",
    });
    // Arrange or act for this test case.
    fixtureIds.push(sole.employeeId);

    // Bind demoteOthers for use in the handler below.
    const demoteOthers = () =>
      // Arrange or act for this test case.
      prisma.user.updateMany({
        // Provide where for the object/call below.
        where: {
          // Provide role for the object/call below.
          role: Role.owner,
          // Provide isActive for the object/call below.
          isActive: true,
          // Provide id for the object/call below.
          id: { not: sole.userId },
        },
        // Provide data for the object/call below.
        data: { role: Role.manager },
      });

    // Try block for operations that may throw.
    try {
      // Parallel test files may create owners; retry until we are truly last.
      let saw409 = false;
      // Iterate to process each item.
      for (let attempt = 0; attempt < 5; attempt++) {
        // Await side-effecting async work.
        await demoteOthers();
        // Await side-effecting async work.
        await prisma.user.update({
          // Provide where for the object/call below.
          where: { id: sole.userId },
          // Provide data for the object/call below.
          data: { role: Role.owner, isActive: true },
        });
        // Await async work into count.
        const count = await prisma.user.count({
          // Provide where for the object/call below.
          where: { role: Role.owner, isActive: true },
        });
        // Branch when this condition holds.
        if (count !== 1) continue;

        // Arrange or act for this test case.
        const { token } = await loginBearer(
          // Pass api through.
          api,
          // Pass sole.email through.
          sole.email,
          // Pass string literal argument.
          "test-password-t03",
        );
        // Await async work into res.
        const res = await patchJson(api, token, `/people/${sole.userId}/role`, {
          // Provide role for the object/call below.
          role: Role.manager,
        });
        // Branch when this condition holds.
        if (res.status === 409) {
          // Assert expected outcome for this case.
          assert.equal((res.body as { error?: string }).error, "conflict");
          // Assert expected outcome for this case.
          assert.equal(
            // Arrange or act for this test case.
            (res.body as { message?: string }).message,
            // Pass string literal argument.
            "Cannot demote the last active owner",
          );
          // Arrange or act for this test case.
          saw409 = true;
          // Arrange or act for this test case.
          break;
        }
        // Parallel suite reintroduced another owner — restore sole and retry.
        await prisma.user.update({
          // Provide where for the object/call below.
          where: { id: sole.userId },
          // Provide data for the object/call below.
          data: { role: Role.owner },
        });
      }
      // Assert expected outcome for this case.
      assert.equal(saw409, true, "expected 409 last-owner denial");
      // Await async work into row.
      const row = await prisma.user.findUnique({ where: { id: sole.userId } });
      // Assert expected outcome for this case.
      assert.equal(row?.role, Role.owner);
    // Arrange or act for this test case.
    } finally {
      // Await side-effecting async work.
      await restoreOwners([...priorOwners, sole.userId]);
    }
  });

  // Single test case asserting expected behavior.
  it("concurrent demotion leaves ≥1 active owner", async () => {
    // Await async work into priorOwners.
    const priorOwners = await snapshotOwnerIds();
    // Bind stamp for use in the handler below.
    const stamp = Date.now();
    // Real 2-owner race: A and B demote each other (no third “safety” owner).
    const a = await createEmployeeWithUser(prisma, {
      // Provide employeeNumber for the object/call below.
      employeeNumber: `T-ROLE-CA-${stamp}`,
      // Provide email for the object/call below.
      email: `t-role-ca-${stamp}@test.local`,
      // Provide role for the object/call below.
      role: Role.owner,
      // Provide fullName for the object/call below.
      fullName: "T Role Conc A",
    });
    // Await async work into b.
    const b = await createEmployeeWithUser(prisma, {
      // Provide employeeNumber for the object/call below.
      employeeNumber: `T-ROLE-CB-${stamp}`,
      // Provide email for the object/call below.
      email: `t-role-cb-${stamp}@test.local`,
      // Provide role for the object/call below.
      role: Role.owner,
      // Provide fullName for the object/call below.
      fullName: "T Role Conc B",
    });
    // Arrange or act for this test case.
    fixtureIds.push(a.employeeId, b.employeeId);

    // Try block for operations that may throw.
    try {
      // Mutable raced updated as the flow proceeds.
      let raced = false;
      // Iterate to process each item.
      for (let attempt = 0; attempt < 5; attempt++) {
        // Exactly two active owners worldwide for this race window.
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
          data: { role: Role.manager },
        });
        // Await side-effecting async work.
        await prisma.user.updateMany({
          // Provide where for the object/call below.
          where: { id: { in: [a.userId, b.userId] } },
          // Provide data for the object/call below.
          data: { role: Role.owner, isActive: true },
        });

        // Await async work into before.
        const before = await prisma.user.count({
          // Provide where for the object/call below.
          where: { role: Role.owner, isActive: true },
        });
        // Branch when this condition holds.
        if (before !== 2) continue;

        // Arrange or act for this test case.
        const [{ token: tokA }, { token: tokB }] = await Promise.all([
          // Arrange or act for this test case.
          loginBearer(api, a.email, "test-password-t03"),
          // Arrange or act for this test case.
          loginBearer(api, b.email, "test-password-t03"),
        ]);

        // Re-assert immediately before the race (parallel suites may insert owners).
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
          data: { role: Role.manager },
        });
        // Await async work into beforeRace.
        const beforeRace = await prisma.user.count({
          // Provide where for the object/call below.
          where: { role: Role.owner, isActive: true },
        });
        // Branch when this condition holds.
        if (beforeRace !== 2) continue;

        // A demotes B while B demotes A — classic last-pair TOCTOU.
        const [rAb, rBa] = await withDatabaseBarrier(prisma, tx => tx.$queryRaw`SELECT id FROM "User" WHERE id IN (${a.userId}, ${b.userId}) ORDER BY id FOR UPDATE`, () => Promise.all([
          // Arrange or act for this test case.
          patchJson(api, tokA, `/people/${b.userId}/role`, {
            // Provide role for the object/call below.
            role: Role.manager,
          }),
          // Arrange or act for this test case.
          patchJson(api, tokB, `/people/${a.userId}/role`, {
            // Provide role for the object/call below.
            role: Role.manager,
          }),
        ]));

        // Await async work into remaining.
        const remaining = await prisma.user.findMany({
          // Provide where for the object/call below.
          where: { role: Role.owner, isActive: true },
          // Provide select for the object/call below.
          select: { id: true },
        });
        // Assert expected outcome for this case.
        assert.deepEqual([rAb.status, rBa.status].sort(), [200, 409]);
        // Assert expected outcome for this case.
        assert.equal(remaining.length, 1);
        // Assert expected outcome for this case.
        assert.ok(
          // Arrange or act for this test case.
          remaining.length >= 1,
          // Arrange or act for this test case.
          `owner count must stay ≥1, got ${remaining.length}; statuses ${rAb.status},${rBa.status}`,
        );
        // Assert expected outcome for this case.
        assert.ok(
          // Arrange or act for this test case.
          remaining.every((o) => o.id === a.userId || o.id === b.userId),
          // Arrange or act for this test case.
          `unexpected remaining owners: ${remaining.map((o) => o.id).join(",")}`,
        );
        // With FOR UPDATE, one demotion should succeed and the other hit last-owner 409.
        assert.ok(
          // Arrange or act for this test case.
          rAb.status === 409 || rBa.status === 409,
          // Arrange or act for this test case.
          `expected at least one 409 in 2-owner race; got ${rAb.status},${rBa.status}`,
        );
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
      await restoreOwners([...priorOwners, a.userId, b.userId]);
    }
  });
});
