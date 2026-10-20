import { withDatabaseBarrier } from "../../tests/dbBarrier";
/**
 * HTTP integration: T-ROLE-HTTP-01, T-OWNER-HTTP-01, T-OWNER-HTTP-02.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { PrismaClient, Role } from "@prisma/client";
import dotenv from "dotenv";
import {
  cleanupEmployeeGraph,
  createEmployeeWithUser,
  type EmployeeUserFixture,
} from "../../tests/fixtures";
import {
  closeServer,
  getJson,
  listenApp,
  loginBearer,
  patchJson,
} from "../../tests/httpHarness";
import { ensureDefaultRoleGrants } from "../services/roleGrants";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-secret-for-people-role-http";

const prisma = new PrismaClient();

async function snapshotOwnerIds(): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: { role: Role.owner, isActive: true },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function restoreOwners(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await prisma.user.updateMany({
    where: { id: { in: ids } },
    data: { role: Role.owner, isActive: true },
  });
}

describe("people role HTTP (P1-02 / P1-03)", () => {
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  let api = "";
  const fixtureIds: string[] = [];
  let ownerActor: EmployeeUserFixture;
  let target: EmployeeUserFixture;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    await ensureDefaultRoleGrants();
    const stamp = Date.now();

    ownerActor = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-ROLE-OA-${stamp}`,
      email: `t-role-oa-${stamp}@test.local`,
      role: Role.owner,
      fullName: "T Role Owner Actor",
    });
    target = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-ROLE-TGT-${stamp}`,
      email: `t-role-tgt-${stamp}@test.local`,
      role: Role.housekeeper,
      fullName: "T Role Target",
    });
    fixtureIds.push(ownerActor.employeeId, target.employeeId);

    const listened = await listenApp();
    server = listened.server;
    api = listened.api;
  });

  after(async () => {
    if (server) await closeServer(server);
    await cleanupEmployeeGraph(prisma, fixtureIds);
    await prisma.$disconnect();
  });

  it("T-ROLE-HTTP-01: role change revokes sessions; new login uses new role", async () => {
    const { token: oldToken } = await loginBearer(
      api,
      target.email,
      "test-password-t03",
    );
    const meBefore = await getJson(api, oldToken, "/auth/me");
    assert.equal(meBefore.status, 200);

    const { token: actorTok } = await loginBearer(
      api,
      ownerActor.email,
      "test-password-t03",
    );
    const changed = await patchJson(
      api,
      actorTok,
      `/people/${target.userId}/role`,
      { role: Role.technician },
    );
    assert.equal(changed.status, 200, JSON.stringify(changed.body));

    const after = await getJson(api, oldToken, "/auth/me");
    assert.equal(after.status, 401);
    assert.equal((after.body as { error?: string }).error, "unauthorized");
    assert.equal(
      (after.body as { message?: string }).message,
      "Invalid token",
    );

    const sessions = await prisma.authSession.findMany({
      where: { userId: target.userId },
    });
    assert.ok(sessions.length > 0);
    assert.ok(sessions.every((s) => s.revokedAt != null));

    const { token: fresh, user } = await loginBearer(
      api,
      target.email,
      "test-password-t03",
    );
    assert.equal(user.role, Role.technician);
    const me = await getJson(api, fresh, "/auth/me");
    assert.equal(me.status, 200);
    assert.equal((me.body as { role?: Role }).role, Role.technician);

    await patchJson(api, actorTok, `/people/${target.userId}/role`, {
      role: Role.housekeeper,
    });
  });

  it("T-OWNER-HTTP-01: cannot demote last active owner", async () => {
    const priorOwners = await snapshotOwnerIds();
    const stamp = Date.now();
    const sole = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-ROLE-SOLE-${stamp}`,
      email: `t-role-sole-${stamp}@test.local`,
      role: Role.owner,
      fullName: "T Role Sole Owner",
    });
    fixtureIds.push(sole.employeeId);

    const demoteOthers = () =>
      prisma.user.updateMany({
        where: {
          role: Role.owner,
          isActive: true,
          id: { not: sole.userId },
        },
        data: { role: Role.manager },
      });

    try {
      // Parallel test files may create owners; retry until we are truly last.
      let saw409 = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        await demoteOthers();
        await prisma.user.update({
          where: { id: sole.userId },
          data: { role: Role.owner, isActive: true },
        });
        const count = await prisma.user.count({
          where: { role: Role.owner, isActive: true },
        });
        if (count !== 1) continue;

        const { token } = await loginBearer(
          api,
          sole.email,
          "test-password-t03",
        );
        const res = await patchJson(api, token, `/people/${sole.userId}/role`, {
          role: Role.manager,
        });
        if (res.status === 409) {
          assert.equal((res.body as { error?: string }).error, "conflict");
          assert.equal(
            (res.body as { message?: string }).message,
            "Cannot demote the last active owner",
          );
          saw409 = true;
          break;
        }
        // Parallel suite reintroduced another owner — restore sole and retry.
        await prisma.user.update({
          where: { id: sole.userId },
          data: { role: Role.owner },
        });
      }
      assert.equal(saw409, true, "expected 409 last-owner denial");
      const row = await prisma.user.findUnique({ where: { id: sole.userId } });
      assert.equal(row?.role, Role.owner);
    } finally {
      await restoreOwners([...priorOwners, sole.userId]);
    }
  });

  it("T-OWNER-HTTP-02: concurrent demotion leaves ≥1 active owner", async () => {
    const priorOwners = await snapshotOwnerIds();
    const stamp = Date.now();
    // Real 2-owner race: A and B demote each other (no third “safety” owner).
    const a = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-ROLE-CA-${stamp}`,
      email: `t-role-ca-${stamp}@test.local`,
      role: Role.owner,
      fullName: "T Role Conc A",
    });
    const b = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-ROLE-CB-${stamp}`,
      email: `t-role-cb-${stamp}@test.local`,
      role: Role.owner,
      fullName: "T Role Conc B",
    });
    fixtureIds.push(a.employeeId, b.employeeId);

    try {
      let raced = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        // Exactly two active owners worldwide for this race window.
        await prisma.user.updateMany({
          where: {
            role: Role.owner,
            isActive: true,
            id: { notIn: [a.userId, b.userId] },
          },
          data: { role: Role.manager },
        });
        await prisma.user.updateMany({
          where: { id: { in: [a.userId, b.userId] } },
          data: { role: Role.owner, isActive: true },
        });

        const before = await prisma.user.count({
          where: { role: Role.owner, isActive: true },
        });
        if (before !== 2) continue;

        const [{ token: tokA }, { token: tokB }] = await Promise.all([
          loginBearer(api, a.email, "test-password-t03"),
          loginBearer(api, b.email, "test-password-t03"),
        ]);

        // Re-assert immediately before the race (parallel suites may insert owners).
        await prisma.user.updateMany({
          where: {
            role: Role.owner,
            isActive: true,
            id: { notIn: [a.userId, b.userId] },
          },
          data: { role: Role.manager },
        });
        const beforeRace = await prisma.user.count({
          where: { role: Role.owner, isActive: true },
        });
        if (beforeRace !== 2) continue;

        // A demotes B while B demotes A — classic last-pair TOCTOU.
        const [rAb, rBa] = await withDatabaseBarrier(prisma, tx => tx.$queryRaw`SELECT id FROM "User" WHERE id IN (${a.userId}, ${b.userId}) ORDER BY id FOR UPDATE`, () => Promise.all([
          patchJson(api, tokA, `/people/${b.userId}/role`, {
            role: Role.manager,
          }),
          patchJson(api, tokB, `/people/${a.userId}/role`, {
            role: Role.manager,
          }),
        ]));

        const remaining = await prisma.user.findMany({
          where: { role: Role.owner, isActive: true },
          select: { id: true },
        });
        assert.deepEqual([rAb.status, rBa.status].sort(), [200, 409]);
        assert.equal(remaining.length, 1);
        assert.ok(
          remaining.length >= 1,
          `owner count must stay ≥1, got ${remaining.length}; statuses ${rAb.status},${rBa.status}`,
        );
        assert.ok(
          remaining.every((o) => o.id === a.userId || o.id === b.userId),
          `unexpected remaining owners: ${remaining.map((o) => o.id).join(",")}`,
        );
        // With FOR UPDATE, one demotion should succeed and the other hit last-owner 409.
        assert.ok(
          rAb.status === 409 || rBa.status === 409,
          `expected at least one 409 in 2-owner race; got ${rAb.status},${rBa.status}`,
        );
        raced = true;
        break;
      }
      assert.equal(raced, true, "failed to establish exclusive 2-owner race");
    } finally {
      await restoreOwners([...priorOwners, a.userId, b.userId]);
    }
  });
});
