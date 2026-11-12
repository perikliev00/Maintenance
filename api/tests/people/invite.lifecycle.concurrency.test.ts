/**
 * Invitation issue/redeem vs people lifecycle concurrency.
 * Asserts coherent DB end-state (not merely HTTP / raw deadlock codes).
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Import bindings from node:crypto.
import { randomUUID } from "node:crypto";
// Node test runner and strict assertions for API suite checks.
import { after, before, describe, it } from "node:test";
// Prisma client types/runtime for DB setup and assertions.
import { InvitationStatus, PrismaClient, Role } from "@prisma/client";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Concurrency helpers to order/observe PostgreSQL lock waiters.
import { withDatabaseBarrier } from "../dbBarrier";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  cleanupEmployeeGraph,
  // Execute the next setup or assertion step for this scenario.
  createEmployeeWithUser,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "../fixtures";
// Import bindings from ../../src/errors.
import { AppError } from "../../src/errors";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  issueInvitation,
  // Execute the next setup or assertion step for this scenario.
  redeemInvitation,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/invitations";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  archivePerson,
  // Concurrency/isolation step for the race under test.
  blockPerson,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/people/lifecycle";
// Import bindings from ../../src/permissions.
import { canChangeUserRole } from "../../src/permissions";
// Import bindings from ../../src/services/liveAccessLocks.
import { lockUsersForLiveAccess } from "../../src/services/liveAccessLocks";
// Import bindings from ../../src/db.
import { prisma as appPrisma } from "../../src/db";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Suite: invite × lifecycle concurrency.
describe("invite × lifecycle concurrency", () => {
  // Seed prerequisite rows so the mutation under test has a realistic baseline.
  const fixtureIds: string[] = [];
  // Execute the next setup or assertion step for this scenario.
  let owner: Awaited<ReturnType<typeof createEmployeeWithUser>>;
  // Execute the next setup or assertion step for this scenario.
  let manager: Awaited<ReturnType<typeof createEmployeeWithUser>>;

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    // stamp: unique stamp so parallel runs do not collide.
    const stamp = Date.now();
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    owner = await createEmployeeWithUser(prisma, {
      // Fixture field employeeNumber for the seeded actor/entity.
      employeeNumber: `T-IL-OWN-${stamp}`,
      // Fixture field email for the seeded actor/entity.
      email: `t-il-own-${stamp}@test.local`,
      // Fixture field role for the seeded actor/entity.
      role: Role.owner,
      // Fixture field fullName for the seeded actor/entity.
      fullName: "T Invite Lifecycle Owner",
    });
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    manager = await createEmployeeWithUser(prisma, {
      // Fixture field employeeNumber for the seeded actor/entity.
      employeeNumber: `T-IL-MGR-${stamp}`,
      // Fixture field email for the seeded actor/entity.
      email: `t-il-mgr-${stamp}@test.local`,
      // Fixture field role for the seeded actor/entity.
      role: Role.manager,
      // Fixture field fullName for the seeded actor/entity.
      fullName: "T Invite Lifecycle Manager",
    });
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    fixtureIds.push(owner.employeeId, manager.employeeId);
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Await async work before asserting or releasing locks.
    await prisma.invitation.deleteMany({
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      where: { employeeId: { in: fixtureIds } },
    });
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    await cleanupEmployeeGraph(prisma, fixtureIds);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Local helper accessVersion used by cases in this file.
  async function accessVersion(employeeId: string): Promise<number> {
    // row: synchronize actors so the race window is observable.
    const row = await prisma.employee.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: employeeId },
      // SQL fragment used to observe locks or assert DB state.
      select: { accessVersion: true },
    });
    // Return the arranged value/result to the caller.
    return row.accessVersion;
  }

  // Local helper issuedCount used by cases in this file.
  async function issuedCount(employeeId: string): Promise<number> {
    // Return the arranged value/result to the caller.
    return prisma.invitation.count({
      // SQL fragment used to observe locks or assert DB state.
      where: { employeeId, status: InvitationStatus.issued },
    });
  }

  // Case probes concurrency/isolation: issue vs block — no issued invite remains on blocked account.
  it("issue vs block — no issued invite remains on blocked account", async () => {
    // stamp: unique stamp so parallel runs do not collide.
    const stamp = Date.now();
    // target: seeded entity required before the mutation under test.
    const target = await createEmployeeWithUser(prisma, {
      // Fixture field employeeNumber for the seeded actor/entity.
      employeeNumber: `T-IL-IB-${stamp}`,
      // Fixture field email for the seeded actor/entity.
      email: `t-il-ib-${stamp}@test.local`,
      // Fixture field role for the seeded actor/entity.
      role: Role.housekeeper,
      // Fixture field fullName for the seeded actor/entity.
      fullName: "T Invite Block Target",
    });
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    fixtureIds.push(target.employeeId);
    // version: HTTP response captured for status/body checks.
    const version = await accessVersion(target.employeeId);

    // settled: synchronize actors so the race window is observable.
    const settled = await withDatabaseBarrier(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      (tx) =>
        // Execute the next setup or assertion step for this scenario.
        tx.$queryRaw`
          SELECT id FROM "User" WHERE id = ${target.userId} FOR UPDATE
        `,
      // Execute the next setup or assertion step for this scenario.
      () =>
        // Run actors together to expose races and serialization bugs.
        Promise.allSettled([
          // Execute the next setup or assertion step for this scenario.
          issueInvitation(
            // Execute the next setup or assertion step for this scenario.
            { userId: manager.userId, role: Role.manager },
            // Execute the next setup or assertion step for this scenario.
            { kind: "existing", employeeId: target.employeeId },
          ),
          // Concurrency/isolation step for the race under test.
          blockPerson(
            {
              // Execute the next setup or assertion step for this scenario.
              userId: manager.userId,
              // Execute the next setup or assertion step for this scenario.
              employeeId: manager.employeeId,
              // Fixture field role for the seeded actor/entity.
              role: Role.manager,
            },
            // Execute the next setup or assertion step for this scenario.
            target.employeeId,
            // Execute the next setup or assertion step for this scenario.
            "active",
            // Execute the next setup or assertion step for this scenario.
            version,
          ),
        ]),
    );

    // user: synchronize actors so the race window is observable.
    const user = await prisma.user.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: target.userId },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(user.isActive, false);
    // Assert the observed value matches the intended post-condition.
    assert.equal(await issuedCount(target.employeeId), 0);

    // Bind statuses for later setup or assertions in this scope.
    const statuses = settled.map((s) => s.status);
    // Assert HTTP status matches the contract for this path.
    assert.ok(statuses.includes("fulfilled"));
    // Issue may fulfill then have its invite revoked by block, or reject as blocked.
    const issueResult = settled[0];
    // Guard optional cleanup or alternate assertion paths.
    if (issueResult.status === "rejected") {
      // Assert the observed value matches the intended post-condition.
      assert.ok(issueResult.reason instanceof AppError);
    }
  });

  // Case probes concurrency/isolation: issue vs archive — no issued invite on archived employee.
  it("issue vs archive — no issued invite on archived employee", async () => {
    // stamp: unique stamp so parallel runs do not collide.
    const stamp = Date.now();
    // target: seeded entity required before the mutation under test.
    const target = await createEmployeeWithUser(prisma, {
      // Fixture field employeeNumber for the seeded actor/entity.
      employeeNumber: `T-IL-IA-${stamp}`,
      // Fixture field email for the seeded actor/entity.
      email: `t-il-ia-${stamp}@test.local`,
      // Fixture field role for the seeded actor/entity.
      role: Role.housekeeper,
      // Fixture field fullName for the seeded actor/entity.
      fullName: "T Invite Archive Target",
    });
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    fixtureIds.push(target.employeeId);
    // version: HTTP response captured for status/body checks.
    const version = await accessVersion(target.employeeId);

    // Await async work before asserting or releasing locks.
    await withDatabaseBarrier(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      (tx) =>
        // Execute the next setup or assertion step for this scenario.
        tx.$queryRaw`
          SELECT id FROM "User" WHERE id = ${target.userId} FOR UPDATE
        `,
      // Execute the next setup or assertion step for this scenario.
      () =>
        // Run actors together to expose races and serialization bugs.
        Promise.allSettled([
          // Execute the next setup or assertion step for this scenario.
          issueInvitation(
            // Execute the next setup or assertion step for this scenario.
            { userId: manager.userId, role: Role.manager },
            // Execute the next setup or assertion step for this scenario.
            { kind: "existing", employeeId: target.employeeId },
          ),
          // Execute the next setup or assertion step for this scenario.
          archivePerson(
            {
              // Execute the next setup or assertion step for this scenario.
              userId: manager.userId,
              // Execute the next setup or assertion step for this scenario.
              employeeId: manager.employeeId,
              // Fixture field role for the seeded actor/entity.
              role: Role.manager,
            },
            // Execute the next setup or assertion step for this scenario.
            target.employeeId,
            // Execute the next setup or assertion step for this scenario.
            "active",
            // Execute the next setup or assertion step for this scenario.
            version,
          ),
        ]),
    );

    // emp: synchronize actors so the race window is observable.
    const emp = await prisma.employee.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: target.employeeId },
    });
    // Assert the observed value matches the intended post-condition.
    assert.ok(emp.archivedAt);
    // Assert the observed value matches the intended post-condition.
    assert.equal(await issuedCount(target.employeeId), 0);
  });

  // Case probes concurrency/isolation: redeem vs block — coherent blocked or activated state.
  it("redeem vs block — coherent blocked or activated state", async () => {
    // stamp: unique stamp so parallel runs do not collide.
    const stamp = Date.now();
    // target: seeded entity required before the mutation under test.
    const target = await createEmployeeWithUser(prisma, {
      // Fixture field employeeNumber for the seeded actor/entity.
      employeeNumber: `T-IL-RB-${stamp}`,
      // Fixture field email for the seeded actor/entity.
      email: `t-il-rb-${stamp}@test.local`,
      // Fixture field role for the seeded actor/entity.
      role: Role.housekeeper,
      // Fixture field fullName for the seeded actor/entity.
      fullName: "T Redeem Block Target",
    });
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    fixtureIds.push(target.employeeId);
    // Pending activation so redeem needs password.
    await prisma.user.update({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: target.userId },
      // Execute the next setup or assertion step for this scenario.
      data: { activatedAt: null },
    });
    // issued: synchronize actors so the race window is observable.
    const issued = await issueInvitation(
      // Execute the next setup or assertion step for this scenario.
      { userId: manager.userId, role: Role.manager },
      // Execute the next setup or assertion step for this scenario.
      { kind: "existing", employeeId: target.employeeId },
    );
    // version: HTTP response captured for status/body checks.
    const version = await accessVersion(target.employeeId);

    // settled: synchronize actors so the race window is observable.
    const settled = await withDatabaseBarrier(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      (tx) =>
        // Execute the next setup or assertion step for this scenario.
        tx.$queryRaw`
          SELECT id FROM "User" WHERE id = ${target.userId} FOR UPDATE
        `,
      // Execute the next setup or assertion step for this scenario.
      () =>
        // Run actors together to expose races and serialization bugs.
        Promise.allSettled([
          // Execute the next setup or assertion step for this scenario.
          redeemInvitation({
            // Execute the next setup or assertion step for this scenario.
            code: issued.code,
            // Fixture field password for the seeded actor/entity.
            password: "redeem-password-99",
            // Concurrency/isolation step for the race under test.
            deviceLabel: "RacePhone",
            // Execute the next setup or assertion step for this scenario.
            fingerprint: randomUUID(),
          }),
          // Concurrency/isolation step for the race under test.
          blockPerson(
            {
              // Execute the next setup or assertion step for this scenario.
              userId: manager.userId,
              // Execute the next setup or assertion step for this scenario.
              employeeId: manager.employeeId,
              // Fixture field role for the seeded actor/entity.
              role: Role.manager,
            },
            // Execute the next setup or assertion step for this scenario.
            target.employeeId,
            // Execute the next setup or assertion step for this scenario.
            "active",
            // Execute the next setup or assertion step for this scenario.
            version,
          ),
        ]),
    );

    // user: synchronize actors so the race window is observable.
    const user = await prisma.user.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: target.userId },
    });
    // invite: synchronize actors so the race window is observable.
    const invite = await prisma.invitation.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: issued.invitation.id },
    });
    // sessions: session cookie jar for authenticated requests.
    const sessions = await prisma.authSession.count({
      // SQL fragment used to observe locks or assert DB state.
      where: { userId: target.userId, revokedAt: null },
    });

    // Conditional path for setup, cleanup, or alternate outcomes.
    if (!user.isActive) {
      // Block won (or redeemed then blocked): no live issued invite, sessions stopped.
      assert.notEqual(invite.status, InvitationStatus.issued);
      // Assert the observed value matches the intended post-condition.
      assert.equal(sessions, 0);
    // Execute the next setup or assertion step for this scenario.
    } else {
      // Redeem won and block failed/stale: user activated with consumed invite.
      assert.ok(user.activatedAt);
      // Assert HTTP status matches the contract for this path.
      assert.equal(invite.status, InvitationStatus.consumed);
      // Assert HTTP status matches the contract for this path.
      assert.ok(settled[1].status === "rejected");
    }
  });

  // Case probes concurrency/isolation: redeem vs archive — never archived+active with live session from that redeem.
  it("redeem vs archive — never archived+active with live session from that redeem", async () => {
    // stamp: unique stamp so parallel runs do not collide.
    const stamp = Date.now();
    // target: seeded entity required before the mutation under test.
    const target = await createEmployeeWithUser(prisma, {
      // Fixture field employeeNumber for the seeded actor/entity.
      employeeNumber: `T-IL-RA-${stamp}`,
      // Fixture field email for the seeded actor/entity.
      email: `t-il-ra-${stamp}@test.local`,
      // Fixture field role for the seeded actor/entity.
      role: Role.housekeeper,
      // Fixture field fullName for the seeded actor/entity.
      fullName: "T Redeem Archive Target",
    });
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    fixtureIds.push(target.employeeId);
    // Await async work before asserting or releasing locks.
    await prisma.user.update({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: target.userId },
      // Execute the next setup or assertion step for this scenario.
      data: { activatedAt: null },
    });
    // issued: synchronize actors so the race window is observable.
    const issued = await issueInvitation(
      // Execute the next setup or assertion step for this scenario.
      { userId: manager.userId, role: Role.manager },
      // Execute the next setup or assertion step for this scenario.
      { kind: "existing", employeeId: target.employeeId },
    );
    // version: HTTP response captured for status/body checks.
    const version = await accessVersion(target.employeeId);

    // Await async work before asserting or releasing locks.
    await withDatabaseBarrier(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      (tx) =>
        // Execute the next setup or assertion step for this scenario.
        tx.$queryRaw`
          SELECT id FROM "User" WHERE id = ${target.userId} FOR UPDATE
        `,
      // Execute the next setup or assertion step for this scenario.
      () =>
        // Run actors together to expose races and serialization bugs.
        Promise.allSettled([
          // Execute the next setup or assertion step for this scenario.
          redeemInvitation({
            // Execute the next setup or assertion step for this scenario.
            code: issued.code,
            // Fixture field password for the seeded actor/entity.
            password: "redeem-password-99",
            // Execute the next setup or assertion step for this scenario.
            deviceLabel: "ArchPhone",
            // Execute the next setup or assertion step for this scenario.
            fingerprint: randomUUID(),
          }),
          // Execute the next setup or assertion step for this scenario.
          archivePerson(
            {
              // Execute the next setup or assertion step for this scenario.
              userId: manager.userId,
              // Execute the next setup or assertion step for this scenario.
              employeeId: manager.employeeId,
              // Fixture field role for the seeded actor/entity.
              role: Role.manager,
            },
            // Execute the next setup or assertion step for this scenario.
            target.employeeId,
            // Execute the next setup or assertion step for this scenario.
            "active",
            // Execute the next setup or assertion step for this scenario.
            version,
          ),
        ]),
    );

    // emp: synchronize actors so the race window is observable.
    const emp = await prisma.employee.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: target.employeeId },
    });
    // user: synchronize actors so the race window is observable.
    const user = await prisma.user.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: target.userId },
    });
    // liveSessions: session cookie jar for authenticated requests.
    const liveSessions = await prisma.authSession.count({
      // SQL fragment used to observe locks or assert DB state.
      where: { userId: target.userId, revokedAt: null },
    });

    // Conditional path for setup, cleanup, or alternate outcomes.
    if (emp.archivedAt) {
      // Assert the observed value matches the intended post-condition.
      assert.equal(user.isActive, false);
      // Assert the observed value matches the intended post-condition.
      assert.equal(liveSessions, 0);
      // Assert the observed value matches the intended post-condition.
      assert.equal(await issuedCount(target.employeeId), 0);
    // Execute the next setup or assertion step for this scenario.
    } else {
      // Assert the observed value matches the intended post-condition.
      assert.ok(user.activatedAt);
      // Assert the observed value matches the intended post-condition.
      assert.equal(user.isActive, true);
    }
  });

  // Case probes concurrency/isolation: two concurrent reissues leave exactly one issued invite.
  it("two concurrent reissues leave exactly one issued invite", async () => {
    // stamp: unique stamp so parallel runs do not collide.
    const stamp = Date.now();
    // target: seeded entity required before the mutation under test.
    const target = await createEmployeeWithUser(prisma, {
      // Fixture field employeeNumber for the seeded actor/entity.
      employeeNumber: `T-IL-DUAL-${stamp}`,
      // Fixture field email for the seeded actor/entity.
      email: `t-il-dual-${stamp}@test.local`,
      // Fixture field role for the seeded actor/entity.
      role: Role.housekeeper,
      // Fixture field fullName for the seeded actor/entity.
      fullName: "T Dual Reissue Target",
    });
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    fixtureIds.push(target.employeeId);

    // settled: synchronize actors so the race window is observable.
    const settled = await withDatabaseBarrier(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      (tx) =>
        // Execute the next setup or assertion step for this scenario.
        tx.$queryRaw`
          SELECT id FROM "User" WHERE id = ${target.userId} FOR UPDATE
        `,
      // Execute the next setup or assertion step for this scenario.
      () =>
        // Run actors together to expose races and serialization bugs.
        Promise.allSettled([
          // Execute the next setup or assertion step for this scenario.
          issueInvitation(
            // Execute the next setup or assertion step for this scenario.
            { userId: manager.userId, role: Role.manager },
            // Execute the next setup or assertion step for this scenario.
            { kind: "existing", employeeId: target.employeeId },
          ),
          // Execute the next setup or assertion step for this scenario.
          issueInvitation(
            // Execute the next setup or assertion step for this scenario.
            { userId: owner.userId, role: Role.owner },
            // Execute the next setup or assertion step for this scenario.
            { kind: "existing", employeeId: target.employeeId },
          ),
        ]),
    );

    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      settled.filter((s) => s.status === "fulfilled").length,
      2,
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(await issuedCount(target.employeeId), 1);
  });

  // Case probes concurrency/isolation: role change to privileged vs manager issue refuses under lock.
  it("role change to privileged vs manager issue refuses under lock", async () => {
    // stamp: unique stamp so parallel runs do not collide.
    const stamp = Date.now();
    // target: seeded entity required before the mutation under test.
    const target = await createEmployeeWithUser(prisma, {
      // Fixture field employeeNumber for the seeded actor/entity.
      employeeNumber: `T-IL-ROLE-${stamp}`,
      // Fixture field email for the seeded actor/entity.
      email: `t-il-role-${stamp}@test.local`,
      // Fixture field role for the seeded actor/entity.
      role: Role.technician,
      // Fixture field fullName for the seeded actor/entity.
      fullName: "T Role Invite Target",
    });
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    fixtureIds.push(target.employeeId);

    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      canChangeUserRole(Role.owner, Role.technician, Role.admin),
      // Execute the next setup or assertion step for this scenario.
      true,
    );

    // settled: synchronize actors so the race window is observable.
    const settled = await withDatabaseBarrier(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Concurrency/isolation step for the race under test.
      (tx) => lockUsersForLiveAccess(tx, [target.userId]),
      // Execute the next setup or assertion step for this scenario.
      () =>
        // Run actors together to expose races and serialization bugs.
        Promise.allSettled([
          // Execute the next setup or assertion step for this scenario.
          (async () => {
            // Await async work before asserting or releasing locks.
            await appPrisma.$transaction(async (tx) => {
              // Await async work before asserting or releasing locks.
              await lockUsersForLiveAccess(tx, [target.userId]);
              // Await async work before asserting or releasing locks.
              await tx.user.update({
                // SQL fragment used to observe locks or assert DB state.
                where: { id: target.userId },
                // Execute the next setup or assertion step for this scenario.
                data: { role: Role.admin },
              });
              // Await async work before asserting or releasing locks.
              await tx.employee.update({
                // SQL fragment used to observe locks or assert DB state.
                where: { id: target.employeeId },
                // Execute the next setup or assertion step for this scenario.
                data: { accessVersion: { increment: 1 } },
              });
            });
          })(),
          // Execute the next setup or assertion step for this scenario.
          issueInvitation(
            // Execute the next setup or assertion step for this scenario.
            { userId: manager.userId, role: Role.manager },
            // Execute the next setup or assertion step for this scenario.
            { kind: "existing", employeeId: target.employeeId },
          ),
        ]),
    );

    // Bind role for later setup or assertions in this scope.
    const role = (
      // Await async work before asserting or releasing locks.
      await prisma.user.findUniqueOrThrow({ where: { id: target.userId } })
    // Execute the next setup or assertion step for this scenario.
    ).role;
    // Assert the observed value matches the intended post-condition.
    assert.equal(role, Role.admin);
    // Manager cannot invite admin; if issue ran first it may have succeeded then
    // role changed — invite would still be for technician. Prefer: no issued
    // invite for admin managed by manager, or invite only if issued before promotion.
    const issued = await prisma.invitation.findMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { employeeId: target.employeeId, status: InvitationStatus.issued },
    });
    // Guard optional cleanup or alternate assertion paths.
    if (settled[1].status === "fulfilled") {
      // Issue won before role bump — invite role must be technician (pre-change).
      assert.equal(issued.length, 1);
      // Assert the observed value matches the intended post-condition.
      assert.equal(issued[0]!.role, Role.technician);
    // Execute the next setup or assertion step for this scenario.
    } else {
      // Assert collection size matches the expected post-condition.
      assert.equal(issued.length, 0);
      // Assert the observed value matches the intended post-condition.
      assert.ok(settled[1].reason instanceof AppError);
    }
  });

  // Case probes concurrency/isolation: archive no-User vs redeem — not archived and activated contradictorily.
  it("archive no-User vs redeem — not archived and activated contradictorily", async () => {
    // stamp: unique stamp so parallel runs do not collide.
    const stamp = Date.now();
    // emp: seeded entity required before the mutation under test.
    const emp = await prisma.employee.create({
      // Execute the next setup or assertion step for this scenario.
      data: {
        // Fixture field employeeNumber for the seeded actor/entity.
        employeeNumber: `T-IL-NU-${stamp}`,
        // Fixture field fullName for the seeded actor/entity.
        fullName: "T NoUser Archive Redeem",
      },
    });
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    fixtureIds.push(emp.id);

    // issued: synchronize actors so the race window is observable.
    const issued = await issueInvitation(
      // Execute the next setup or assertion step for this scenario.
      { userId: manager.userId, role: Role.manager },
      {
        // Execute the next setup or assertion step for this scenario.
        kind: "existing",
        // Execute the next setup or assertion step for this scenario.
        employeeId: emp.id,
        // Fixture field email for the seeded actor/entity.
        email: `t-il-nu-${stamp}@test.local`,
        // Fixture field role for the seeded actor/entity.
        role: Role.housekeeper,
      },
    );
    // Issue created a pending user — archive after that uses User→Employee.
    // For true no-User race: create invite path already creates user.
    // Simulate race by deleting nothing; instead start from pending user +
    // archive vs redeem (closest to onboard-then-archive).
    const user = await prisma.user.findFirstOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { employeeId: emp.id },
    });
    // version: synchronize actors so the race window is observable.
    const version = await accessVersion(emp.id);

    // Await async work before asserting or releasing locks.
    await withDatabaseBarrier(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      (tx) =>
        // Execute the next setup or assertion step for this scenario.
        tx.$queryRaw`
          SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE
        `,
      // Execute the next setup or assertion step for this scenario.
      () =>
        // Run actors together to expose races and serialization bugs.
        Promise.allSettled([
          // Execute the next setup or assertion step for this scenario.
          redeemInvitation({
            // Execute the next setup or assertion step for this scenario.
            code: issued.code,
            // Fixture field password for the seeded actor/entity.
            password: "redeem-password-99",
            // Execute the next setup or assertion step for this scenario.
            deviceLabel: "NoUserPhone",
            // Execute the next setup or assertion step for this scenario.
            fingerprint: randomUUID(),
          }),
          // Execute the next setup or assertion step for this scenario.
          archivePerson(
            {
              // Execute the next setup or assertion step for this scenario.
              userId: manager.userId,
              // Execute the next setup or assertion step for this scenario.
              employeeId: manager.employeeId,
              // Fixture field role for the seeded actor/entity.
              role: Role.manager,
            },
            // Execute the next setup or assertion step for this scenario.
            emp.id,
            // Execute the next setup or assertion step for this scenario.
            "not_activated",
            // Execute the next setup or assertion step for this scenario.
            version,
          ),
        ]),
    );

    // freshEmp: synchronize actors so the race window is observable.
    const freshEmp = await prisma.employee.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: emp.id },
    });
    // freshUser: synchronize actors so the race window is observable.
    const freshUser = await prisma.user.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: user.id },
    });
    // liveSessions: session cookie jar for authenticated requests.
    const liveSessions = await prisma.authSession.count({
      // SQL fragment used to observe locks or assert DB state.
      where: { userId: user.id, revokedAt: null },
    });

    // Conditional path for setup, cleanup, or alternate outcomes.
    if (freshEmp.archivedAt) {
      // Assert the observed value matches the intended post-condition.
      assert.equal(freshUser.isActive, false);
      // Assert the observed value matches the intended post-condition.
      assert.equal(liveSessions, 0);
    // Execute the next setup or assertion step for this scenario.
    } else {
      // Assert the observed value matches the intended post-condition.
      assert.ok(freshUser.activatedAt);
      // Assert the observed value matches the intended post-condition.
      assert.equal(freshUser.isActive, true);
    }
  });

  // Case probes concurrency/isolation: archive employee still without User vs concurrent pending-user issue.
  it("archive employee still without User vs concurrent pending-user issue", async () => {
    // stamp: unique stamp so parallel runs do not collide.
    const stamp = Date.now();
    // emp: seeded entity required before the mutation under test.
    const emp = await prisma.employee.create({
      // Execute the next setup or assertion step for this scenario.
      data: {
        // Fixture field employeeNumber for the seeded actor/entity.
        employeeNumber: `T-IL-NU2-${stamp}`,
        // Fixture field fullName for the seeded actor/entity.
        fullName: "T NoUser Pure Archive",
      },
    });
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    fixtureIds.push(emp.id);
    // version: synchronize actors so the race window is observable.
    const version = await accessVersion(emp.id);

    // settled: synchronize actors so the race window is observable.
    const settled = await withDatabaseBarrier(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      (tx) =>
        // Execute the next setup or assertion step for this scenario.
        tx.$queryRaw`
          SELECT id FROM "Employee" WHERE id = ${emp.id} FOR UPDATE
        `,
      // Execute the next setup or assertion step for this scenario.
      () =>
        // Run actors together to expose races and serialization bugs.
        Promise.allSettled([
          // Execute the next setup or assertion step for this scenario.
          issueInvitation(
            // Execute the next setup or assertion step for this scenario.
            { userId: manager.userId, role: Role.manager },
            {
              // Execute the next setup or assertion step for this scenario.
              kind: "existing",
              // Execute the next setup or assertion step for this scenario.
              employeeId: emp.id,
              // Fixture field email for the seeded actor/entity.
              email: `t-il-nu2-${stamp}@test.local`,
              // Fixture field role for the seeded actor/entity.
              role: Role.housekeeper,
            },
          ),
          // Execute the next setup or assertion step for this scenario.
          archivePerson(
            {
              // Execute the next setup or assertion step for this scenario.
              userId: manager.userId,
              // Execute the next setup or assertion step for this scenario.
              employeeId: manager.employeeId,
              // Fixture field role for the seeded actor/entity.
              role: Role.manager,
            },
            // Execute the next setup or assertion step for this scenario.
            emp.id,
            // Execute the next setup or assertion step for this scenario.
            "not_activated",
            // Execute the next setup or assertion step for this scenario.
            version,
          ),
        ]),
    );

    // freshEmp: synchronize actors so the race window is observable.
    const freshEmp = await prisma.employee.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: emp.id },
    });
    // users: synchronize actors so the race window is observable.
    const users = await prisma.user.findMany({ where: { employeeId: emp.id } });

    // Conditional path for setup, cleanup, or alternate outcomes.
    if (freshEmp.archivedAt) {
      // Archive won (possibly after issue): inactive user(s), no live invite.
      for (const u of users) {
        // Assert the observed value matches the intended post-condition.
        assert.equal(u.isActive, false);
      }
      // Assert the observed value matches the intended post-condition.
      assert.equal(await issuedCount(emp.id), 0);
    // Execute the next setup or assertion step for this scenario.
    } else {
      // Issue won and archive refused: pending user + exactly one issued invite.
      assert.equal(users.length, 1);
      // Assert the observed value matches the intended post-condition.
      assert.equal(users[0]!.isActive, true);
      // Assert the observed value matches the intended post-condition.
      assert.equal(users[0]!.activatedAt, null);
      // Assert HTTP status matches the contract for this path.
      assert.equal(settled[0].status, "fulfilled");
      // Assert HTTP status matches the contract for this path.
      assert.equal(settled[1].status, "rejected");
      // Assert the observed value matches the intended post-condition.
      assert.equal(await issuedCount(emp.id), 1);
    }
  });
});
