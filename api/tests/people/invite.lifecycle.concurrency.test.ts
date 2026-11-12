/**
 * Invitation issue/redeem vs people lifecycle concurrency.
 * Asserts coherent DB end-state (not merely HTTP / raw deadlock codes).
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { InvitationStatus, PrismaClient, Role } from "@prisma/client";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Concurrency helpers to order/observe PostgreSQL lock waiters.
import { withDatabaseBarrier } from "../dbBarrier";
import {
  cleanupEmployeeGraph,
  createEmployeeWithUser,
} from "../fixtures";
import { AppError } from "../../src/errors";
import {
  issueInvitation,
  redeemInvitation,
} from "../../src/services/invitations";
import {
  archivePerson,
  blockPerson,
} from "../../src/services/people/lifecycle";
import { canChangeUserRole } from "../../src/permissions";
import { lockUsersForLiveAccess } from "../../src/services/liveAccessLocks";
import { prisma as appPrisma } from "../../src/db";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Suite: invite × lifecycle concurrency.
describe("invite × lifecycle concurrency", () => {
  const fixtureIds: string[] = [];
  let owner: Awaited<ReturnType<typeof createEmployeeWithUser>>;
  let manager: Awaited<ReturnType<typeof createEmployeeWithUser>>;

  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    const stamp = Date.now();
    owner = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-IL-OWN-${stamp}`,
      email: `t-il-own-${stamp}@test.local`,
      role: Role.owner,
      fullName: "T Invite Lifecycle Owner",
    });
    manager = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-IL-MGR-${stamp}`,
      email: `t-il-mgr-${stamp}@test.local`,
      role: Role.manager,
      fullName: "T Invite Lifecycle Manager",
    });
    fixtureIds.push(owner.employeeId, manager.employeeId);
  });

  after(async () => {
    await prisma.invitation.deleteMany({
      where: { employeeId: { in: fixtureIds } },
    });
    await cleanupEmployeeGraph(prisma, fixtureIds);
    await prisma.$disconnect();
  });

  // Local helper accessVersion used by cases in this file.
  async function accessVersion(employeeId: string): Promise<number> {
    const row = await prisma.employee.findUniqueOrThrow({
      where: { id: employeeId },
      select: { accessVersion: true },
    });
    return row.accessVersion;
  }

  // Local helper issuedCount used by cases in this file.
  async function issuedCount(employeeId: string): Promise<number> {
    return prisma.invitation.count({
      where: { employeeId, status: InvitationStatus.issued },
    });
  }

  // Case probes concurrency/isolation: issue vs block — no issued invite remains on blocked account.
  it("issue vs block — no issued invite remains on blocked account", async () => {
    const stamp = Date.now();
    // target: seeded entity required before the mutation under test.
    const target = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-IL-IB-${stamp}`,
      email: `t-il-ib-${stamp}@test.local`,
      role: Role.housekeeper,
      fullName: "T Invite Block Target",
    });
    fixtureIds.push(target.employeeId);
    const version = await accessVersion(target.employeeId);

    const settled = await withDatabaseBarrier(
      prisma,
      (tx) =>
        tx.$queryRaw`
          SELECT id FROM "User" WHERE id = ${target.userId} FOR UPDATE
        `,
      () =>
        // Run actors together to expose races and serialization bugs.
        Promise.allSettled([
          issueInvitation(
            { userId: manager.userId, role: Role.manager },
            { kind: "existing", employeeId: target.employeeId },
          ),
          blockPerson(
            {
              userId: manager.userId,
              employeeId: manager.employeeId,
              role: Role.manager,
            },
            target.employeeId,
            "active",
            version,
          ),
        ]),
    );

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: target.userId },
    });
    assert.equal(user.isActive, false);
    assert.equal(await issuedCount(target.employeeId), 0);

    const statuses = settled.map((s) => s.status);
    assert.ok(statuses.includes("fulfilled"));
    // Issue may fulfill then have its invite revoked by block, or reject as blocked.
    const issueResult = settled[0];
    if (issueResult.status === "rejected") {
      assert.ok(issueResult.reason instanceof AppError);
    }
  });

  // Case probes concurrency/isolation: issue vs archive — no issued invite on archived employee.
  it("issue vs archive — no issued invite on archived employee", async () => {
    const stamp = Date.now();
    // target: seeded entity required before the mutation under test.
    const target = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-IL-IA-${stamp}`,
      email: `t-il-ia-${stamp}@test.local`,
      role: Role.housekeeper,
      fullName: "T Invite Archive Target",
    });
    fixtureIds.push(target.employeeId);
    const version = await accessVersion(target.employeeId);

    await withDatabaseBarrier(
      prisma,
      (tx) =>
        tx.$queryRaw`
          SELECT id FROM "User" WHERE id = ${target.userId} FOR UPDATE
        `,
      () =>
        // Run actors together to expose races and serialization bugs.
        Promise.allSettled([
          issueInvitation(
            { userId: manager.userId, role: Role.manager },
            { kind: "existing", employeeId: target.employeeId },
          ),
          archivePerson(
            {
              userId: manager.userId,
              employeeId: manager.employeeId,
              role: Role.manager,
            },
            target.employeeId,
            "active",
            version,
          ),
        ]),
    );

    const emp = await prisma.employee.findUniqueOrThrow({
      where: { id: target.employeeId },
    });
    assert.ok(emp.archivedAt);
    assert.equal(await issuedCount(target.employeeId), 0);
  });

  // Case probes concurrency/isolation: redeem vs block — coherent blocked or activated state.
  it("redeem vs block — coherent blocked or activated state", async () => {
    const stamp = Date.now();
    // target: seeded entity required before the mutation under test.
    const target = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-IL-RB-${stamp}`,
      email: `t-il-rb-${stamp}@test.local`,
      role: Role.housekeeper,
      fullName: "T Redeem Block Target",
    });
    fixtureIds.push(target.employeeId);
    // Pending activation so redeem needs password.
    await prisma.user.update({
      where: { id: target.userId },
      data: { activatedAt: null },
    });
    const issued = await issueInvitation(
      { userId: manager.userId, role: Role.manager },
      { kind: "existing", employeeId: target.employeeId },
    );
    const version = await accessVersion(target.employeeId);

    const settled = await withDatabaseBarrier(
      prisma,
      (tx) =>
        tx.$queryRaw`
          SELECT id FROM "User" WHERE id = ${target.userId} FOR UPDATE
        `,
      () =>
        // Run actors together to expose races and serialization bugs.
        Promise.allSettled([
          redeemInvitation({
            code: issued.code,
            password: "redeem-password-99",
            deviceLabel: "RacePhone",
            fingerprint: randomUUID(),
          }),
          blockPerson(
            {
              userId: manager.userId,
              employeeId: manager.employeeId,
              role: Role.manager,
            },
            target.employeeId,
            "active",
            version,
          ),
        ]),
    );

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: target.userId },
    });
    const invite = await prisma.invitation.findUniqueOrThrow({
      where: { id: issued.invitation.id },
    });
    // sessions: session cookie jar for authenticated requests.
    const sessions = await prisma.authSession.count({
      where: { userId: target.userId, revokedAt: null },
    });

    if (!user.isActive) {
      // Block won (or redeemed then blocked): no live issued invite, sessions stopped.
      assert.notEqual(invite.status, InvitationStatus.issued);
      assert.equal(sessions, 0);
    } else {
      // Redeem won and block failed/stale: user activated with consumed invite.
      assert.ok(user.activatedAt);
      assert.equal(invite.status, InvitationStatus.consumed);
      assert.ok(settled[1].status === "rejected");
    }
  });

  // Case probes concurrency/isolation: redeem vs archive — never archived+active with live session from that redeem.
  it("redeem vs archive — never archived+active with live session from that redeem", async () => {
    const stamp = Date.now();
    // target: seeded entity required before the mutation under test.
    const target = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-IL-RA-${stamp}`,
      email: `t-il-ra-${stamp}@test.local`,
      role: Role.housekeeper,
      fullName: "T Redeem Archive Target",
    });
    fixtureIds.push(target.employeeId);
    await prisma.user.update({
      where: { id: target.userId },
      data: { activatedAt: null },
    });
    const issued = await issueInvitation(
      { userId: manager.userId, role: Role.manager },
      { kind: "existing", employeeId: target.employeeId },
    );
    const version = await accessVersion(target.employeeId);

    await withDatabaseBarrier(
      prisma,
      (tx) =>
        tx.$queryRaw`
          SELECT id FROM "User" WHERE id = ${target.userId} FOR UPDATE
        `,
      () =>
        // Run actors together to expose races and serialization bugs.
        Promise.allSettled([
          redeemInvitation({
            code: issued.code,
            password: "redeem-password-99",
            deviceLabel: "ArchPhone",
            fingerprint: randomUUID(),
          }),
          archivePerson(
            {
              userId: manager.userId,
              employeeId: manager.employeeId,
              role: Role.manager,
            },
            target.employeeId,
            "active",
            version,
          ),
        ]),
    );

    const emp = await prisma.employee.findUniqueOrThrow({
      where: { id: target.employeeId },
    });
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: target.userId },
    });
    // liveSessions: session cookie jar for authenticated requests.
    const liveSessions = await prisma.authSession.count({
      where: { userId: target.userId, revokedAt: null },
    });

    if (emp.archivedAt) {
      assert.equal(user.isActive, false);
      assert.equal(liveSessions, 0);
      assert.equal(await issuedCount(target.employeeId), 0);
    } else {
      assert.ok(user.activatedAt);
      assert.equal(user.isActive, true);
    }
  });

  // Case probes concurrency/isolation: two concurrent reissues leave exactly one issued invite.
  it("two concurrent reissues leave exactly one issued invite", async () => {
    const stamp = Date.now();
    // target: seeded entity required before the mutation under test.
    const target = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-IL-DUAL-${stamp}`,
      email: `t-il-dual-${stamp}@test.local`,
      role: Role.housekeeper,
      fullName: "T Dual Reissue Target",
    });
    fixtureIds.push(target.employeeId);

    const settled = await withDatabaseBarrier(
      prisma,
      (tx) =>
        tx.$queryRaw`
          SELECT id FROM "User" WHERE id = ${target.userId} FOR UPDATE
        `,
      () =>
        // Run actors together to expose races and serialization bugs.
        Promise.allSettled([
          issueInvitation(
            { userId: manager.userId, role: Role.manager },
            { kind: "existing", employeeId: target.employeeId },
          ),
          issueInvitation(
            { userId: owner.userId, role: Role.owner },
            { kind: "existing", employeeId: target.employeeId },
          ),
        ]),
    );

    assert.equal(
      settled.filter((s) => s.status === "fulfilled").length,
      2,
    );
    assert.equal(await issuedCount(target.employeeId), 1);
  });

  // Case probes concurrency/isolation: role change to privileged vs manager issue refuses under lock.
  it("role change to privileged vs manager issue refuses under lock", async () => {
    const stamp = Date.now();
    // target: seeded entity required before the mutation under test.
    const target = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-IL-ROLE-${stamp}`,
      email: `t-il-role-${stamp}@test.local`,
      role: Role.technician,
      fullName: "T Role Invite Target",
    });
    fixtureIds.push(target.employeeId);

    assert.equal(
      canChangeUserRole(Role.owner, Role.technician, Role.admin),
      true,
    );

    const settled = await withDatabaseBarrier(
      prisma,
      (tx) => lockUsersForLiveAccess(tx, [target.userId]),
      () =>
        // Run actors together to expose races and serialization bugs.
        Promise.allSettled([
          (async () => {
            await appPrisma.$transaction(async (tx) => {
              await lockUsersForLiveAccess(tx, [target.userId]);
              await tx.user.update({
                where: { id: target.userId },
                data: { role: Role.admin },
              });
              await tx.employee.update({
                where: { id: target.employeeId },
                data: { accessVersion: { increment: 1 } },
              });
            });
          })(),
          issueInvitation(
            { userId: manager.userId, role: Role.manager },
            { kind: "existing", employeeId: target.employeeId },
          ),
        ]),
    );

    const role = (
      await prisma.user.findUniqueOrThrow({ where: { id: target.userId } })
    ).role;
    assert.equal(role, Role.admin);
    // Manager cannot invite admin; if issue ran first it may have succeeded then
    // role changed — invite would still be for technician. Prefer: no issued
    // invite for admin managed by manager, or invite only if issued before promotion.
    const issued = await prisma.invitation.findMany({
      where: { employeeId: target.employeeId, status: InvitationStatus.issued },
    });
    if (settled[1].status === "fulfilled") {
      // Issue won before role bump — invite role must be technician (pre-change).
      assert.equal(issued.length, 1);
      assert.equal(issued[0]!.role, Role.technician);
    } else {
      assert.equal(issued.length, 0);
      assert.ok(settled[1].reason instanceof AppError);
    }
  });

  // Case probes concurrency/isolation: archive no-User vs redeem — not archived and activated contradictorily.
  it("archive no-User vs redeem — not archived and activated contradictorily", async () => {
    const stamp = Date.now();
    // emp: seeded entity required before the mutation under test.
    const emp = await prisma.employee.create({
      data: {
        employeeNumber: `T-IL-NU-${stamp}`,
        fullName: "T NoUser Archive Redeem",
      },
    });
    fixtureIds.push(emp.id);

    const issued = await issueInvitation(
      { userId: manager.userId, role: Role.manager },
      {
        kind: "existing",
        employeeId: emp.id,
        email: `t-il-nu-${stamp}@test.local`,
        role: Role.housekeeper,
      },
    );
    // Issue created a pending user — archive after that uses User→Employee.
    // For true no-User race: create invite path already creates user.
    // Simulate race by deleting nothing; instead start from pending user +
    // archive vs redeem (closest to onboard-then-archive).
    const user = await prisma.user.findFirstOrThrow({
      where: { employeeId: emp.id },
    });
    const version = await accessVersion(emp.id);

    await withDatabaseBarrier(
      prisma,
      (tx) =>
        tx.$queryRaw`
          SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE
        `,
      () =>
        // Run actors together to expose races and serialization bugs.
        Promise.allSettled([
          redeemInvitation({
            code: issued.code,
            password: "redeem-password-99",
            deviceLabel: "NoUserPhone",
            fingerprint: randomUUID(),
          }),
          archivePerson(
            {
              userId: manager.userId,
              employeeId: manager.employeeId,
              role: Role.manager,
            },
            emp.id,
            "not_activated",
            version,
          ),
        ]),
    );

    const freshEmp = await prisma.employee.findUniqueOrThrow({
      where: { id: emp.id },
    });
    const freshUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    // liveSessions: session cookie jar for authenticated requests.
    const liveSessions = await prisma.authSession.count({
      where: { userId: user.id, revokedAt: null },
    });

    if (freshEmp.archivedAt) {
      assert.equal(freshUser.isActive, false);
      assert.equal(liveSessions, 0);
    } else {
      assert.ok(freshUser.activatedAt);
      assert.equal(freshUser.isActive, true);
    }
  });

  // Case probes concurrency/isolation: archive employee still without User vs concurrent pending-user issue.
  it("archive employee still without User vs concurrent pending-user issue", async () => {
    const stamp = Date.now();
    // emp: seeded entity required before the mutation under test.
    const emp = await prisma.employee.create({
      data: {
        employeeNumber: `T-IL-NU2-${stamp}`,
        fullName: "T NoUser Pure Archive",
      },
    });
    fixtureIds.push(emp.id);
    const version = await accessVersion(emp.id);

    const settled = await withDatabaseBarrier(
      prisma,
      (tx) =>
        tx.$queryRaw`
          SELECT id FROM "Employee" WHERE id = ${emp.id} FOR UPDATE
        `,
      () =>
        // Run actors together to expose races and serialization bugs.
        Promise.allSettled([
          issueInvitation(
            { userId: manager.userId, role: Role.manager },
            {
              kind: "existing",
              employeeId: emp.id,
              email: `t-il-nu2-${stamp}@test.local`,
              role: Role.housekeeper,
            },
          ),
          archivePerson(
            {
              userId: manager.userId,
              employeeId: manager.employeeId,
              role: Role.manager,
            },
            emp.id,
            "not_activated",
            version,
          ),
        ]),
    );

    const freshEmp = await prisma.employee.findUniqueOrThrow({
      where: { id: emp.id },
    });
    const users = await prisma.user.findMany({ where: { employeeId: emp.id } });

    if (freshEmp.archivedAt) {
      // Archive won (possibly after issue): inactive user(s), no live invite.
      for (const u of users) {
        assert.equal(u.isActive, false);
      }
      assert.equal(await issuedCount(emp.id), 0);
    } else {
      // Issue won and archive refused: pending user + exactly one issued invite.
      assert.equal(users.length, 1);
      assert.equal(users[0]!.isActive, true);
      assert.equal(users[0]!.activatedAt, null);
      assert.equal(settled[0].status, "fulfilled");
      assert.equal(settled[1].status, "rejected");
      assert.equal(await issuedCount(emp.id), 1);
    }
  });
});
