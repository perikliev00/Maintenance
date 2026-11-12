// Runtime import from ../../tests/dbBarrier.
import { withDatabaseBarrier } from "../../tests/dbBarrier";
// Strict assert helpers for precise test failures.
import assert from "node:assert/strict";
// Runtime import from node:path.
import path from "node:path";
// Node test runner (describe/it/hooks).
import { after, describe, it } from "node:test";
// Prisma client enums and input types.
import { PrismaClient, Role } from "@prisma/client";
// Runtime import from dotenv.
import dotenv from "dotenv";
// Module import required below.
import {
  cleanupEmployeeGraph,
  createEmployeeWithUser,
// Support the surrounding control flow.
} from "../../tests/fixtures";
// Runtime import from ../errors.
import { AppError } from "../errors";
// Module import required below.
import {
  createSession,
  revokeSession,
  rotateRefresh,
// Support the surrounding control flow.
} from "./authSessions";

// Support the surrounding control flow.
dotenv.config({
  // Set path.
  path: path.resolve(__dirname, "../../.env"),
  // Set override flag.
  override: true,
});

// Local prisma used below.
const prisma = new PrismaClient();

// Internal helper isAppError401.
function isAppError401(err: unknown, message: string): boolean {
  // Return computed result.
  return (
    // Additional clause in this boolean decision.
    err instanceof AppError &&
    // Additional clause in this boolean decision.
    err.status === 401 &&
    // Additional clause in this boolean decision.
    err.code === "unauthorized" &&
    // Assign err.message.
    err.message === message
  );
}

