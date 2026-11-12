// Import dependency node:assert/strict.
import assert from "node:assert/strict";
// Import dependency node:http.
import http from "node:http";
// Import dependency node:path.
import path from "node:path";
// Import dependency node:test.
import { after, before, describe, it } from "node:test";
// Import dependency cookie-parser.
import cookieParser from "cookie-parser";
// Import dependency express.
import express from "express";
// Import dependency jsonwebtoken.
import jwt from "jsonwebtoken";
// Import dependency @prisma/client.
import { PrismaClient, Role } from "@prisma/client";
// Import dependency dotenv.
import dotenv from "dotenv";
// Continue named import list.
import {
  // Bring cleanupEmployeeGraph into scope from the import.
  cleanupEmployeeGraph,
  // Bring createEmployeeWithUser into scope from the import.
  createEmployeeWithUser,
  // Arrange or act for this test case.
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

// Arrange or act for this test case.
dotenv.config({
  // Provide path for the object/call below.
  path: path.resolve(__dirname, "../../.env"),
  // Provide override for the object/call below.
  override: true,
});
// Arrange or act for this test case.
process.env.JWT_SECRET =
  // Arrange or act for this test case.
  process.env.JWT_SECRET || "test-secret-for-auth-logout";

// Bind prisma for use in the handler below.
const prisma = new PrismaClient();

// Local helper isAppError401 shared by handlers in this file.
function isAppError401(err: unknown, message: string): boolean {
  // Return value or early exit.
  return (
    // Arrange or act for this test case.
    err instanceof AppError &&
    // Arrange or act for this test case.
    err.status === 401 &&
    // Arrange or act for this test case.
    err.code === "unauthorized" &&
    // Arrange or act for this test case.
    err.message === message
  );
}

// Local helper isUnauthorized shared by handlers in this file.
function isUnauthorized(
  // Provide status for the object/call below.
  status: number,
  // Provide body for the object/call below.
  body: { error?: string; message?: string },
  // Arrange or act for this test case.
  message?: string,
// Arrange or act for this test case.
) {
  // Assert expected outcome for this case.
  assert.equal(status, 401);
  // Assert expected outcome for this case.
  assert.equal(body.error, "unauthorized");
  // Branch when this condition holds.
  if (message) assert.equal(body.message, message);
}

// Test suite grouping related cases.
describe("POST /auth/logout session kill", () => {
  // Arrange or act for this test case.
  const fixtureIds: string[] = [];
  // Mutable handlerRan updated as the flow proceeds.
  let handlerRan = false;
  // Arrange or act for this test case.
  let server: http.Server;
  // Mutable baseUrl updated as the flow proceeds.
  let baseUrl = "";
  // Arrange or act for this test case.
  let userA: EmployeeUserFixture;

  // Setup hook run before tests.
  before(async () => {
    // Bind stamp for use in the handler below.
    const stamp = Date.now();
    // Arrange or act for this test case.
    userA = await createEmployeeWithUser(prisma, {
      // Provide employeeNumber for the object/call below.
      employeeNumber: `T-LO-A-${stamp}`,
      // Provide email for the object/call below.
      email: `t-lo-a-${stamp}@test.local`,
      // Provide role for the object/call below.
      role: Role.housekeeper,
      // Provide fullName for the object/call below.
      fullName: "T Logout A",
    });
    // Arrange or act for this test case.
    fixtureIds.push(userA.employeeId);

    // Bind app for use in the handler below.
    const app = express();
    // Arrange or act for this test case.
    app.use(express.json());
    // Arrange or act for this test case.
    app.use(cookieParser());
    // Arrange or act for this test case.
    app.use("/auth", authRouter);
    // Arrange or act for this test case.
    app.get("/probe", requireAuth, (req, res) => {
      // Arrange or act for this test case.
      handlerRan = true;
      // Write JSON body for a successful response.
      res.json({ ok: true, userId: req.user!.userId });
    });
    // Arrange or act for this test case.
    app.use(
      (
        // Provide err for the object/call below.
        err: unknown,
        // Provide _req for the object/call below.
        _req: express.Request,
        // Provide res for the object/call below.
        res: express.Response,
        // Provide _next for the object/call below.
        _next: express.NextFunction,
      // Arrange or act for this test case.
      ) => {
        // Branch when this condition holds.
        if (err instanceof AppError) {
          // Send the HTTP response and end the handler.
          return res.status(err.status).json({
            // Provide error for the object/call below.
            error: err.code,
            // Provide message for the object/call below.
            message: err.message,
          });
        }
        // Send the HTTP response and end the handler.
        return res.status(500).json({ error: "internal" });
      },
    );

    // Arrange or act for this test case.
    server = http.createServer(app);
    // Await side-effecting async work.
    await new Promise<void>((resolve, reject) => {
      // Arrange or act for this test case.
      server.once("error", reject);
      // Arrange or act for this test case.
      server.listen(0, "127.0.0.1", () => resolve());
    });
    // Bind addr for use in the handler below.
    const addr = server.address();
    // Assert expected outcome for this case.
    assert.ok(addr && typeof addr === "object");
    // Arrange or act for this test case.
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  // Teardown hook run after tests.
  after(async () => {
    // Await side-effecting async work.
    await new Promise<void>((resolve, reject) => {
      // Arrange or act for this test case.
      server.close((err) => (err ? reject(err) : resolve()));
    });
    // Await side-effecting async work.
    await cleanupEmployeeGraph(prisma, fixtureIds);
    // Await side-effecting async work.
    await prisma.$disconnect();
  });

  // Async helper getProbe keeps handler bodies thin.
  async function getProbe(headers?: HeadersInit) {
    // Arrange or act for this test case.
    handlerRan = false;
    // Await async work into res.
    const res = await fetch(`${baseUrl}/probe`, { headers });
    // Bind body for use in the handler below.
    const body = (await res.json().catch(() => ({}))) as {
      // Arrange or act for this test case.
      error?: string;
      // Arrange or act for this test case.
      message?: string;
      // Arrange or act for this test case.
      ok?: boolean;
      // Arrange or act for this test case.
      userId?: string;
    };
    // Return value or early exit.
    return { status: res.status, body, handlerRan };
  }

  // Async helper postLogout keeps handler bodies thin.
  async function postLogout(init?: {
    // Arrange or act for this test case.
    headers?: HeadersInit;
    // Arrange or act for this test case.
    body?: Record<string, unknown>;
  // Arrange or act for this test case.
  }) {
    // Await async work into res.
    const res = await fetch(`${baseUrl}/auth/logout`, {
      // Provide method for the object/call below.
      method: "POST",
      // Provide headers for the object/call below.
      headers: {
        // Pass string literal argument.
        "Content-Type": "application/json",
        // Arrange or act for this test case.
        ...init?.headers,
      },
      // Provide body for the object/call below.
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    // Bind body for use in the handler below.
    const body = (await res.json().catch(() => ({}))) as {
      // Arrange or act for this test case.
      ok?: boolean;
      // Arrange or act for this test case.
      error?: string;
      // Arrange or act for this test case.
      message?: string;
    };
    // Return value or early exit.
    return { status: res.status, body };
  }

  // Local helper authUserFrom shared by handlers in this file.
  function authUserFrom(
    // Provide fixture for the object/call below.
    fixture: EmployeeUserFixture,
    // Provide sid for the object/call below.
    sid: string,
  // Arrange or act for this test case.
  ): AuthUser {
    // Return value or early exit.
    return {
      // Provide userId for the object/call below.
      userId: fixture.userId,
      // Provide employeeId for the object/call below.
      employeeId: fixture.employeeId,
      // Provide role for the object/call below.
      role: fixture.role,
      // Provide email for the object/call below.
      email: fixture.email,
      // Pass sid through.
      sid,
    };
  }

  // Single test case asserting expected behavior.
  it("logout with Bearer access revokes session; access and refresh fail", async () => {
    // Await async work into tokens.
    const tokens = await createSession({ userId: userA.userId });
    // Arrange or act for this test case.
    const { accessToken, refreshToken, sessionId } = tokens;

    // Await async work into before.
    const before = await getProbe({
      // Provide Authorization for the object/call below.
      Authorization: `Bearer ${accessToken}`,
    });
    // Assert expected outcome for this case.
    assert.equal(before.status, 200);
    // Assert expected outcome for this case.
    assert.equal(before.handlerRan, true);

    // Await async work into logout.
    const logout = await postLogout({
      // Provide headers for the object/call below.
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    // Assert expected outcome for this case.
    assert.equal(logout.status, 200);
    // Assert expected outcome for this case.
    assert.equal(logout.body.ok, true);

    // Await async work into row.
    const row = await prisma.authSession.findUniqueOrThrow({
      // Provide where for the object/call below.
      where: { id: sessionId },
    });
    // Assert expected outcome for this case.
    assert.ok(row.revokedAt !== null);

    // Await async work into sessionsAfterLogout.
    const sessionsAfterLogout = await prisma.authSession.count({
      // Provide where for the object/call below.
      where: { userId: userA.userId },
    });

    // Await async work into after.
    const after = await getProbe({
      // Provide Authorization for the object/call below.
      Authorization: `Bearer ${accessToken}`,
    });
    // Arrange or act for this test case.
    isUnauthorized(after.status, after.body, "Invalid token");
    // Assert expected outcome for this case.
    assert.equal(after.handlerRan, false);

    // Await side-effecting async work.
    await assert.rejects(
      // Arrange or act for this test case.
      () => rotateRefresh(refreshToken),
      // Arrange or act for this test case.
      (err: unknown) => isAppError401(err, "Refresh token revoked"),
    );

    // Await async work into sessionsAfterRefresh.
    const sessionsAfterRefresh = await prisma.authSession.count({
      // Provide where for the object/call below.
      where: { userId: userA.userId },
    });
    // Assert expected outcome for this case.
    assert.equal(sessionsAfterRefresh, sessionsAfterLogout);

    // Await async work into rowAfterRefresh.
    const rowAfterRefresh = await prisma.authSession.findUniqueOrThrow({
      // Provide where for the object/call below.
      where: { id: sessionId },
    });
    // Assert expected outcome for this case.
    assert.equal(rowAfterRefresh.replacedById, null);
  });

  // Single test case asserting expected behavior.
  it("logout via refresh fallback when access JWT is expired", async () => {
    // Await async work into tokens.
    const tokens = await createSession({ userId: userA.userId });
    // Bind expiredAccess for use in the handler below.
    const expiredAccess = jwt.sign(
      // Arrange or act for this test case.
      authUserFrom(userA, tokens.sessionId),
      // Arrange or act for this test case.
      process.env.JWT_SECRET!,
      // Arrange or act for this test case.
      { expiresIn: -1 },
    );

    // Await async work into logout.
    const logout = await postLogout({
      // Provide headers for the object/call below.
      headers: { Authorization: `Bearer ${expiredAccess}` },
      // Provide body for the object/call below.
      body: { refreshToken: tokens.refreshToken },
    });
    // Assert expected outcome for this case.
    assert.equal(logout.status, 200);
    // Assert expected outcome for this case.
    assert.equal(logout.body.ok, true);

    // Await async work into row.
    const row = await prisma.authSession.findUniqueOrThrow({
      // Provide where for the object/call below.
      where: { id: tokens.sessionId },
    });
    // Assert expected outcome for this case.
    assert.ok(row.revokedAt !== null);

    // Await side-effecting async work.
    await assert.rejects(
      // Arrange or act for this test case.
      () => rotateRefresh(tokens.refreshToken),
      // Arrange or act for this test case.
      (err: unknown) => isAppError401(err, "Refresh token revoked"),
    );

    // Bind reissued for use in the handler below.
    const reissued = signAccessToken(
      // Arrange or act for this test case.
      authUserFrom(userA, tokens.sessionId),
    );
    // Await async work into probe.
    const probe = await getProbe({
      // Provide Authorization for the object/call below.
      Authorization: `Bearer ${reissued}`,
    });
    // Arrange or act for this test case.
    isUnauthorized(probe.status, probe.body, "Invalid token");
    // Assert expected outcome for this case.
    assert.equal(probe.handlerRan, false);
  });

  // Single test case asserting expected behavior.
  it("logout revokes only that session; sibling session still works", async () => {
    // Await async work into sessionA.
    const sessionA = await createSession({ userId: userA.userId });
    // Await async work into sessionB.
    const sessionB = await createSession({ userId: userA.userId });

    // Await async work into logout.
    const logout = await postLogout({
      // Provide headers for the object/call below.
      headers: { Authorization: `Bearer ${sessionA.accessToken}` },
    });
    // Assert expected outcome for this case.
    assert.equal(logout.status, 200);
    // Assert expected outcome for this case.
    assert.equal(logout.body.ok, true);

    // Await async work into rowA.
    const rowA = await prisma.authSession.findUniqueOrThrow({
      // Provide where for the object/call below.
      where: { id: sessionA.sessionId },
    });
    // Await async work into rowB.
    const rowB = await prisma.authSession.findUniqueOrThrow({
      // Provide where for the object/call below.
      where: { id: sessionB.sessionId },
    });
    // Assert expected outcome for this case.
    assert.ok(rowA.revokedAt !== null);
    // Assert expected outcome for this case.
    assert.equal(rowB.revokedAt, null);

    // Await async work into probeB.
    const probeB = await getProbe({
      // Provide Authorization for the object/call below.
      Authorization: `Bearer ${sessionB.accessToken}`,
    });
    // Assert expected outcome for this case.
    assert.equal(probeB.status, 200);
    // Assert expected outcome for this case.
    assert.equal(probeB.handlerRan, true);

    // Await async work into rotatedB.
    const rotatedB = await rotateRefresh(sessionB.refreshToken);
    // Assert expected outcome for this case.
    assert.ok(rotatedB.accessToken);
    // Assert expected outcome for this case.
    assert.ok(rotatedB.refreshToken);
    // Assert expected outcome for this case.
    assert.notEqual(rotatedB.sessionId, sessionB.sessionId);

    // Await side-effecting async work.
    await assert.rejects(
      // Arrange or act for this test case.
      () => rotateRefresh(sessionA.refreshToken),
      // Arrange or act for this test case.
      (err: unknown) => isAppError401(err, "Refresh token revoked"),
    );

    // Await async work into rowAAfter.
    const rowAAfter = await prisma.authSession.findUniqueOrThrow({
      // Provide where for the object/call below.
      where: { id: sessionA.sessionId },
    });
    // Assert expected outcome for this case.
    assert.ok(rowAAfter.revokedAt !== null);
  });
});
