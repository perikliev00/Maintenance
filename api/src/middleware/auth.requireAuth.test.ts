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
  // List item in import/export/params.
  cleanupEmployeeGraph,
  // List item in import/export/params.
  createEmployeeWithUser,
  // Declare type alias EmployeeUserFixture.
  type EmployeeUserFixture,
// Support the surrounding logic for this step.
} from "../../tests/fixtures";
// Sign fresh access tokens bound to a session id.
import { signAccessToken, type AuthUser } from "../auth/tokens";
// Create/revoke AuthSession rows used by requireAuth.
import {
  // List item in import/export/params.
  createSession,
  // List item in import/export/params.
  revokeSession,
// Support the surrounding logic for this step.
} from "../services/authSessions";
// Middleware under test.
import { requireAuth } from "./auth";

// Prefer api/.env so JWT_SECRET matches the running database suite.
dotenv.config({
  // Provide path field used by this structure.
  path: path.resolve(__dirname, "../../.env"),
  // Provide override field used by this structure.
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
  // Provide status field used by this structure.
  status: number,
  // Provide body field used by this structure.
  body: { error?: string; message?: string },
  // Support the surrounding logic for this step.
  message?: string,
// Support the surrounding logic for this step.
) {
  // Assert expected behavior in this test case.
  assert.equal(status, 401);
  // Assert expected behavior in this test case.
  assert.equal(body.error, "unauthorized");
  // Conditional branch for the case described by this guard.
  if (message) assert.equal(body.message, message);
}

// Group related tests under a shared suite name.
describe("requireAuth gate", () => {
  // Employee ids created in before() for graph cleanup.
  const fixtureIds: string[] = [];
  // Audit action markers to delete after the suite.
  const auditActions: string[] = [];
  // True only if a protected handler body executed.
  let handlerRan = false;
  // Marker the mutate probe will persist when auth succeeds.
  let pendingMarker = "";
  // Bind server for use in the following logic.
  let server: http.Server;
  // Bind baseUrl for use in the following logic.
  let baseUrl = "";
  // Bind userA for use in the following logic.
  let userA: EmployeeUserFixture;
  // Bind userB for use in the following logic.
  let userB: EmployeeUserFixture;

  // Register test lifecycle hook for setup or teardown.
  before(async () => {
    // Bind stamp for use in the following logic.
    const stamp = Date.now();
    // Two users so mismatch cases can cross userId and session owner.
    userA = await createEmployeeWithUser(prisma, {
      // Provide employeeNumber field used by this structure.
      employeeNumber: `T-RA-A-${stamp}`,
      // Provide email field used by this structure.
      email: `t-ra-a-${stamp}@test.local`,
      // Provide role field used by this structure.
      role: Role.housekeeper,
      // Provide fullName field used by this structure.
      fullName: "T RequireAuth A",
    });
    // Support the surrounding logic for this step.
    userB = await createEmployeeWithUser(prisma, {
      // Provide employeeNumber field used by this structure.
      employeeNumber: `T-RA-B-${stamp}`,
      // Provide email field used by this structure.
      email: `t-ra-b-${stamp}@test.local`,
      // Provide role field used by this structure.
      role: Role.technician,
      // Provide fullName field used by this structure.
      fullName: "T RequireAuth B",
    });
    // Invoke fixtureIds.push to perform this step.
    fixtureIds.push(userA.employeeId, userB.employeeId);

    // Bind app for use in the following logic.
    const app = express();
    // GET probe: proves handlerRan and echoes authenticated userId.
    app.get("/probe", requireAuth, (req, res) => {
      // Support the surrounding logic for this step.
      handlerRan = true;
      // Invoke res.json to perform this step.
      res.json({ ok: true, userId: req.user!.userId });
    });
    // POST probe: writes an audit row only if requireAuth allowed the request.
    app.post("/probe-mutate", requireAuth, async (req, res, next) => {
      // Support the surrounding logic for this step.
      handlerRan = true;
      // Begin guarded block to catch runtime failures.
      try {
        // Bind marker for use in the following logic.
        const marker = pendingMarker;
        // Invoke auditActions.push to perform this step.
        auditActions.push(marker);
        // Wait for an async operation before continuing.
        await prisma.auditEvent.create({
          // Provide data field used by this structure.
          data: {
            // Provide action field used by this structure.
            action: marker,
            // Provide entityType field used by this structure.
            entityType: "AuthGateProbe",
            // Provide entityId field used by this structure.
            entityId: `probe-${marker}`,
            // Provide actorEmployeeId field used by this structure.
            actorEmployeeId: req.user!.employeeId,
          },
        });
        // Invoke res.json to perform this step.
        res.json({ ok: true, marker });
      // Support the surrounding logic for this step.
      } catch (err) {
        // Invoke next to perform this step.
        next(err);
      }
    });

    // Support the surrounding logic for this step.
    server = http.createServer(app);
    // Wait for an async operation before continuing.
    await new Promise<void>((resolve, reject) => {
      // Invoke server.once to perform this step.
      server.once("error", reject);
      // Invoke server.listen to perform this step.
      server.listen(0, "127.0.0.1", () => resolve());
    });
    // Bind addr for use in the following logic.
    const addr = server.address();
    // Assert expected behavior in this test case.
    assert.ok(addr && typeof addr === "object");
    // Pass baseUrl prop/value into the element or config.
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  // Register test lifecycle hook for setup or teardown.
  after(async () => {
    // Wait for an async operation before continuing.
    await new Promise<void>((resolve, reject) => {
      // Invoke server.close to perform this step.
      server.close((err) => (err ? reject(err) : resolve()));
    });
    // Conditional branch for the case described by this guard.
    if (auditActions.length) {
      // Wait for an async operation before continuing.
      await prisma.auditEvent.deleteMany({
        // Provide where field used by this structure.
        where: { action: { in: auditActions } },
      });
    }
    // Wait for an async operation before continuing.
    await prisma.auditEvent.deleteMany({
      // Provide where field used by this structure.
      where: { action: { startsWith: AUDIT_MARKER_PREFIX } },
    });
    // Wait for an async operation before continuing.
    await cleanupEmployeeGraph(prisma, fixtureIds);
    // Wait for an async operation before continuing.
    await prisma.$disconnect();
  });

  // GET /probe helper resetting handlerRan each call.
  async function getProbe(headers?: HeadersInit) {
    // Support the surrounding logic for this step.
    handlerRan = false;
    // Capture remote/API result needed by this flow.
    const res = await fetch(`${baseUrl}/probe`, { headers });
    // Bind body for use in the following logic.
    const body = (await res.json().catch(() => ({}))) as {
      // Support the surrounding logic for this step.
      error?: string;
      // Support the surrounding logic for this step.
      message?: string;
      // Support the surrounding logic for this step.
      ok?: boolean;
      // Support the surrounding logic for this step.
      userId?: string;
    };
    // Return early result or rendered output from this path.
    return { status: res.status, body, handlerRan };
  }

  // POST /probe-mutate helper resetting handlerRan each call.
  async function postProbeMutate(headers?: HeadersInit) {
    // Support the surrounding logic for this step.
    handlerRan = false;
    // Capture remote/API result needed by this flow.
    const res = await fetch(`${baseUrl}/probe-mutate`, {
      // Provide method field used by this structure.
      method: "POST",
      // List item in import/export/params.
      headers,
    });
    // Bind body for use in the following logic.
    const body = (await res.json().catch(() => ({}))) as {
      // Support the surrounding logic for this step.
      error?: string;
      // Support the surrounding logic for this step.
      message?: string;
      // Support the surrounding logic for this step.
      ok?: boolean;
      // Support the surrounding logic for this step.
      marker?: string;
    };
    // Return early result or rendered output from this path.
    return { status: res.status, body, handlerRan };
  }

  // Build AuthUser claims for a fixture bound to a session id.
  function authUserFrom(
    // Provide fixture field used by this structure.
    fixture: EmployeeUserFixture,
    // Provide sid field used by this structure.
    sid: string,
  // Support the surrounding logic for this step.
  ): AuthUser {
    // Return early result or rendered output from this path.
    return {
      // Provide userId field used by this structure.
      userId: fixture.userId,
      // Provide employeeId field used by this structure.
      employeeId: fixture.employeeId,
      // Provide role field used by this structure.
      role: fixture.role,
      // Provide email field used by this structure.
      email: fixture.email,
      // List item in import/export/params.
      sid,
    };
  }

  // Missing Authorization/cookie must 401 before the handler runs.
  it("rejects missing token without running handler", async () => {
    // Bind result for use in the following logic.
    const result = await getProbe();
    // Invoke isUnauthorized to perform this step.
    isUnauthorized(result.status, result.body, "Missing token");
    // Assert expected behavior in this test case.
    assert.equal(result.handlerRan, false);
  });

  // Non-JWT garbage must 401 as Invalid token.
  it("rejects malformed token without running handler", async () => {
    // Bind result for use in the following logic.
    const result = await getProbe({
      // Provide Authorization field used by this structure.
      Authorization: "Bearer not-a-jwt",
    });
    // Invoke isUnauthorized to perform this step.
    isUnauthorized(result.status, result.body, "Invalid token");
    // Assert expected behavior in this test case.
    assert.equal(result.handlerRan, false);
  });

  // Expired JWT must fail without mutating the underlying AuthSession.
  it("rejects expired access JWT without running handler", async () => {
    // Bind tokens for use in the following logic.
    const tokens = await createSession({ userId: userA.userId });
    // Bind sessionBefore for use in the following logic.
    const sessionBefore = await prisma.authSession.findUniqueOrThrow({
      // Provide where field used by this structure.
      where: { id: tokens.sessionId },
    });

    // Negative expiresIn yields an already-expired token.
    const expired = jwt.sign(
      // Invoke authUserFrom to perform this step.
      authUserFrom(userA, tokens.sessionId),
      // Read or override process environment for this test/runtime.
      process.env.JWT_SECRET!,
      // Support the surrounding logic for this step.
      { expiresIn: -1 },
    );

    // Bind result for use in the following logic.
    const result = await getProbe({
      // Provide Authorization field used by this structure.
      Authorization: `Bearer ${expired}`,
    });
    // Invoke isUnauthorized to perform this step.
    isUnauthorized(result.status, result.body, "Invalid token");
    // Assert expected behavior in this test case.
    assert.equal(result.handlerRan, false);

    // Ensure verify failure did not revoke or alter the session row.
    const sessionAfter = await prisma.authSession.findUniqueOrThrow({
      // Provide where field used by this structure.
      where: { id: tokens.sessionId },
    });
    // Assert expected behavior in this test case.
    assert.equal(
      // Support the surrounding logic for this step.
      sessionAfter.revokedAt?.getTime() ?? null,
      // Support the surrounding logic for this step.
      sessionBefore.revokedAt?.getTime() ?? null,
    );
    // Assert expected behavior in this test case.
    assert.equal(
      // Invoke sessionAfter.expiresAt.getTime to perform this step.
      sessionAfter.expiresAt.getTime(),
      // Invoke sessionBefore.expiresAt.getTime to perform this step.
      sessionBefore.expiresAt.getTime(),
    );
  });

  // JWT may be fresh while AuthSession.expiresAt is past — still 401.
  it("rejects valid JWT when AuthSession.expiresAt is past without running handler", async () => {
    // Bind tokens for use in the following logic.
    const tokens = await createSession({ userId: userA.userId });
    // Wait for an async operation before continuing.
    await prisma.authSession.update({
      // Provide where field used by this structure.
      where: { id: tokens.sessionId },
      // Provide data field used by this structure.
      data: { expiresAt: new Date(Date.now() - 60_000), revokedAt: null },
    });
    // Fresh, non-expired access JWT so failure must come from assertSessionActive.
    const access = signAccessToken(authUserFrom(userA, tokens.sessionId));

    // Bind result for use in the following logic.
    const result = await getProbe({
      // Provide Authorization field used by this structure.
      Authorization: `Bearer ${access}`,
    });
    // Invoke isUnauthorized to perform this step.
    isUnauthorized(result.status, result.body, "Invalid token");
    // Assert expected behavior in this test case.
    assert.equal(result.handlerRan, false);
  });

  // Revoked sessions must not reach domain side effects.
  it("rejects revoked session and does not write audit side effect", async () => {
    // Bind marker for use in the following logic.
    const marker = `${AUDIT_MARKER_PREFIX}-revoked-${Date.now()}`;
    // Support the surrounding logic for this step.
    pendingMarker = marker;
    // Invoke auditActions.push to perform this step.
    auditActions.push(marker);

    // Bind tokens for use in the following logic.
    const tokens = await createSession({ userId: userA.userId });
    // Wait for an async operation before continuing.
    await revokeSession(tokens.sessionId);
    // Bind access for use in the following logic.
    const access = signAccessToken(authUserFrom(userA, tokens.sessionId));

    // Bind result for use in the following logic.
    const result = await postProbeMutate({
      // Provide Authorization field used by this structure.
      Authorization: `Bearer ${access}`,
    });
    // Invoke isUnauthorized to perform this step.
    isUnauthorized(result.status, result.body, "Invalid token");
    // Assert expected behavior in this test case.
    assert.equal(result.handlerRan, false);
    // Assert expected behavior in this test case.
    assert.equal(
      // Wait for an async operation before continuing.
      await prisma.auditEvent.count({ where: { action: marker } }),
      // Expected numeric assertion argument for this check.
      0,
    );
  });

  // userId claim must match the AuthSession owner (sid).
  it("rejects JWT userId/session owner mismatch without running handler", async () => {
    // Bind tokensB for use in the following logic.
    const tokensB = await createSession({ userId: userB.userId });
    // Bind mismatched for use in the following logic.
    const mismatched = signAccessToken({
      // Provide userId field used by this structure.
      userId: userA.userId,
      // Provide employeeId field used by this structure.
      employeeId: userA.employeeId,
      // Provide role field used by this structure.
      role: userA.role,
      // Provide email field used by this structure.
      email: userA.email,
      // Provide sid field used by this structure.
      sid: tokensB.sessionId,
    });

    // Bind result for use in the following logic.
    const result = await getProbe({
      // Provide Authorization field used by this structure.
      Authorization: `Bearer ${mismatched}`,
    });
    // Invoke isUnauthorized to perform this step.
    isUnauthorized(result.status, result.body, "Invalid token");
    // Assert expected behavior in this test case.
    assert.equal(result.handlerRan, false);
  });

  // Positive control: valid session token reaches the handler.
  it("allows valid token and runs handler (positive control)", async () => {
    // Bind tokens for use in the following logic.
    const tokens = await createSession({ userId: userA.userId });
    // Bind result for use in the following logic.
    const result = await getProbe({
      // Provide Authorization field used by this structure.
      Authorization: `Bearer ${tokens.accessToken}`,
    });
    // Assert expected behavior in this test case.
    assert.equal(result.status, 200);
    // Assert expected behavior in this test case.
    assert.equal(result.body.ok, true);
    // Assert expected behavior in this test case.
    assert.equal(result.body.userId, userA.userId);
    // Assert expected behavior in this test case.
    assert.equal(result.handlerRan, true);
  });

  // AUTH-T-P004-01: blocked-after-login cannot perform actions
  it("rejects inactive user and does not write audit side effect", async () => {
    // Bind marker for use in the following logic.
    const marker = `${AUDIT_MARKER_PREFIX}-inactive-${Date.now()}`;
    // Support the surrounding logic for this step.
    pendingMarker = marker;
    // Invoke auditActions.push to perform this step.
    auditActions.push(marker);

    // Bind tokens for use in the following logic.
    const tokens = await createSession({ userId: userA.userId });
    // Wait for an async operation before continuing.
    await prisma.user.update({
      // Provide where field used by this structure.
      where: { id: userA.userId },
      // Provide data field used by this structure.
      data: { isActive: false },
    });
    // Begin guarded block to catch runtime failures.
    try {
      // Bind result for use in the following logic.
      const result = await postProbeMutate({
        // Provide Authorization field used by this structure.
        Authorization: `Bearer ${tokens.accessToken}`,
      });
      // Invoke isUnauthorized to perform this step.
      isUnauthorized(result.status, result.body, "Invalid token");
      // Assert expected behavior in this test case.
      assert.equal(result.handlerRan, false);
      // Assert expected behavior in this test case.
      assert.equal(
        // Wait for an async operation before continuing.
        await prisma.auditEvent.count({ where: { action: marker } }),
        // Expected numeric assertion argument for this check.
        0,
      );
    // Support the surrounding logic for this step.
    } finally {
      // Restore active so later suites/fixtures remain usable.
      await prisma.user.update({
        // Provide where field used by this structure.
        where: { id: userA.userId },
        // Provide data field used by this structure.
        data: { isActive: true },
      });
    }
  });
});
