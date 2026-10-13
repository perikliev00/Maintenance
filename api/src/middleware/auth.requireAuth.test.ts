import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { PrismaClient, Role } from "@prisma/client";
import dotenv from "dotenv";
import {
  cleanupEmployeeGraph,
  createEmployeeWithUser,
  type EmployeeUserFixture,
} from "../../tests/fixtures";
import { signAccessToken, type AuthUser } from "../auth/tokens";
import {
  createSession,
  revokeSession,
} from "../services/authSessions";
import { requireAuth } from "./auth";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-secret-for-auth-gate";

const prisma = new PrismaClient();
const AUDIT_MARKER_PREFIX = "t-auth-gate-probe";

function isUnauthorized(
  status: number,
  body: { error?: string; message?: string },
  message?: string,
) {
  assert.equal(status, 401);
  assert.equal(body.error, "unauthorized");
  if (message) assert.equal(body.message, message);
}

describe("requireAuth gate", () => {
  const fixtureIds: string[] = [];
  const auditActions: string[] = [];
  let handlerRan = false;
  let pendingMarker = "";
  let server: http.Server;
  let baseUrl = "";
  let userA: EmployeeUserFixture;
  let userB: EmployeeUserFixture;

  before(async () => {
    const stamp = Date.now();
    userA = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-RA-A-${stamp}`,
      email: `t-ra-a-${stamp}@test.local`,
      role: Role.housekeeper,
      fullName: "T RequireAuth A",
    });
    userB = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-RA-B-${stamp}`,
      email: `t-ra-b-${stamp}@test.local`,
      role: Role.technician,
      fullName: "T RequireAuth B",
    });
    fixtureIds.push(userA.employeeId, userB.employeeId);

    const app = express();
    app.get("/probe", requireAuth, (req, res) => {
      handlerRan = true;
      res.json({ ok: true, userId: req.user!.userId });
    });
    app.post("/probe-mutate", requireAuth, async (req, res, next) => {
      handlerRan = true;
      try {
        const marker = pendingMarker;
        auditActions.push(marker);
        await prisma.auditEvent.create({
          data: {
            action: marker,
            entityType: "AuthGateProbe",
            entityId: `probe-${marker}`,
            actorEmployeeId: req.user!.employeeId,
          },
        });
        res.json({ ok: true, marker });
      } catch (err) {
        next(err);
      }
    });

    server = http.createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    if (auditActions.length) {
      await prisma.auditEvent.deleteMany({
        where: { action: { in: auditActions } },
      });
    }
    await prisma.auditEvent.deleteMany({
      where: { action: { startsWith: AUDIT_MARKER_PREFIX } },
    });
    await cleanupEmployeeGraph(prisma, fixtureIds);
    await prisma.$disconnect();
  });

  async function getProbe(headers?: HeadersInit) {
    handlerRan = false;
    const res = await fetch(`${baseUrl}/probe`, { headers });
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      ok?: boolean;
      userId?: string;
    };
    return { status: res.status, body, handlerRan };
  }

  async function postProbeMutate(headers?: HeadersInit) {
    handlerRan = false;
    const res = await fetch(`${baseUrl}/probe-mutate`, {
      method: "POST",
      headers,
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      ok?: boolean;
      marker?: string;
    };
    return { status: res.status, body, handlerRan };
  }

  function authUserFrom(
    fixture: EmployeeUserFixture,
    sid: string,
  ): AuthUser {
    return {
      userId: fixture.userId,
      employeeId: fixture.employeeId,
      role: fixture.role,
      email: fixture.email,
      sid,
    };
  }

  it("rejects missing token without running handler", async () => {
    const result = await getProbe();
    isUnauthorized(result.status, result.body, "Missing token");
    assert.equal(result.handlerRan, false);
  });

  it("rejects malformed token without running handler", async () => {
    const result = await getProbe({
      Authorization: "Bearer not-a-jwt",
    });
    isUnauthorized(result.status, result.body, "Invalid token");
    assert.equal(result.handlerRan, false);
  });

  it("rejects expired access JWT without running handler", async () => {
    const tokens = await createSession({ userId: userA.userId });
    const sessionBefore = await prisma.authSession.findUniqueOrThrow({
      where: { id: tokens.sessionId },
    });

    const expired = jwt.sign(
      authUserFrom(userA, tokens.sessionId),
      process.env.JWT_SECRET!,
      { expiresIn: -1 },
    );

    const result = await getProbe({
      Authorization: `Bearer ${expired}`,
    });
    isUnauthorized(result.status, result.body, "Invalid token");
    assert.equal(result.handlerRan, false);

    const sessionAfter = await prisma.authSession.findUniqueOrThrow({
      where: { id: tokens.sessionId },
    });
    assert.equal(
      sessionAfter.revokedAt?.getTime() ?? null,
      sessionBefore.revokedAt?.getTime() ?? null,
    );
    assert.equal(
      sessionAfter.expiresAt.getTime(),
      sessionBefore.expiresAt.getTime(),
    );
  });

  it("rejects valid JWT when AuthSession.expiresAt is past without running handler", async () => {
    const tokens = await createSession({ userId: userA.userId });
    await prisma.authSession.update({
      where: { id: tokens.sessionId },
      data: { expiresAt: new Date(Date.now() - 60_000), revokedAt: null },
    });
    // Fresh, non-expired access JWT so failure must come from assertSessionActive.
    const access = signAccessToken(authUserFrom(userA, tokens.sessionId));

    const result = await getProbe({
      Authorization: `Bearer ${access}`,
    });
    isUnauthorized(result.status, result.body, "Invalid token");
    assert.equal(result.handlerRan, false);
  });

  it("rejects revoked session and does not write audit side effect", async () => {
    const marker = `${AUDIT_MARKER_PREFIX}-revoked-${Date.now()}`;
    pendingMarker = marker;
    auditActions.push(marker);

    const tokens = await createSession({ userId: userA.userId });
    await revokeSession(tokens.sessionId);
    const access = signAccessToken(authUserFrom(userA, tokens.sessionId));

    const result = await postProbeMutate({
      Authorization: `Bearer ${access}`,
    });
    isUnauthorized(result.status, result.body, "Invalid token");
    assert.equal(result.handlerRan, false);
    assert.equal(
      await prisma.auditEvent.count({ where: { action: marker } }),
      0,
    );
  });

  it("rejects JWT userId/session owner mismatch without running handler", async () => {
    const tokensB = await createSession({ userId: userB.userId });
    const mismatched = signAccessToken({
      userId: userA.userId,
      employeeId: userA.employeeId,
      role: userA.role,
      email: userA.email,
      sid: tokensB.sessionId,
    });

    const result = await getProbe({
      Authorization: `Bearer ${mismatched}`,
    });
    isUnauthorized(result.status, result.body, "Invalid token");
    assert.equal(result.handlerRan, false);
  });

  it("allows valid token and runs handler (positive control)", async () => {
    const tokens = await createSession({ userId: userA.userId });
    const result = await getProbe({
      Authorization: `Bearer ${tokens.accessToken}`,
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.userId, userA.userId);
    assert.equal(result.handlerRan, true);
  });

  // AUTH-T-P004-01: blocked-after-login cannot perform actions
  it("rejects inactive user and does not write audit side effect", async () => {
    const marker = `${AUDIT_MARKER_PREFIX}-inactive-${Date.now()}`;
    pendingMarker = marker;
    auditActions.push(marker);

    const tokens = await createSession({ userId: userA.userId });
    await prisma.user.update({
      where: { id: userA.userId },
      data: { isActive: false },
    });
    try {
      const result = await postProbeMutate({
        Authorization: `Bearer ${tokens.accessToken}`,
      });
      isUnauthorized(result.status, result.body, "Invalid token");
      assert.equal(result.handlerRan, false);
      assert.equal(
        await prisma.auditEvent.count({ where: { action: marker } }),
        0,
      );
    } finally {
      await prisma.user.update({
        where: { id: userA.userId },
        data: { isActive: true },
      });
    }
  });
});
