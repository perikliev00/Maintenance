// Strict assertions for requireAuth gate behavior.
import assert from "node:assert/strict";
// Ephemeral HTTP server hosting Express probe routes.
import http from "node:http";
// Resolve api/.env for JWT_SECRET / DATABASE_URL.
import path from "node:path";
// Node test lifecycle hooks and suite helpers.
import { after, before, describe, it } from "node:test";
// Minimal Express app for middleware integration tests.
import express from "express";
// Craft expired JWTs that still carry a valid claim shape.
import jwt from "jsonwebtoken";
// Prisma client + Role for fixture users and audit probes.
import { PrismaClient, Role } from "@prisma/client";
// Load environment overrides from api/.env.
import dotenv from "dotenv";
// Shared employee+user fixture helpers.
import {
  cleanupEmployeeGraph,
  createEmployeeWithUser,
  type EmployeeUserFixture,
} from "../../tests/fixtures";
// Sign fresh access tokens bound to a session id.
import { signAccessToken, type AuthUser } from "../auth/tokens";
// Create/revoke AuthSession rows used by requireAuth.
import {
  createSession,
  revokeSession,
} from "../services/authSessions";
// Middleware under test.
import { requireAuth } from "./auth";

// Prefer api/.env so JWT_SECRET matches the running database suite.
dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});
// Fallback secret when .env is missing locally.
process.env.JWT_SECRET =
  // Read or override process environment for this test/runtime.
  process.env.JWT_SECRET || "test-secret-for-auth-gate";

// Dedicated Prisma client for fixtures and side-effect checks.
const prisma = new PrismaClient();
// Prefix for audit markers written by the mutate probe.
const AUDIT_MARKER_PREFIX = "t-auth-gate-probe";

// Shared 401 unauthorized body/status assertions.
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
  // Employee ids created in before() for graph cleanup.
  const fixtureIds: string[] = [];
  // Audit action markers to delete after the suite.
  const auditActions: string[] = [];
  // True only if a protected handler body executed.
  let handlerRan = false;
  // Marker the mutate probe will persist when auth succeeds.
  let pendingMarker = "";
  let server: http.Server;
  let baseUrl = "";
  let userA: EmployeeUserFixture;
  let userB: EmployeeUserFixture;

  // Register test lifecycle hook for setup or teardown.
  before(async () => {
    const stamp = Date.now();
    // Two users so mismatch cases can cross userId and session owner.
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
    // GET probe: proves handlerRan and echoes authenticated userId.
    app.get("/probe", requireAuth, (req, res) => {
      handlerRan = true;
      res.json({ ok: true, userId: req.user!.userId });
    });
    // POST probe: writes an audit row only if requireAuth allowed the request.
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

  // Register test lifecycle hook for setup or teardown.
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

  // GET /probe helper resetting handlerRan each call.
  async function getProbe(headers?: HeadersInit) {
    handlerRan = false;
    // Capture remote/API result needed by this flow.
    const res = await fetch(`${baseUrl}/probe`, { headers });
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      ok?: boolean;
      userId?: string;
    };
    return { status: res.status, body, handlerRan };
  }

  // POST /probe-mutate helper resetting handlerRan each call.
  async function postProbeMutate(headers?: HeadersInit) {
    handlerRan = false;
    // Capture remote/API result needed by this flow.
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

  // Build AuthUser claims for a fixture bound to a session id.
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

  // Missing Authorization/cookie must 401 before the handler runs.
  it("rejects missing token without running handler", async () => {
    const result = await getProbe();
    isUnauthorized(result.status, result.body, "Missing token");
    assert.equal(result.handlerRan, false);
  });

  // Non-JWT garbage must 401 as Invalid token.
  it("rejects malformed token without running handler", async () => {
    const result = await getProbe({
      Authorization: "Bearer not-a-jwt",
    });
    isUnauthorized(result.status, result.body, "Invalid token");
    assert.equal(result.handlerRan, false);
  });

  // Expired JWT must fail without mutating the underlying AuthSession.
  it("rejects expired access JWT without running handler", async () => {
    const tokens = await createSession({ userId: userA.userId });
    const sessionBefore = await prisma.authSession.findUniqueOrThrow({
      where: { id: tokens.sessionId },
    });

    // Negative expiresIn yields an already-expired token.
    const expired = jwt.sign(
      authUserFrom(userA, tokens.sessionId),
      // Read or override process environment for this test/runtime.
      process.env.JWT_SECRET!,
      { expiresIn: -1 },
    );

    const result = await getProbe({
      Authorization: `Bearer ${expired}`,
    });
    isUnauthorized(result.status, result.body, "Invalid token");
    assert.equal(result.handlerRan, false);

    // Ensure verify failure did not revoke or alter the session row.
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

  // JWT may be fresh while AuthSession.expiresAt is past — still 401.
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

  // Revoked sessions must not reach domain side effects.
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
      // Expected numeric assertion argument for this check.
      0,
    );
  });

  // userId claim must match the AuthSession owner (sid).
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

  // Positive control: valid session token reaches the handler.
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
        // Expected numeric assertion argument for this check.
        0,
      );
    } finally {
      // Restore active so later suites/fixtures remain usable.
      await prisma.user.update({
        where: { id: userA.userId },
        data: { isActive: true },
      });
    }
  });
});