// Test suite: rotateRefresh.
describe("rotateRefresh", () => {
  // Accumulator list fixtureIds.
  const fixtureIds: string[] = [];

  // Tear down after cases.
  after(async () => {
    // Await side effect before continuing.
    await cleanupEmployeeGraph(prisma, fixtureIds);
    // Prisma side effect for this step.
    await prisma.$disconnect();
  });

  // Test case: rejects revoked session without creating a successor.
  it("rejects revoked session without creating a successor", async () => {
    // Local stamp used below.
    const stamp = Date.now();
    // Await user before dependent work.
    const user = await createEmployeeWithUser(prisma, {
      // Param employeeNumber required by this function.
      employeeNumber: `T-RR-A-${stamp}`,
      // Param email required by this function.
      email: `t-rr-a-${stamp}@test.local`,
      // Param role required by this function.
      role: Role.housekeeper,
      // Param fullName required by this function.
      fullName: "T RotateRefresh A",
    });
    // Support the surrounding control flow.
    fixtureIds.push(user.employeeId);

    // Build tokens for the login response.
    const tokens = await createSession({ userId: user.userId });
    // Local sessionId used below.
    const sessionId = tokens.sessionId;
    // Local refresh used below.
    const refresh = tokens.refreshToken;

    // Await side effect before continuing.
    await revokeSession(sessionId);

    // Count rows into sessionsBefore.
    const sessionsBefore = await prisma.authSession.count({
      // Filter matching rows.
      where: { userId: user.userId },
    });

    // Await side effect before continuing.
    await assert.rejects(
      // Support the surrounding control flow.
      () => rotateRefresh(refresh),
      // Support the surrounding control flow.
      (err: unknown) => isAppError401(err, "Refresh token revoked"),
    );

    // Count rows into sessionsAfter.
    const sessionsAfter = await prisma.authSession.count({
      // Filter matching rows.
      where: { userId: user.userId },
    });
    // Compare scalar values.
    assert.equal(sessionsAfter, sessionsBefore);

    // Fetch row by unique/first match.
    const row = await prisma.authSession.findUniqueOrThrow({
      // Filter matching rows.
      where: { id: sessionId },
    });
    // Require truthy condition.
    assert.ok(row.revokedAt !== null);
    // Compare scalar values.
    assert.equal(row.replacedById, null);
  });

  // AUTH-T-P004-02: rotateRefresh when user inactive mass-revokes sessions
  it("rejects inactive user and revokes all active sessions", async () => {
    // Local stamp used below.
    const stamp = Date.now();
    // Await user before dependent work.
    const user = await createEmployeeWithUser(prisma, {
      // Param employeeNumber required by this function.
      employeeNumber: `T-RR-IN-${stamp}`,
      // Param email required by this function.
      email: `t-rr-in-${stamp}@test.local`,
      // Param role required by this function.
      role: Role.housekeeper,
      // Param fullName required by this function.
      fullName: "T RotateRefresh Inactive",
    });
    // Support the surrounding control flow.
    fixtureIds.push(user.employeeId);

    // Build session1 for the login response.
    const session1 = await createSession({ userId: user.userId });
    // Build session2 for the login response.
    const session2 = await createSession({ userId: user.userId });
    // Count rows into sessionsBefore.
    const sessionsBefore = await prisma.authSession.count({
      // Filter matching rows.
      where: { userId: user.userId },
    });

    // Persist field updates.
    await prisma.user.update({
      // Filter matching rows.
      where: { id: user.userId },
      // Mutation data payload.
      data: { isActive: false },
    });
    // Catch locally so callers get mapped errors.
    try {
      // Await side effect before continuing.
      await assert.rejects(
        // Support the surrounding control flow.
        () => rotateRefresh(session1.refreshToken),
        // Support the surrounding control flow.
        (err: unknown) => isAppError401(err, "User inactive"),
      );

      // Fetch row1 by unique/first match.
      const row1 = await prisma.authSession.findUniqueOrThrow({
        // Filter matching rows.
        where: { id: session1.sessionId },
      });
      // Fetch row2 by unique/first match.
      const row2 = await prisma.authSession.findUniqueOrThrow({
        // Filter matching rows.
        where: { id: session2.sessionId },
      });
      // Require truthy condition.
      assert.ok(row1.revokedAt !== null);
      // Require truthy condition.
      assert.ok(row2.revokedAt !== null);

      // Count rows into activeCount.
      const activeCount = await prisma.authSession.count({
        // Filter matching rows.
        where: { userId: user.userId, revokedAt: null },
      });
      // Compare scalar values.
      assert.equal(activeCount, 0);

      // Count rows into sessionsAfter.
      const sessionsAfter = await prisma.authSession.count({
        // Filter matching rows.
        where: { userId: user.userId },
      });
      // Compare scalar values.
      assert.equal(sessionsAfter, sessionsBefore);
    // Support the surrounding control flow.
    } finally {
      // Persist field updates.
      await prisma.user.update({
        // Filter matching rows.
        where: { id: user.userId },
        // Mutation data payload.
        data: { isActive: true },
      });
    }
  });

  // AUTH-T-P005-01: reuse of rotated refresh terminates profile sessions
  it("reuse of rotated refresh revokes all profile sessions; other user untouched", async () => {
    // Local stamp used below.
    const stamp = Date.now();
    // Await userA before dependent work.
    const userA = await createEmployeeWithUser(prisma, {
      // Param employeeNumber required by this function.
      employeeNumber: `T-RR-RA-${stamp}`,
      // Param email required by this function.
      email: `t-rr-ra-${stamp}@test.local`,
      // Param role required by this function.
      role: Role.housekeeper,
      // Param fullName required by this function.
      fullName: "T RotateRefresh Reuse A",
    });
    // Await userB before dependent work.
    const userB = await createEmployeeWithUser(prisma, {
      // Param employeeNumber required by this function.
      employeeNumber: `T-RR-RB-${stamp}`,
      // Param email required by this function.
      email: `t-rr-rb-${stamp}@test.local`,
      // Param role required by this function.
      role: Role.technician,
      // Param fullName required by this function.
      fullName: "T RotateRefresh Reuse B",
    });
    // Support the surrounding control flow.
    fixtureIds.push(userA.employeeId, userB.employeeId);

    // Build s0 for the login response.
    const s0 = await createSession({ userId: userA.userId });
    // Build sOther for the login response.
    const sOther = await createSession({ userId: userA.userId });
    // Build sB for the login response.
    const sB = await createSession({ userId: userB.userId });
    // Local oldRefresh used below.
    const oldRefresh = s0.refreshToken;

    // Await rotated before dependent work.
    const rotated = await rotateRefresh(oldRefresh);
    // Assert expected outcome.
    assert.notEqual(rotated.sessionId, s0.sessionId);

    // Fetch s0AfterRotate by unique/first match.
    const s0AfterRotate = await prisma.authSession.findUniqueOrThrow({
      // Filter matching rows.
      where: { id: s0.sessionId },
    });
    // Require truthy condition.
    assert.ok(s0AfterRotate.revokedAt !== null);
    // Compare scalar values.
    assert.equal(s0AfterRotate.replacedById, rotated.sessionId);

    // Await side effect before continuing.
    await assert.rejects(
      // Support the surrounding control flow.
      () => rotateRefresh(oldRefresh),
      // Support the surrounding control flow.
      (err: unknown) => isAppError401(err, "Refresh token revoked"),
    );

    // Fetch successor by unique/first match.
    const successor = await prisma.authSession.findUniqueOrThrow({
      // Filter matching rows.
      where: { id: rotated.sessionId },
    });
    // Fetch sibling by unique/first match.
    const sibling = await prisma.authSession.findUniqueOrThrow({
      // Filter matching rows.
      where: { id: sOther.sessionId },
    });
    // Fetch controlB by unique/first match.
    const controlB = await prisma.authSession.findUniqueOrThrow({
      // Filter matching rows.
      where: { id: sB.sessionId },
    });
    // Require truthy condition.
    assert.ok(successor.revokedAt !== null);
    // Require truthy condition.
    assert.ok(sibling.revokedAt !== null);
    // Compare scalar values.
    assert.equal(controlB.revokedAt, null);

    // Await rotatedB before dependent work.
    const rotatedB = await rotateRefresh(sB.refreshToken);
    // Require truthy condition.
    assert.ok(rotatedB.accessToken);
    // Assert expected outcome.
    assert.notEqual(rotatedB.sessionId, sB.sessionId);
  });

  // AUTH-T-P006-01: concurrent rotateRefresh — one winner, no extra session
  it("concurrent rotateRefresh: only one succeeds and one active successor", async () => {
    // Local stamp used below.
    const stamp = Date.now();
    // Await user before dependent work.
    const user = await createEmployeeWithUser(prisma, {
      // Param employeeNumber required by this function.
      employeeNumber: `T-RR-CC-${stamp}`,
      // Param email required by this function.
      email: `t-rr-cc-${stamp}@test.local`,
      // Param role required by this function.
      role: Role.housekeeper,
      // Param fullName required by this function.
      fullName: "T RotateRefresh Concurrent",
    });
    // Support the surrounding control flow.
    fixtureIds.push(user.employeeId);

    // Build tokens for the login response.
    const tokens = await createSession({ userId: user.userId });
    // Local refresh used below.
    const refresh = tokens.refreshToken;
    // Local predecessorId used below.
    const predecessorId = tokens.sessionId;

    // Await results before dependent work.
    const results = await withDatabaseBarrier(prisma, tx => tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id = ${predecessorId} FOR UPDATE`, () => Promise.allSettled([
      // Invoke rotateRefresh.
      rotateRefresh(refresh),
      // Invoke rotateRefresh.
      rotateRefresh(refresh),
    ]));

    // fulfilled: filtered subset.
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    // rejected: filtered subset.
    const rejected = results.filter((r) => r.status === "rejected");
    // Compare scalar values.
    assert.equal(fulfilled.length, 1);
    // Compare scalar values.
    assert.equal(rejected.length, 1);

    // Local rejectedErr used below.
    const rejectedErr = (rejected[0] as PromiseRejectedResult).reason;
    // Require truthy condition.
    assert.ok(isAppError401(rejectedErr, "Refresh token already used"));

    // Local winner used below.
    const winner = (fulfilled[0] as PromiseFulfilledResult<{
      // Param sessionId required by this function.
      sessionId: string;
    // Support the surrounding control flow.
    }>).value;

    // Fetch predecessor by unique/first match.
    const predecessor = await prisma.authSession.findUniqueOrThrow({
      // Filter matching rows.
      where: { id: predecessorId },
    });
    // Require truthy condition.
    assert.ok(predecessor.revokedAt !== null);
    // Compare scalar values.
    assert.equal(predecessor.replacedById, winner.sessionId);

    // Count rows into activeCount.
    const activeCount = await prisma.authSession.count({
      // Filter matching rows.
      where: { userId: user.userId, revokedAt: null },
    });
    // Compare scalar values.
    assert.equal(activeCount, 1);

    // Count rows into totalCount.
    const totalCount = await prisma.authSession.count({
      // Filter matching rows.
      where: { userId: user.userId },
    });
    // Compare scalar values.
    assert.equal(totalCount, 2);

    // Fetch successor by unique/first match.
    const successor = await prisma.authSession.findUniqueOrThrow({
      // Filter matching rows.
      where: { id: winner.sessionId },
    });
    // Compare scalar values.
    assert.equal(successor.revokedAt, null);
  });
});
