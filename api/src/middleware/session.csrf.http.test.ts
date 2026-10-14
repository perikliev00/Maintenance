import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import cookieParser from "cookie-parser";
import express from "express";
import { PrismaClient, Role } from "@prisma/client";
import dotenv from "dotenv";
import {
  cleanupEmployeeGraph,
  createEmployeeWithUser,
  type EmployeeUserFixture,
} from "../../tests/fixtures";
import { AppError } from "../errors";
import { authRouter } from "../routes/auth";
import { createSession } from "../services/authSessions";
import { requireAuth } from "./auth";
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  REFRESH_COOKIE,
  SESSION_COOKIE,
  requireCsrf,
} from "./session";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-secret-for-csrf-http";

const prisma = new PrismaClient();
const AUDIT_MARKER_PREFIX = "t-csrf-http-probe";
const NBSP = "\u00A0";

function cookieHeader(
  parts: Partial<Record<string, string>>,
): string {
  return Object.entries(parts)
    .filter(([, v]) => typeof v === "string" && v.length > 0)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

describe("P0-07 CSRF HTTP integration", () => {
  const fixtureIds: string[] = [];
  const auditActions: string[] = [];
  let handlerRan = false;
  let pendingMarker = "";
  let server: http.Server;
  let baseUrl = "";
  let userA: EmployeeUserFixture;

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
    app.use(requireCsrf);
    app.use("/auth", authRouter);
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
    app.use(
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

  async function postMutate(init?: {
    headers?: Record<string, string>;
    marker?: string;
  }) {
    handlerRan = false;
    const marker =
      init?.marker ?? `${AUDIT_MARKER_PREFIX}-${Date.now()}-${Math.random()}`;
    pendingMarker = marker;
    auditActions.push(marker);
    const res = await fetch(`${baseUrl}/probe-mutate`, {
      method: "POST",
      headers: {
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

  async function postRefresh(init?: {
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
  }) {
    const res = await fetch(`${baseUrl}/auth/refresh`, {
      method: "POST",
      headers: {
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
      0,
    );
  });

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
      0,
    );
  });

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
      1,
    );
  });

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
      0,
    );
  });

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
      0,
    );
  });

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
      1,
    );
  });

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
      0,
    );
  });
});
