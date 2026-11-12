// Strict assert helpers for precise test failures.
import assert from "node:assert/strict";
// Runtime import from crypto.
import { randomBytes } from "crypto";
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
  REFRESH_TOKEN_TTL_MS,
  assertSessionActive,
  hashRefreshToken,
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

// Internal async helper createAuthSessionRow.
async function createAuthSessionRow(input: {
  // Param userId required by this function.
  userId: string;
  // Param expiresAt required by this function.
  expiresAt?: Date;
  // Param revokedAt required by this function.
  revokedAt?: Date | null;
// Support the surrounding control flow.
}) {
  // Return computed result.
  return prisma.authSession.create({
    // Mutation data payload.
    data: {
      // Param userId required by this function.
      userId: input.userId,
      // Param refreshTokenHash required by this function.
      refreshTokenHash: hashRefreshToken(randomBytes(32).toString("base64url")),
      // Param expiresAt required by this function.
      expiresAt:
        // Support the surrounding control flow.
        input.expiresAt ?? new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      // Param revokedAt required by this function.
      revokedAt: input.revokedAt ?? null,
      // Param lastUsedAt required by this function.
      lastUsedAt: new Date(),
    },
  });
}

// Test suite: assertSessionActive.
describe("assertSessionActive", () => {
  // Accumulator list fixtureIds.
  const fixtureIds: string[] = [];

  // Tear down after cases.
  after(async () => {
    // Await side effect before continuing.
    await cleanupEmployeeGraph(prisma, fixtureIds);
    // Prisma side effect for this step.
    await prisma.$disconnect();
  });

  // Test case: rejects missing session, user mismatch, revoked, expired, inactive; allows valid.
  it("rejects missing session, user mismatch, revoked, expired, inactive; allows valid", async () => {
    // Local stamp used below.
    const stamp = Date.now();
    // Await userA before dependent work.
    const userA = await createEmployeeWithUser(prisma, {
      // Param employeeNumber required by this function.
      employeeNumber: `T-AUTH-A-${stamp}`,
      // Param email required by this function.
      email: `t-auth-a-${stamp}@test.local`,
      // Param role required by this function.
      role: Role.housekeeper,
      // Param fullName required by this function.
      fullName: "T Auth A",
    });
    // Await userB before dependent work.
    const userB = await createEmployeeWithUser(prisma, {
      // Param employeeNumber required by this function.
      employeeNumber: `T-AUTH-B-${stamp}`,
      // Param email required by this function.
      email: `t-auth-b-${stamp}@test.local`,
      // Param role required by this function.
      role: Role.technician,
      // Param fullName required by this function.
      fullName: "T Auth B",
    });
    // Support the surrounding control flow.
    fixtureIds.push(userA.employeeId, userB.employeeId);

    // Await side effect before continuing.
    await assert.rejects(
      // Support the surrounding control flow.
      () => assertSessionActive("missing-session-id", userA.userId),
      // Support the surrounding control flow.
      (err: unknown) => isAppError401(err, "Invalid session"),
    );

    // Await sessionB before dependent work.
    const sessionB = await createAuthSessionRow({ userId: userB.userId });
    // Await side effect before continuing.
    await assert.rejects(
      // Support the surrounding control flow.
      () => assertSessionActive(sessionB.id, userA.userId),
      // Support the surrounding control flow.
      (err: unknown) => isAppError401(err, "Invalid session"),
    );
    // Fetch stillActive by unique/first match.
    const stillActive = await prisma.authSession.findUniqueOrThrow({
      // Filter matching rows.
      where: { id: sessionB.id },
    });
    // Compare scalar values.
    assert.equal(stillActive.revokedAt, null);

    // Await revoked before dependent work.
    const revoked = await createAuthSessionRow({
      // Param userId required by this function.
      userId: userA.userId,
      // Param revokedAt required by this function.
      revokedAt: new Date(),
    });
    // Await side effect before continuing.
    await assert.rejects(
      // Support the surrounding control flow.
      () => assertSessionActive(revoked.id, userA.userId),
      // Support the surrounding control flow.
      (err: unknown) => isAppError401(err, "Session revoked"),
    );

    // Await expired before dependent work.
    const expired = await createAuthSessionRow({
      // Param userId required by this function.
      userId: userA.userId,
      // Param expiresAt required by this function.
      expiresAt: new Date(Date.now() - 60_000),
    });
    // Await side effect before continuing.
    await assert.rejects(
      // Support the surrounding control flow.
      () => assertSessionActive(expired.id, userA.userId),
      // Support the surrounding control flow.
      (err: unknown) => isAppError401(err, "Session expired"),
    );

    // Await forInactive before dependent work.
    const forInactive = await createAuthSessionRow({ userId: userA.userId });
    // Persist field updates.
    await prisma.user.update({
      // Filter matching rows.
      where: { id: userA.userId },
      // Mutation data payload.
      data: { isActive: false },
    });
    // Catch locally so callers get mapped errors.
    try {
      // Await side effect before continuing.
      await assert.rejects(
        // Support the surrounding control flow.
        () => assertSessionActive(forInactive.id, userA.userId),
        // Support the surrounding control flow.
        (err: unknown) => isAppError401(err, "User inactive"),
      );
    // Support the surrounding control flow.
    } finally {
      // Persist field updates.
      await prisma.user.update({
        // Filter matching rows.
        where: { id: userA.userId },
        // Mutation data payload.
        data: { isActive: true },
      });
    }

    // Await valid before dependent work.
    const valid = await createAuthSessionRow({ userId: userA.userId });
    // Await session before dependent work.
    const session = await assertSessionActive(valid.id, userA.userId);
    // Compare scalar values.
    assert.equal(session.user.id, userA.userId);
    // Compare scalar values.
    assert.equal(session.id, valid.id);
  });
});
