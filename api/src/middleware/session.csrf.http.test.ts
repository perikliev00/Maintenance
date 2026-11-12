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
  cleanupEmployeeGraph,
  createEmployeeWithUser,
  type EmployeeUserFixture,
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
  CSRF_COOKIE,
  CSRF_HEADER,
  REFRESH_COOKIE,
  SESSION_COOKIE,
  requireCsrf,
} from "./session";

// Prefer api/.env so secrets match the database suite.
dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
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
  parts: Partial<Record<string, string>>,
): string {
  return Object.entries(parts)
    .filter(([, v]) => typeof v === "string" && v.length > 0)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

describe("CSRF HTTP integration", () => {
  // Employee ids created in before() for graph cleanup.
  const fixtureIds: string[] = [];
  // Audit action markers to delete after the suite.
  const auditActions: string[] = [];
  // True only if the protected mutate handler ran.
  let handlerRan = false;
  // Marker the mutate probe will persist when auth+CSRF succeed.
  let pendingMarker = "";
  let server: http.Server;
  let baseUrl = "";
  let userA: EmployeeUserFixture;

  // Register test lifecycle hook for setup or teardown.
  before(async () => {
    const stamp = Date.now();
    userA = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-CSRF-A-${stamp}`,
      email: `t-csrf-a-${stamp}@test.local`,
      role: Role.housekeeper,
      fullName: "T Csrf Http A",
    });
    fixtureIds.push(userA.employeeId);

    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    // CSRF runs before auth routes and the mutate probe.
    app.use(requireCsrf);
    app.use("/auth", authRouter);
    // Probe that writes audit only when CSRF + requireAuth both pass.
    app.post("/probe-mutate", requireAuth, async (req, res, next) => {
      handlerRan = true;
      try {
        const marker = pendingMarker;
        auditActions.push(marker);
        await prisma.auditEvent.create({
          data: {
            action: marker,
            entityType: "CsrfHttpProbe",
            entityId: `probe-${marker}`,
            actorEmployeeId: req.user!.employeeId,
          },
        });
        res.json({ ok: true, marker });
      } catch (err) {
        next(err);
      }
    });
    // Minimal AppError-aware terminal handler for /auth failures.
    app.use(
      // Open argument / parameter list for the following entries.
      (
        err: unknown,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        if (err instanceof AppError) {
          return res.status(err.status).json({
            error: err.code,
            message: err.message,
          });
        }
        return res.status(500).json({ error: "internal" });
      },
    );

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

  // POST /probe-mutate with optional headers and a unique audit marker.
  async function postMutate(init?: {
    headers?: Record<string, string>;
    marker?: string;
  }) {
    handlerRan = false;
    const marker =
      init?.marker ?? `${AUDIT_MARKER_PREFIX}-${Date.now()}-${Math.random()}`;
    pendingMarker = marker;
    auditActions.push(marker);
    // Capture remote/API result needed by this flow.
    const res = await fetch(`${baseUrl}/probe-mutate`, {
      method: "POST",
      headers: {
        // Map key Content-Type to its bilingual / structured value.
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      marker?: string;
      error?: string;
      message?: string;
    };
    return { status: res.status, body, handlerRan, marker };
  }

  // POST /auth/refresh with optional Cookie/Authorization headers.
  async function postRefresh(init?: {
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
  }) {
    // Capture remote/API result needed by this flow.
    const res = await fetch(`${baseUrl}/auth/refresh`, {
      method: "POST",
      headers: {
        // Map key Content-Type to its bilingual / structured value.
        "Content-Type": "application/json",
        ...init?.headers,
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      expiresIn?: number;
      error?: string;
      message?: string;
    };
    return { status: res.status, body };
  }

  // Session cookie without CSRF header must not reach the handler/DB.
  it("session cookie + missing CSRF → 403; handler not run; no DB write", async () => {
    const tokens = await createSession({ userId: userA.userId });
    const csrf = "csrf-expected";
    const result = await postMutate({
      headers: {
        Cookie: cookieHeader({
          [SESSION_COOKIE]: tokens.accessToken,
          [CSRF_COOKIE]: csrf,
        }),
      },
    });
    assert.equal(result.status, 403);
    assert.equal(result.body.error, "csrf");
    assert.equal(result.handlerRan, false);
    assert.equal(
      await prisma.auditEvent.count({ where: { action: result.marker } }),
      // Expected numeric assertion argument for this check.
      0,
    );
  });

  // Mismatched CSRF header must also 403 without side effects.
  it("session cookie + wrong CSRF → 403; handler not run; no DB write", async () => {
    const tokens = await createSession({ userId: userA.userId });
    const result = await postMutate({
      headers: {
        Cookie: cookieHeader({
          [SESSION_COOKIE]: tokens.accessToken,
          [CSRF_COOKIE]: "csrf-expected",
        }),
        [CSRF_HEADER]: "csrf-wrong",
      },
    });
    assert.equal(result.status, 403);
    assert.equal(result.body.error, "csrf");
    assert.equal(result.handlerRan, false);
    assert.equal(
      await prisma.auditEvent.count({ where: { action: result.marker } }),
      // Expected numeric assertion argument for this check.
      0,
    );
  });

  // Matching double-submit allows the protected mutate action.
  it("session cookie + correct CSRF → protected action succeeds", async () => {
    const tokens = await createSession({ userId: userA.userId });
    const csrf = "csrf-ok";
    const result = await postMutate({
      headers: {
        Cookie: cookieHeader({
          [SESSION_COOKIE]: tokens.accessToken,
          [CSRF_COOKIE]: csrf,
        }),
        [CSRF_HEADER]: csrf,
      },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.handlerRan, true);
    assert.equal(
      await prisma.auditEvent.count({ where: { action: result.marker } }),
      // Expected numeric assertion argument for this check.
      1,
    );
  });

  // NBSP Bearer must not skip CSRF when a session cookie is present.
  it("session cookie + Bearer U+00A0 + missing CSRF → 403; no DB write", async () => {
    const tokens = await createSession({ userId: userA.userId });
    // Real U+00A0 character (not the escape text) after "Bearer "
    const authorization = `Bearer ${NBSP}`;
    assert.ok(authorization.includes(NBSP));
    assert.equal(authorization.charCodeAt("Bearer ".length), 0x00a0);

    const result = await postMutate({
      headers: {
        Authorization: authorization,
        Cookie: cookieHeader({
          [SESSION_COOKIE]: tokens.accessToken,
          [CSRF_COOKIE]: "csrf-expected",
        }),
      },
    });
    assert.equal(result.status, 403);
    assert.equal(result.body.error, "csrf");
    assert.equal(result.handlerRan, false);
    assert.equal(
      await prisma.auditEvent.count({ where: { action: result.marker } }),
      // Expected numeric assertion argument for this check.
      0,
    );
  });

  // Other whitespace-only Bearers likewise fail the usable-Bearer skip.
  it("session cookie + whitespace Bearer + wrong CSRF → 403; no DB write", async () => {
    const tokens = await createSession({ userId: userA.userId });
    const result = await postMutate({
      headers: {
        Authorization: "Bearer \t  ",
        Cookie: cookieHeader({
          [SESSION_COOKIE]: tokens.accessToken,
          [CSRF_COOKIE]: "csrf-expected",
        }),
        [CSRF_HEADER]: "csrf-wrong",
      },
    });
    assert.equal(result.status, 403);
    assert.equal(result.body.error, "csrf");
    assert.equal(result.handlerRan, false);
    assert.equal(
      await prisma.auditEvent.count({ where: { action: result.marker } }),
      // Expected numeric assertion argument for this check.
      0,
    );
  });

  // /auth/refresh with refresh cookie requires CSRF; no rotation on 403.
  it("refresh cookie + missing CSRF → 403; no session rotation", async () => {
    const tokens = await createSession({ userId: userA.userId });
    const sessionsBefore = await prisma.authSession.count({
      where: { userId: userA.userId },
    });
    const rowBefore = await prisma.authSession.findUniqueOrThrow({
      where: { id: tokens.sessionId },
    });
    assert.equal(rowBefore.revokedAt, null);
    assert.equal(rowBefore.replacedById, null);

    const result = await postRefresh({
      headers: {
        Cookie: cookieHeader({
          [REFRESH_COOKIE]: tokens.refreshToken,
          [CSRF_COOKIE]: "csrf-expected",
        }),
      },
    });
    assert.equal(result.status, 403);
    assert.equal(result.body.error, "csrf");

    const sessionsAfter = await prisma.authSession.count({
      where: { userId: userA.userId },
    });
    assert.equal(sessionsAfter, sessionsBefore);
    const rowAfter = await prisma.authSession.findUniqueOrThrow({
      where: { id: tokens.sessionId },
    });
    assert.equal(rowAfter.revokedAt, null);
    assert.equal(rowAfter.replacedById, null);
  });

  // Wrong CSRF on refresh likewise must not rotate sessions.
  it("refresh cookie + wrong CSRF → 403; no session rotation", async () => {
    const tokens = await createSession({ userId: userA.userId });
    const sessionsBefore = await prisma.authSession.count({
      where: { userId: userA.userId },
    });

    const result = await postRefresh({
      headers: {
        Cookie: cookieHeader({
          [REFRESH_COOKIE]: tokens.refreshToken,
          [CSRF_COOKIE]: "csrf-expected",
        }),
        [CSRF_HEADER]: "csrf-wrong",
      },
    });
    assert.equal(result.status, 403);
    assert.equal(result.body.error, "csrf");

    const sessionsAfter = await prisma.authSession.count({
      where: { userId: userA.userId },
    });
    assert.equal(sessionsAfter, sessionsBefore);
    const rowAfter = await prisma.authSession.findUniqueOrThrow({
      where: { id: tokens.sessionId },
    });
    assert.equal(rowAfter.revokedAt, null);
    assert.equal(rowAfter.replacedById, null);
  });

  // Usable Bearer cannot bypass CSRF when a refresh cookie is also present.
  it("Authorization + refresh cookie cannot bypass CSRF on /auth/refresh", async () => {
    const tokens = await createSession({ userId: userA.userId });
    const sessionsBefore = await prisma.authSession.count({
      where: { userId: userA.userId },
    });

    const result = await postRefresh({
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        Cookie: cookieHeader({
          [REFRESH_COOKIE]: tokens.refreshToken,
          [CSRF_COOKIE]: "csrf-expected",
        }),
      },
    });
    assert.equal(result.status, 403);
    assert.equal(result.body.error, "csrf");

    const sessionsAfter = await prisma.authSession.count({
      where: { userId: userA.userId },
    });
    assert.equal(sessionsAfter, sessionsBefore);
    const rowAfter = await prisma.authSession.findUniqueOrThrow({
      where: { id: tokens.sessionId },
    });
    assert.equal(rowAfter.revokedAt, null);
    assert.equal(rowAfter.replacedById, null);
  });

  // Pure Bearer clients (no cookies) skip CSRF and still authorize.
  it("valid Bearer without cookies and without CSRF → protected action succeeds", async () => {
    const tokens = await createSession({ userId: userA.userId });
    const result = await postMutate({
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
      },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.handlerRan, true);
    assert.equal(
      await prisma.auditEvent.count({ where: { action: result.marker } }),
      // Expected numeric assertion argument for this check.
      1,
    );
  });

  // Invalid Bearer without cookies fails at requireAuth (401), not CSRF.
  it("invalid Bearer without cookies → 401; handler not run; no DB write", async () => {
    const result = await postMutate({
      headers: {
        Authorization: "Bearer not-a-valid-jwt",
      },
    });
    assert.equal(result.status, 401);
    assert.equal(result.body.error, "unauthorized");
    assert.equal(result.handlerRan, false);
    assert.equal(
      await prisma.auditEvent.count({ where: { action: result.marker } }),
      // Expected numeric assertion argument for this check.
      0,
    );
  });
});
