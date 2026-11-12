import assert from "node:assert/strict";
import { randomBytes } from "crypto";
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
  REFRESH_TOKEN_TTL_MS,
  assertSessionActive,
  hashRefreshToken,
} from "./authSessions";

dotenv.config({
  // Set path.
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});

const prisma = new PrismaClient();

function isAppError401(err: unknown, message: string): boolean {
  return (
    err instanceof AppError &&
    err.status === 401 &&
    err.code === "unauthorized" &&
    // Assign err.message.
    err.message === message
  );
}

async function createAuthSessionRow(input: {
  userId: string;
  expiresAt?: Date;
  revokedAt?: Date | null;
}) {
  return prisma.authSession.create({
    data: {
      userId: input.userId,
      refreshTokenHash: hashRefreshToken(randomBytes(32).toString("base64url")),
      expiresAt:
        input.expiresAt ?? new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      revokedAt: input.revokedAt ?? null,
      lastUsedAt: new Date(),
    },
  });
}

describe("assertSessionActive", () => {
  const fixtureIds: string[] = [];

  after(async () => {
    await cleanupEmployeeGraph(prisma, fixtureIds);
    await prisma.$disconnect();
  });

  it("rejects missing session, user mismatch, revoked, expired, inactive; allows valid", async () => {
    const stamp = Date.now();
    const userA = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-AUTH-A-${stamp}`,
      email: `t-auth-a-${stamp}@test.local`,
      role: Role.housekeeper,
      fullName: "T Auth A",
    });
    const userB = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-AUTH-B-${stamp}`,
      email: `t-auth-b-${stamp}@test.local`,
      role: Role.technician,
      fullName: "T Auth B",
    });
    fixtureIds.push(userA.employeeId, userB.employeeId);

    await assert.rejects(
      () => assertSessionActive("missing-session-id", userA.userId),
      (err: unknown) => isAppError401(err, "Invalid session"),
    );

    const sessionB = await createAuthSessionRow({ userId: userB.userId });
    await assert.rejects(
      () => assertSessionActive(sessionB.id, userA.userId),
      (err: unknown) => isAppError401(err, "Invalid session"),
    );
    const stillActive = await prisma.authSession.findUniqueOrThrow({
      where: { id: sessionB.id },
    });
    assert.equal(stillActive.revokedAt, null);

    const revoked = await createAuthSessionRow({
      userId: userA.userId,
      revokedAt: new Date(),
    });
    await assert.rejects(
      () => assertSessionActive(revoked.id, userA.userId),
      (err: unknown) => isAppError401(err, "Session revoked"),
    );

    const expired = await createAuthSessionRow({
      userId: userA.userId,
      expiresAt: new Date(Date.now() - 60_000),
    });
    await assert.rejects(
      () => assertSessionActive(expired.id, userA.userId),
      (err: unknown) => isAppError401(err, "Session expired"),
    );

    const forInactive = await createAuthSessionRow({ userId: userA.userId });
    await prisma.user.update({
      where: { id: userA.userId },
      data: { isActive: false },
    });
    try {
      await assert.rejects(
        () => assertSessionActive(forInactive.id, userA.userId),
        (err: unknown) => isAppError401(err, "User inactive"),
      );
    } finally {
      await prisma.user.update({
        where: { id: userA.userId },
        data: { isActive: true },
      });
    }

    const valid = await createAuthSessionRow({ userId: userA.userId });
    const session = await assertSessionActive(valid.id, userA.userId);
    assert.equal(session.user.id, userA.userId);
    assert.equal(session.id, valid.id);
  });
});
