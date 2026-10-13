import assert from "node:assert/strict";
import path from "node:path";
import { after, describe, it } from "node:test";
import { PrismaClient, Role } from "@prisma/client";
import dotenv from "dotenv";
import {
  cleanupEmployeeGraph,
  createEmployeeWithUser,
} from "../../tests/fixtures";
import { AppError } from "../errors";
import {
  createSession,
  revokeSession,
  rotateRefresh,
} from "./authSessions";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});

const prisma = new PrismaClient();

function isAppError401(err: unknown, message: string): boolean {
  return (
    err instanceof AppError &&
    err.status === 401 &&
    err.code === "unauthorized" &&
    err.message === message
  );
}

describe("rotateRefresh", () => {
  const fixtureIds: string[] = [];

  after(async () => {
    await cleanupEmployeeGraph(prisma, fixtureIds);
    await prisma.$disconnect();
  });

  it("rejects revoked session without creating a successor", async () => {
    const stamp = Date.now();
    const user = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-RR-A-${stamp}`,
      email: `t-rr-a-${stamp}@test.local`,
      role: Role.housekeeper,
      fullName: "T RotateRefresh A",
    });
    fixtureIds.push(user.employeeId);

    const tokens = await createSession({ userId: user.userId });
    const sessionId = tokens.sessionId;
    const refresh = tokens.refreshToken;

    await revokeSession(sessionId);

    const sessionsBefore = await prisma.authSession.count({
      where: { userId: user.userId },
    });

    await assert.rejects(
      () => rotateRefresh(refresh),
      (err: unknown) => isAppError401(err, "Refresh token revoked"),
    );

    const sessionsAfter = await prisma.authSession.count({
      where: { userId: user.userId },
    });
    assert.equal(sessionsAfter, sessionsBefore);

    const row = await prisma.authSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    assert.ok(row.revokedAt !== null);
    assert.equal(row.replacedById, null);
  });

  // AUTH-T-P004-02: rotateRefresh when user inactive mass-revokes sessions
  it("rejects inactive user and revokes all active sessions", async () => {
    const stamp = Date.now();
    const user = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-RR-IN-${stamp}`,
      email: `t-rr-in-${stamp}@test.local`,
      role: Role.housekeeper,
      fullName: "T RotateRefresh Inactive",
    });
    fixtureIds.push(user.employeeId);

    const session1 = await createSession({ userId: user.userId });
    const session2 = await createSession({ userId: user.userId });
    const sessionsBefore = await prisma.authSession.count({
      where: { userId: user.userId },
    });

    await prisma.user.update({
      where: { id: user.userId },
      data: { isActive: false },
    });
    try {
      await assert.rejects(
        () => rotateRefresh(session1.refreshToken),
        (err: unknown) => isAppError401(err, "User inactive"),
      );

      const row1 = await prisma.authSession.findUniqueOrThrow({
        where: { id: session1.sessionId },
      });
      const row2 = await prisma.authSession.findUniqueOrThrow({
        where: { id: session2.sessionId },
      });
      assert.ok(row1.revokedAt !== null);
      assert.ok(row2.revokedAt !== null);

      const activeCount = await prisma.authSession.count({
        where: { userId: user.userId, revokedAt: null },
      });
      assert.equal(activeCount, 0);

      const sessionsAfter = await prisma.authSession.count({
        where: { userId: user.userId },
      });
      assert.equal(sessionsAfter, sessionsBefore);
    } finally {
      await prisma.user.update({
        where: { id: user.userId },
        data: { isActive: true },
      });
    }
  });

  // AUTH-T-P005-01: reuse of rotated refresh terminates profile sessions
  it("reuse of rotated refresh revokes all profile sessions; other user untouched", async () => {
    const stamp = Date.now();
    const userA = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-RR-RA-${stamp}`,
      email: `t-rr-ra-${stamp}@test.local`,
      role: Role.housekeeper,
      fullName: "T RotateRefresh Reuse A",
    });
    const userB = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-RR-RB-${stamp}`,
      email: `t-rr-rb-${stamp}@test.local`,
      role: Role.technician,
      fullName: "T RotateRefresh Reuse B",
    });
    fixtureIds.push(userA.employeeId, userB.employeeId);

    const s0 = await createSession({ userId: userA.userId });
    const sOther = await createSession({ userId: userA.userId });
    const sB = await createSession({ userId: userB.userId });
    const oldRefresh = s0.refreshToken;

    const rotated = await rotateRefresh(oldRefresh);
    assert.notEqual(rotated.sessionId, s0.sessionId);

    const s0AfterRotate = await prisma.authSession.findUniqueOrThrow({
      where: { id: s0.sessionId },
    });
    assert.ok(s0AfterRotate.revokedAt !== null);
    assert.equal(s0AfterRotate.replacedById, rotated.sessionId);

    await assert.rejects(
      () => rotateRefresh(oldRefresh),
      (err: unknown) => isAppError401(err, "Refresh token revoked"),
    );

    const successor = await prisma.authSession.findUniqueOrThrow({
      where: { id: rotated.sessionId },
    });
    const sibling = await prisma.authSession.findUniqueOrThrow({
      where: { id: sOther.sessionId },
    });
    const controlB = await prisma.authSession.findUniqueOrThrow({
      where: { id: sB.sessionId },
    });
    assert.ok(successor.revokedAt !== null);
    assert.ok(sibling.revokedAt !== null);
    assert.equal(controlB.revokedAt, null);

    const rotatedB = await rotateRefresh(sB.refreshToken);
    assert.ok(rotatedB.accessToken);
    assert.notEqual(rotatedB.sessionId, sB.sessionId);
  });

  // AUTH-T-P006-01: concurrent rotateRefresh — one winner, no extra session
  it("concurrent rotateRefresh: only one succeeds and one active successor", async () => {
    const stamp = Date.now();
    const user = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-RR-CC-${stamp}`,
      email: `t-rr-cc-${stamp}@test.local`,
      role: Role.housekeeper,
      fullName: "T RotateRefresh Concurrent",
    });
    fixtureIds.push(user.employeeId);

    const tokens = await createSession({ userId: user.userId });
    const refresh = tokens.refreshToken;
    const predecessorId = tokens.sessionId;

    const results = await Promise.allSettled([
      rotateRefresh(refresh),
      rotateRefresh(refresh),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);

    const rejectedErr = (rejected[0] as PromiseRejectedResult).reason;
    assert.ok(isAppError401(rejectedErr, "Refresh token already used"));

    const winner = (fulfilled[0] as PromiseFulfilledResult<{
      sessionId: string;
    }>).value;

    const predecessor = await prisma.authSession.findUniqueOrThrow({
      where: { id: predecessorId },
    });
    assert.ok(predecessor.revokedAt !== null);
    assert.equal(predecessor.replacedById, winner.sessionId);

    const activeCount = await prisma.authSession.count({
      where: { userId: user.userId, revokedAt: null },
    });
    assert.equal(activeCount, 1);

    const totalCount = await prisma.authSession.count({
      where: { userId: user.userId },
    });
    assert.equal(totalCount, 2);

    const successor = await prisma.authSession.findUniqueOrThrow({
      where: { id: winner.sessionId },
    });
    assert.equal(successor.revokedAt, null);
  });
});
