import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import cookieParser from "cookie-parser";
import express from "express";
import jwt from "jsonwebtoken";
import { PrismaClient, Role } from "@prisma/client";
import dotenv from "dotenv";
// Continue named import list.
import {
  // Bring cleanupEmployeeGraph into scope from the import.
  cleanupEmployeeGraph,
  // Bring createEmployeeWithUser into scope from the import.
  createEmployeeWithUser,
  type EmployeeUserFixture,
} from "../../tests/fixtures";
// Import local module ../auth/tokens.
import { signAccessToken, type AuthUser } from "../auth/tokens";
// Import local module ../errors.
import { AppError } from "../errors";
// Import local module ../middleware/auth.
import { requireAuth } from "../middleware/auth";
// Import local module ../routes/auth.
import { authRouter } from "../routes/auth";
// Continue named import list.
import {
  // Bring createSession into scope from the import.
  createSession,
  // Bring rotateRefresh into scope from the import.
  rotateRefresh,
} from "../services/authSessions";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-secret-for-auth-logout";

const prisma = new PrismaClient();

// Local helper isAppError401 shared by handlers in this file.
function isAppError401(err: unknown, message: string): boolean {
  // Return value or early exit.
  return (
    err instanceof AppError &&
    err.status === 401 &&
    err.code === "unauthorized" &&
    err.message === message
  );
}

// Local helper isUnauthorized shared by handlers in this file.
function isUnauthorized(
  status: number,
  body: { error?: string; message?: string },
  message?: string,
) {
  assert.equal(status, 401);
  assert.equal(body.error, "unauthorized");
  // Branch when this condition holds.
  if (message) assert.equal(body.message, message);
}

// Test suite grouping related cases.
describe("POST /auth/logout session kill", () => {
  const fixtureIds: string[] = [];
  // Mutable handlerRan updated as the flow proceeds.
  let handlerRan = false;
  let server: http.Server;
  // Mutable baseUrl updated as the flow proceeds.
  let baseUrl = "";
  let userA: EmployeeUserFixture;

  // Setup hook run before tests.
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
      // Write JSON body for a successful response.
      res.json({ ok: true, userId: req.user!.userId });
    });
    app.use(
      (
        err: unknown,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        // Branch when this condition holds.
        if (err instanceof AppError) {
          // Send the HTTP response and end the handler.
          return res.status(err.status).json({
            error: err.code,
            message: err.message,
          });
        }
        // Send the HTTP response and end the handler.
        return res.status(500).json({ error: "internal" });
      },
    );

    server = http.createServer(app);
    // Await side-effecting async work.
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  // Teardown hook run after tests.
  after(async () => {
    // Await side-effecting async work.
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    // Await side-effecting async work.
    await cleanupEmployeeGraph(prisma, fixtureIds);
    // Await side-effecting async work.
    await prisma.$disconnect();
  });

  // Async helper getProbe keeps handler bodies thin.
  async function getProbe(headers?: HeadersInit) {
    handlerRan = false;
    const res = await fetch(`${baseUrl}/probe`, { headers });
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      ok?: boolean;
      userId?: string;
    };
    // Return value or early exit.
    return { status: res.status, body, handlerRan };
  }

  // Async helper postLogout keeps handler bodies thin.
  async function postLogout(init?: {
    headers?: HeadersInit;
    body?: Record<string, unknown>;
  }) {
    const res = await fetch(`${baseUrl}/auth/logout`, {
      method: "POST",
      headers: {
        // Pass string literal argument.
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
    // Return value or early exit.
    return { status: res.status, body };
  }

  // Local helper authUserFrom shared by handlers in this file.
  function authUserFrom(
    fixture: EmployeeUserFixture,
    sid: string,
  ): AuthUser {
    // Return value or early exit.
    return {
      userId: fixture.userId,
      employeeId: fixture.employeeId,
      role: fixture.role,
      email: fixture.email,
      sid,
    };
  }

  // Single test case asserting expected behavior.
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

    // Await side-effecting async work.
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

  // Single test case asserting expected behavior.
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

    // Await side-effecting async work.
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

  // Single test case asserting expected behavior.
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

    // Await side-effecting async work.
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
