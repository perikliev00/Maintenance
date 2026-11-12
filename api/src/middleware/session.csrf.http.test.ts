// Strict assertions for CSRF middleware over real HTTP + auth routes.
import assert from "node:assert/strict";
// Ephemeral HTTP server for integration-style CSRF tests.
import http from "node:http";
// Resolve api/.env for JWT_SECRET / DATABASE_URL.
import path from "node:path";
// Node test lifecycle hooks and suite helpers.
import { after, before, describe, it } from "node:test";
// Parse Cookie headers into req.cookies for requireCsrf.
import cookieParser from "cookie-parser";
// Express app hosting authRouter and a mutate probe.
import express from "express";
// Prisma client + Role for fixture users and audit checks.
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
// Typed errors mapped by the local terminal error handler.
import { AppError } from "../errors";
// Real /auth/refresh path exercised under CSRF rules.
import { authRouter } from "../routes/auth";
// Creates AuthSession rows used as cookie/Bearer material.
import { createSession } from "../services/authSessions";
// requireAuth on the mutate probe after CSRF middleware.
import { requireAuth } from "./auth";
// CSRF cookie/header names and the middleware under test.
import {
  // List item in import/export/params.
  CSRF_COOKIE,
  // List item in import/export/params.
  CSRF_HEADER,
  // List item in import/export/params.
  REFRESH_COOKIE,
  // List item in import/export/params.
  SESSION_COOKIE,
  // List item in import/export/params.
  requireCsrf,
// Support the surrounding logic for this step.
} from "./session";

// Prefer api/.env so secrets match the database suite.
dotenv.config({
  // Provide path field used by this structure.
  path: path.resolve(__dirname, "../../.env"),
  // Provide override field used by this structure.
  override: true,
});
// Fallback secret when .env is missing locally.
process.env.JWT_SECRET =
  // Read or override process environment for this test/runtime.
  process.env.JWT_SECRET || "test-secret-for-csrf-http";

// Dedicated Prisma client for fixtures and side-effect checks.
const prisma = new PrismaClient();
// Prefix for audit markers written by the mutate probe.
const AUDIT_MARKER_PREFIX = "t-csrf-http-probe";
// Literal non-breaking space used in Bearer bypass attempts.
const NBSP = "\u00A0";

// Build a Cookie header from a partial name→value map.
function cookieHeader(
  // Provide parts field used by this structure.
  parts: Partial<Record<string, string>>,
// Support the surrounding logic for this step.
): string {
  // Return early result or rendered output from this path.
  return Object.entries(parts)
    // Continue a chained call building on the previous expression.
    .filter(([, v]) => typeof v === "string" && v.length > 0)
    // Continue a chained call building on the previous expression.
    .map(([k, v]) => `${k}=${v}`)
    // Continue a chained call building on the previous expression.
    .join("; ");
}

