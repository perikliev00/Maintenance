import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import cookieParser from "cookie-parser";
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
import { AppError } from "../errors";
import { requireAuth } from "../middleware/auth";
import { authRouter } from "../routes/auth";
import {
  createSession,
  rotateRefresh,
} from "../services/authSessions";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-secret-for-auth-logout";

const prisma = new PrismaClient();

function isAppError401(err: unknown, message: string): boolean {
  return (
    err instanceof AppError &&
    err.status === 401 &&
    err.code === "unauthorized" &&
    err.message === message
  );
}

function isUnauthorized(
  status: number,
  body: { error?: string; message?: string },
  message?: string,
) {
  assert.equal(status, 401);
  assert.equal(body.error, "unauthorized");
  if (message) assert.equal(body.message, message);
}

describe("POST /auth/logout session kill", () => {
  const fixtureIds: string[] = [];
  let handlerRan = false;
  let server: http.Server;
  let baseUrl = "";
  let userA: EmployeeUserFixture;

  before(async () => {
    const stamp = Date.now();
    userA = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-LO-A-${stamp}`,
      email: `t-lo-a-${stamp}@test.local`,
      role: Role.housekeeper,
      fullName: "T Logout A",
    });
    fixtureIds.push(userA.employeeId);

    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use("/auth", authRouter);
    app.get("/probe", requireAuth, (req, res) => {
      handlerRan = true;
      res.json({ ok: true, userId: req.user!.userId });
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

  async function postLogout(init?: {
    headers?: HeadersInit;
    body?: Record<string, unknown>;
  }) {
    const res = await fetch(`${baseUrl}/auth/logout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      message?: string;
    };
    return { status: res.status, body };
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

  it("logout with Bearer access revokes session; access and refresh fail", async () => {
    const tokens = await createSession({ userId: userA.userId });
    const { accessToken, refreshToken, sessionId } = tokens;

    const before = await getProbe({
      Authorization: `Bearer ${accessToken}`,
    });
    assert.equal(before.status, 200);
    assert.equal(before.handlerRan, true);

    const logout = await postLogout({
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.equal(logout.status, 200);
    assert.equal(logout.body.ok, true);

    const row = await prisma.authSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    assert.ok(row.revokedAt !== null);

    const sessionsAfterLogout = await prisma.authSession.count({
      where: { userId: userA.userId },
    });

    const after = await getProbe({
      Authorization: `Bearer ${accessToken}`,
    });
    isUnauthorized(after.status, after.body, "Invalid token");
    assert.equal(after.handlerRan, false);

    await assert.rejects(
      () => rotateRefresh(refreshToken),
      (err: unknown) => isAppError401(err, "Refresh token revoked"),
    );

    const sessionsAfterRefresh = await prisma.authSession.count({
      where: { userId: userA.userId },
    });
    assert.equal(sessionsAfterRefresh, sessionsAfterLogout);

    const rowAfterRefresh = await prisma.authSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    assert.equal(rowAfterRefresh.replacedById, null);
  });

  it("logout via refresh fallback when access JWT is expired", async () => {
    const tokens = await createSession({ userId: userA.userId });
    const expiredAccess = jwt.sign(
      authUserFrom(userA, tokens.sessionId),
      process.env.JWT_SECRET!,
      { expiresIn: -1 },
    );

    const logout = await postLogout({
      headers: { Authorization: `Bearer ${expiredAccess}` },
      body: { refreshToken: tokens.refreshToken },
    });
    assert.equal(logout.status, 200);
    assert.equal(logout.body.ok, true);

    const row = await prisma.authSession.findUniqueOrThrow({
      where: { id: tokens.sessionId },
    });
    assert.ok(row.revokedAt !== null);

    await assert.rejects(
      () => rotateRefresh(tokens.refreshToken),
      (err: unknown) => isAppError401(err, "Refresh token revoked"),
    );

    const reissued = signAccessToken(
      authUserFrom(userA, tokens.sessionId),
    );
    const probe = await getProbe({
      Authorization: `Bearer ${reissued}`,
    });
    isUnauthorized(probe.status, probe.body, "Invalid token");
    assert.equal(probe.handlerRan, false);
  });

  it("logout revokes only that session; sibling session still works", async () => {
    const sessionA = await createSession({ userId: userA.userId });
    const sessionB = await createSession({ userId: userA.userId });

    const logout = await postLogout({
      headers: { Authorization: `Bearer ${sessionA.accessToken}` },
    });
    assert.equal(logout.status, 200);
    assert.equal(logout.body.ok, true);

    const rowA = await prisma.authSession.findUniqueOrThrow({
      where: { id: sessionA.sessionId },
    });
    const rowB = await prisma.authSession.findUniqueOrThrow({
      where: { id: sessionB.sessionId },
    });
    assert.ok(rowA.revokedAt !== null);
    assert.equal(rowB.revokedAt, null);

    const probeB = await getProbe({
      Authorization: `Bearer ${sessionB.accessToken}`,
    });
    assert.equal(probeB.status, 200);
    assert.equal(probeB.handlerRan, true);

    const rotatedB = await rotateRefresh(sessionB.refreshToken);
    assert.ok(rotatedB.accessToken);
    assert.ok(rotatedB.refreshToken);
    assert.notEqual(rotatedB.sessionId, sessionB.sessionId);

    await assert.rejects(
      () => rotateRefresh(sessionA.refreshToken),
      (err: unknown) => isAppError401(err, "Refresh token revoked"),
    );

    const rowAAfter = await prisma.authSession.findUniqueOrThrow({
      where: { id: sessionA.sessionId },
    });
    assert.ok(rowAAfter.revokedAt !== null);
  });
});