// Group related tests under a shared suite name.
describe("CSRF HTTP integration", () => {
  // Employee ids created in before() for graph cleanup.
  const fixtureIds: string[] = [];
  // Audit action markers to delete after the suite.
  const auditActions: string[] = [];
  // True only if the protected mutate handler ran.
  let handlerRan = false;
  // Marker the mutate probe will persist when auth+CSRF succeed.
  let pendingMarker = "";
  // Bind server for use in the following logic.
  let server: http.Server;
  // Bind baseUrl for use in the following logic.
  let baseUrl = "";
  // Bind userA for use in the following logic.
  let userA: EmployeeUserFixture;

  // Register test lifecycle hook for setup or teardown.
  before(async () => {
    // Bind stamp for use in the following logic.
    const stamp = Date.now();
    // Support the surrounding logic for this step.
    userA = await createEmployeeWithUser(prisma, {
      // Provide employeeNumber field used by this structure.
      employeeNumber: `T-CSRF-A-${stamp}`,
      // Provide email field used by this structure.
      email: `t-csrf-a-${stamp}@test.local`,
      // Provide role field used by this structure.
      role: Role.housekeeper,
      // Provide fullName field used by this structure.
      fullName: "T Csrf Http A",
    });
    // Invoke fixtureIds.push to perform this step.
    fixtureIds.push(userA.employeeId);

    // Bind app for use in the following logic.
    const app = express();
    // Invoke app.use to perform this step.
    app.use(express.json());
    // Invoke app.use to perform this step.
    app.use(cookieParser());
    // CSRF runs before auth routes and the mutate probe.
    app.use(requireCsrf);
    // Invoke app.use to perform this step.
    app.use("/auth", authRouter);
    // Probe that writes audit only when CSRF + requireAuth both pass.
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
            entityType: "CsrfHttpProbe",
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
    // Minimal AppError-aware terminal handler for /auth failures.
    app.use(
      // Open argument / parameter list for the following entries.
      (
        // Provide err field used by this structure.
        err: unknown,
        // Provide _req field used by this structure.
        _req: express.Request,
        // Provide res field used by this structure.
        res: express.Response,
        // Provide _next field used by this structure.
        _next: express.NextFunction,
      // Support the surrounding logic for this step.
      ) => {
        // Conditional branch for the case described by this guard.
        if (err instanceof AppError) {
          // Return early result or rendered output from this path.
          return res.status(err.status).json({
            // Provide error field used by this structure.
            error: err.code,
            // Provide message field used by this structure.
            message: err.message,
          });
        }
        // Return early result or rendered output from this path.
        return res.status(500).json({ error: "internal" });
      },
    );

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

  // POST /probe-mutate with optional headers and a unique audit marker.
  async function postMutate(init?: {
    // Support the surrounding logic for this step.
    headers?: Record<string, string>;
    // Support the surrounding logic for this step.
    marker?: string;
  // Support the surrounding logic for this step.
  }) {
    // Support the surrounding logic for this step.
    handlerRan = false;
    // Bind marker for use in the following logic.
    const marker =
      // Support the surrounding logic for this step.
      init?.marker ?? `${AUDIT_MARKER_PREFIX}-${Date.now()}-${Math.random()}`;
    // Support the surrounding logic for this step.
    pendingMarker = marker;
    // Invoke auditActions.push to perform this step.
    auditActions.push(marker);
    // Capture remote/API result needed by this flow.
    const res = await fetch(`${baseUrl}/probe-mutate`, {
      // Provide method field used by this structure.
      method: "POST",
      // Provide headers field used by this structure.
      headers: {
        // Map key Content-Type to its bilingual / structured value.
        "Content-Type": "application/json",
        // Spread prior fields/items so overrides can layer cleanly.
        ...init?.headers,
      },
    });
    // Bind body for use in the following logic.
    const body = (await res.json().catch(() => ({}))) as {
      // Support the surrounding logic for this step.
      ok?: boolean;
      // Support the surrounding logic for this step.
      marker?: string;
      // Support the surrounding logic for this step.
      error?: string;
      // Support the surrounding logic for this step.
      message?: string;
    };
    // Return early result or rendered output from this path.
    return { status: res.status, body, handlerRan, marker };
  }

  // POST /auth/refresh with optional Cookie/Authorization headers.
  async function postRefresh(init?: {
    // Support the surrounding logic for this step.
    headers?: Record<string, string>;
    // Support the surrounding logic for this step.
    body?: Record<string, unknown>;
  // Support the surrounding logic for this step.
  }) {
    // Capture remote/API result needed by this flow.
    const res = await fetch(`${baseUrl}/auth/refresh`, {
      // Provide method field used by this structure.
      method: "POST",
      // Provide headers field used by this structure.
      headers: {
        // Map key Content-Type to its bilingual / structured value.
        "Content-Type": "application/json",
        // Spread prior fields/items so overrides can layer cleanly.
        ...init?.headers,
      },
      // Provide body field used by this structure.
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    // Bind body for use in the following logic.
    const body = (await res.json().catch(() => ({}))) as {
      // Support the surrounding logic for this step.
      ok?: boolean;
      // Support the surrounding logic for this step.
      expiresIn?: number;
      // Support the surrounding logic for this step.
      error?: string;
      // Support the surrounding logic for this step.
      message?: string;
    };
    // Return early result or rendered output from this path.
    return { status: res.status, body };
  }

  // Session cookie without CSRF header must not reach the handler/DB.
  it("session cookie + missing CSRF → 403; handler not run; no DB write", async () => {
    // Bind tokens for use in the following logic.
    const tokens = await createSession({ userId: userA.userId });
    // Bind csrf for use in the following logic.
    const csrf = "csrf-expected";
    // Bind result for use in the following logic.
    const result = await postMutate({
      // Provide headers field used by this structure.
      headers: {
        // Provide Cookie field used by this structure.
        Cookie: cookieHeader({
          // Support the surrounding logic for this step.
          [SESSION_COOKIE]: tokens.accessToken,
          // Support the surrounding logic for this step.
          [CSRF_COOKIE]: csrf,
        }),
      },
    });
    // Assert expected behavior in this test case.
    assert.equal(result.status, 403);
    // Assert expected behavior in this test case.
    assert.equal(result.body.error, "csrf");
    // Assert expected behavior in this test case.
    assert.equal(result.handlerRan, false);
    // Assert expected behavior in this test case.
    assert.equal(
      // Wait for an async operation before continuing.
      await prisma.auditEvent.count({ where: { action: result.marker } }),
      // Expected numeric assertion argument for this check.
      0,
    );
  });

  // Mismatched CSRF header must also 403 without side effects.
  it("session cookie + wrong CSRF → 403; handler not run; no DB write", async () => {
    // Bind tokens for use in the following logic.
    const tokens = await createSession({ userId: userA.userId });
    // Bind result for use in the following logic.
    const result = await postMutate({
      // Provide headers field used by this structure.
      headers: {
        // Provide Cookie field used by this structure.
        Cookie: cookieHeader({
          // Support the surrounding logic for this step.
          [SESSION_COOKIE]: tokens.accessToken,
          // Support the surrounding logic for this step.
          [CSRF_COOKIE]: "csrf-expected",
        }),
        // Support the surrounding logic for this step.
        [CSRF_HEADER]: "csrf-wrong",
      },
    });
    // Assert expected behavior in this test case.
    assert.equal(result.status, 403);
    // Assert expected behavior in this test case.
    assert.equal(result.body.error, "csrf");
    // Assert expected behavior in this test case.
    assert.equal(result.handlerRan, false);
    // Assert expected behavior in this test case.
    assert.equal(
      // Wait for an async operation before continuing.
      await prisma.auditEvent.count({ where: { action: result.marker } }),
      // Expected numeric assertion argument for this check.
      0,
    );
  });

  // Matching double-submit allows the protected mutate action.
  it("session cookie + correct CSRF → protected action succeeds", async () => {
    // Bind tokens for use in the following logic.
    const tokens = await createSession({ userId: userA.userId });
    // Bind csrf for use in the following logic.
    const csrf = "csrf-ok";
    // Bind result for use in the following logic.
    const result = await postMutate({
      // Provide headers field used by this structure.
      headers: {
        // Provide Cookie field used by this structure.
        Cookie: cookieHeader({
          // Support the surrounding logic for this step.
          [SESSION_COOKIE]: tokens.accessToken,
          // Support the surrounding logic for this step.
          [CSRF_COOKIE]: csrf,
        }),
        // Support the surrounding logic for this step.
        [CSRF_HEADER]: csrf,
      },
    });
    // Assert expected behavior in this test case.
    assert.equal(result.status, 200);
    // Assert expected behavior in this test case.
    assert.equal(result.body.ok, true);
    // Assert expected behavior in this test case.
    assert.equal(result.handlerRan, true);
    // Assert expected behavior in this test case.
    assert.equal(
      // Wait for an async operation before continuing.
      await prisma.auditEvent.count({ where: { action: result.marker } }),
      // Expected numeric assertion argument for this check.
      1,
    );
  });

  // NBSP Bearer must not skip CSRF when a session cookie is present.
  it("session cookie + Bearer U+00A0 + missing CSRF → 403; no DB write", async () => {
    // Bind tokens for use in the following logic.
    const tokens = await createSession({ userId: userA.userId });
    // Real U+00A0 character (not the escape text) after "Bearer "
    const authorization = `Bearer ${NBSP}`;
    // Assert expected behavior in this test case.
    assert.ok(authorization.includes(NBSP));
    // Assert expected behavior in this test case.
    assert.equal(authorization.charCodeAt("Bearer ".length), 0x00a0);

    // Bind result for use in the following logic.
    const result = await postMutate({
      // Provide headers field used by this structure.
      headers: {
        // Provide Authorization field used by this structure.
        Authorization: authorization,
        // Provide Cookie field used by this structure.
        Cookie: cookieHeader({
          // Support the surrounding logic for this step.
          [SESSION_COOKIE]: tokens.accessToken,
          // Support the surrounding logic for this step.
          [CSRF_COOKIE]: "csrf-expected",
        }),
      },
    });
    // Assert expected behavior in this test case.
    assert.equal(result.status, 403);
    // Assert expected behavior in this test case.
    assert.equal(result.body.error, "csrf");
    // Assert expected behavior in this test case.
    assert.equal(result.handlerRan, false);
    // Assert expected behavior in this test case.
    assert.equal(
      // Wait for an async operation before continuing.
      await prisma.auditEvent.count({ where: { action: result.marker } }),
      // Expected numeric assertion argument for this check.
      0,
    );
  });

  // Other whitespace-only Bearers likewise fail the usable-Bearer skip.
  it("session cookie + whitespace Bearer + wrong CSRF → 403; no DB write", async () => {
    // Bind tokens for use in the following logic.
    const tokens = await createSession({ userId: userA.userId });
    // Bind result for use in the following logic.
    const result = await postMutate({
      // Provide headers field used by this structure.
      headers: {
        // Provide Authorization field used by this structure.
        Authorization: "Bearer \t  ",
        // Provide Cookie field used by this structure.
        Cookie: cookieHeader({
          // Support the surrounding logic for this step.
          [SESSION_COOKIE]: tokens.accessToken,
          // Support the surrounding logic for this step.
          [CSRF_COOKIE]: "csrf-expected",
        }),
        // Support the surrounding logic for this step.
        [CSRF_HEADER]: "csrf-wrong",
      },
    });
    // Assert expected behavior in this test case.
    assert.equal(result.status, 403);
    // Assert expected behavior in this test case.
    assert.equal(result.body.error, "csrf");
    // Assert expected behavior in this test case.
    assert.equal(result.handlerRan, false);
    // Assert expected behavior in this test case.
    assert.equal(
      // Wait for an async operation before continuing.
      await prisma.auditEvent.count({ where: { action: result.marker } }),
      // Expected numeric assertion argument for this check.
      0,
    );
  });

  // /auth/refresh with refresh cookie requires CSRF; no rotation on 403.
  it("refresh cookie + missing CSRF → 403; no session rotation", async () => {
    // Bind tokens for use in the following logic.
    const tokens = await createSession({ userId: userA.userId });
    // Bind sessionsBefore for use in the following logic.
    const sessionsBefore = await prisma.authSession.count({
      // Provide where field used by this structure.
      where: { userId: userA.userId },
    });
    // Bind rowBefore for use in the following logic.
    const rowBefore = await prisma.authSession.findUniqueOrThrow({
      // Provide where field used by this structure.
      where: { id: tokens.sessionId },
    });
    // Assert expected behavior in this test case.
    assert.equal(rowBefore.revokedAt, null);
    // Assert expected behavior in this test case.
    assert.equal(rowBefore.replacedById, null);

    // Bind result for use in the following logic.
    const result = await postRefresh({
      // Provide headers field used by this structure.
      headers: {
        // Provide Cookie field used by this structure.
        Cookie: cookieHeader({
          // Support the surrounding logic for this step.
          [REFRESH_COOKIE]: tokens.refreshToken,
          // Support the surrounding logic for this step.
          [CSRF_COOKIE]: "csrf-expected",
        }),
      },
    });
    // Assert expected behavior in this test case.
    assert.equal(result.status, 403);
    // Assert expected behavior in this test case.
    assert.equal(result.body.error, "csrf");

    // Bind sessionsAfter for use in the following logic.
    const sessionsAfter = await prisma.authSession.count({
      // Provide where field used by this structure.
      where: { userId: userA.userId },
    });
    // Assert expected behavior in this test case.
    assert.equal(sessionsAfter, sessionsBefore);
    // Bind rowAfter for use in the following logic.
    const rowAfter = await prisma.authSession.findUniqueOrThrow({
      // Provide where field used by this structure.
      where: { id: tokens.sessionId },
    });
    // Assert expected behavior in this test case.
    assert.equal(rowAfter.revokedAt, null);
    // Assert expected behavior in this test case.
    assert.equal(rowAfter.replacedById, null);
  });

  // Wrong CSRF on refresh likewise must not rotate sessions.
  it("refresh cookie + wrong CSRF → 403; no session rotation", async () => {
    // Bind tokens for use in the following logic.
    const tokens = await createSession({ userId: userA.userId });
    // Bind sessionsBefore for use in the following logic.
    const sessionsBefore = await prisma.authSession.count({
      // Provide where field used by this structure.
      where: { userId: userA.userId },
    });

    // Bind result for use in the following logic.
    const result = await postRefresh({
      // Provide headers field used by this structure.
      headers: {
        // Provide Cookie field used by this structure.
        Cookie: cookieHeader({
          // Support the surrounding logic for this step.
          [REFRESH_COOKIE]: tokens.refreshToken,
          // Support the surrounding logic for this step.
          [CSRF_COOKIE]: "csrf-expected",
        }),
        // Support the surrounding logic for this step.
        [CSRF_HEADER]: "csrf-wrong",
      },
    });
    // Assert expected behavior in this test case.
    assert.equal(result.status, 403);
    // Assert expected behavior in this test case.
    assert.equal(result.body.error, "csrf");

    // Bind sessionsAfter for use in the following logic.
    const sessionsAfter = await prisma.authSession.count({
      // Provide where field used by this structure.
      where: { userId: userA.userId },
    });
    // Assert expected behavior in this test case.
    assert.equal(sessionsAfter, sessionsBefore);
    // Bind rowAfter for use in the following logic.
    const rowAfter = await prisma.authSession.findUniqueOrThrow({
      // Provide where field used by this structure.
      where: { id: tokens.sessionId },
    });
    // Assert expected behavior in this test case.
    assert.equal(rowAfter.revokedAt, null);
    // Assert expected behavior in this test case.
    assert.equal(rowAfter.replacedById, null);
  });

  // Usable Bearer cannot bypass CSRF when a refresh cookie is also present.
  it("Authorization + refresh cookie cannot bypass CSRF on /auth/refresh", async () => {
    // Bind tokens for use in the following logic.
    const tokens = await createSession({ userId: userA.userId });
    // Bind sessionsBefore for use in the following logic.
    const sessionsBefore = await prisma.authSession.count({
      // Provide where field used by this structure.
      where: { userId: userA.userId },
    });

    // Bind result for use in the following logic.
    const result = await postRefresh({
      // Provide headers field used by this structure.
      headers: {
        // Provide Authorization field used by this structure.
        Authorization: `Bearer ${tokens.accessToken}`,
        // Provide Cookie field used by this structure.
        Cookie: cookieHeader({
          // Support the surrounding logic for this step.
          [REFRESH_COOKIE]: tokens.refreshToken,
          // Support the surrounding logic for this step.
          [CSRF_COOKIE]: "csrf-expected",
        }),
      },
    });
    // Assert expected behavior in this test case.
    assert.equal(result.status, 403);
    // Assert expected behavior in this test case.
    assert.equal(result.body.error, "csrf");

    // Bind sessionsAfter for use in the following logic.
    const sessionsAfter = await prisma.authSession.count({
      // Provide where field used by this structure.
      where: { userId: userA.userId },
    });
    // Assert expected behavior in this test case.
    assert.equal(sessionsAfter, sessionsBefore);
    // Bind rowAfter for use in the following logic.
    const rowAfter = await prisma.authSession.findUniqueOrThrow({
      // Provide where field used by this structure.
      where: { id: tokens.sessionId },
    });
    // Assert expected behavior in this test case.
    assert.equal(rowAfter.revokedAt, null);
    // Assert expected behavior in this test case.
    assert.equal(rowAfter.replacedById, null);
  });

  // Pure Bearer clients (no cookies) skip CSRF and still authorize.
  it("valid Bearer without cookies and without CSRF → protected action succeeds", async () => {
    // Bind tokens for use in the following logic.
    const tokens = await createSession({ userId: userA.userId });
    // Bind result for use in the following logic.
    const result = await postMutate({
      // Provide headers field used by this structure.
      headers: {
        // Provide Authorization field used by this structure.
        Authorization: `Bearer ${tokens.accessToken}`,
      },
    });
    // Assert expected behavior in this test case.
    assert.equal(result.status, 200);
    // Assert expected behavior in this test case.
    assert.equal(result.body.ok, true);
    // Assert expected behavior in this test case.
    assert.equal(result.handlerRan, true);
    // Assert expected behavior in this test case.
    assert.equal(
      // Wait for an async operation before continuing.
      await prisma.auditEvent.count({ where: { action: result.marker } }),
      // Expected numeric assertion argument for this check.
      1,
    );
  });

  // Invalid Bearer without cookies fails at requireAuth (401), not CSRF.
  it("invalid Bearer without cookies → 401; handler not run; no DB write", async () => {
    // Bind result for use in the following logic.
    const result = await postMutate({
      // Provide headers field used by this structure.
      headers: {
        // Provide Authorization field used by this structure.
        Authorization: "Bearer not-a-valid-jwt",
      },
    });
    // Assert expected behavior in this test case.
    assert.equal(result.status, 401);
    // Assert expected behavior in this test case.
    assert.equal(result.body.error, "unauthorized");
    // Assert expected behavior in this test case.
    assert.equal(result.handlerRan, false);
    // Assert expected behavior in this test case.
    assert.equal(
      // Wait for an async operation before continuing.
      await prisma.auditEvent.count({ where: { action: result.marker } }),
      // Expected numeric assertion argument for this check.
      0,
    );
  });
});
