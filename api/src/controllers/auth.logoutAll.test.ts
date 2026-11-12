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
  process.env.JWT_SECRET || "test-secret-for-auth-logout-all";

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
describe("POST /auth/logout-all", () => {
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
  // Arrange or act for this test case.
  let userB: EmployeeUserFixture;

  // Setup hook run before tests.
  before(async () => {
    // Bind stamp for use in the handler below.
    const stamp = Date.now();
    // Arrange or act for this test case.
    userA = await createEmployeeWithUser(prisma, {
      // Provide employeeNumber for the object/call below.
      employeeNumber: `T-LA-A-${stamp}`,
      // Provide email for the object/call below.
      email: `t-la-a-${stamp}@test.local`,
      // Provide role for the object/call below.
      role: Role.housekeeper,
      // Provide fullName for the object/call below.
      fullName: "T LogoutAll A",
    });
    // Arrange or act for this test case.
    userB = await createEmployeeWithUser(prisma, {
      // Provide employeeNumber for the object/call below.
      employeeNumber: `T-LA-B-${stamp}`,
      // Provide email for the object/call below.
      email: `t-la-b-${stamp}@test.local`,
      // Provide role for the object/call below.
      role: Role.technician,
      // Provide fullName for the object/call below.
      fullName: "T LogoutAll B",
    });
    // Arrange or act for this test case.
    fixtureIds.push(userA.employeeId, userB.employeeId);

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

  // Async helper postLogoutAll keeps handler bodies thin.
  async function postLogoutAll(headers?: HeadersInit) {
    // Await async work into res.
    const res = await fetch(`${baseUrl}/auth/logout-all`, {
      // Provide method for the object/call below.
      method: "POST",
      // Provide headers for the object/call below.
      headers: {
        // Pass string literal argument.
        "Content-Type": "application/json",
        // Arrange or act for this test case.
        ...headers,
      },
    });
    // Bind body for use in the handler below.
    const body = (await res.json().catch(() => ({}))) as {
      // Arrange or act for this test case.
      ok?: boolean;
      // Arrange or act for this test case.
      revoked?: number;
      // Arrange or act for this test case.
      error?: string;
      // Arrange or act for this test case.
      message?: string;
    };
    // Return value or early exit.
    return { status: res.status, body };
  }

  // AUTH-T-P003-01: logout-all revokes all sessions for profile; other user untouched
  it("revokes all sessions for caller; other user sessions remain valid", async () => {
    // Await async work into sessionA1.
    const sessionA1 = await createSession({ userId: userA.userId });
    // Await async work into sessionA2.
    const sessionA2 = await createSession({ userId: userA.userId });
    // Await async work into sessionB.
    const sessionB = await createSession({ userId: userB.userId });

    // Await async work into activeBeforeA.
    const activeBeforeA = await prisma.authSession.count({
      // Provide where for the object/call below.
      where: { userId: userA.userId, revokedAt: null },
    });
    // Assert expected outcome for this case.
    assert.ok(activeBeforeA >= 2);

    // Await async work into logout.
    const logout = await postLogoutAll({
      // Provide Authorization for the object/call below.
      Authorization: `Bearer ${sessionA1.accessToken}`,
    });
    // Assert expected outcome for this case.
    assert.equal(logout.status, 200);
    // Assert expected outcome for this case.
    assert.equal(logout.body.ok, true);
    // Assert expected outcome for this case.
    assert.equal(logout.body.revoked, activeBeforeA);

    // Await async work into rowA1.
    const rowA1 = await prisma.authSession.findUniqueOrThrow({
      // Provide where for the object/call below.
      where: { id: sessionA1.sessionId },
    });
    // Await async work into rowA2.
    const rowA2 = await prisma.authSession.findUniqueOrThrow({
      // Provide where for the object/call below.
      where: { id: sessionA2.sessionId },
    });
    // Await async work into rowB.
    const rowB = await prisma.authSession.findUniqueOrThrow({
      // Provide where for the object/call below.
      where: { id: sessionB.sessionId },
    });
    // Assert expected outcome for this case.
    assert.ok(rowA1.revokedAt !== null);
    // Assert expected outcome for this case.
    assert.ok(rowA2.revokedAt !== null);
    // Assert expected outcome for this case.
    assert.equal(rowB.revokedAt, null);

    // Await async work into probeA.
    const probeA = await getProbe({
      // Provide Authorization for the object/call below.
      Authorization: `Bearer ${sessionA1.accessToken}`,
    });
    // Arrange or act for this test case.
    isUnauthorized(probeA.status, probeA.body, "Invalid token");
    // Assert expected outcome for this case.
    assert.equal(probeA.handlerRan, false);

    // Await async work into probeA2.
    const probeA2 = await getProbe({
      // Provide Authorization for the object/call below.
      Authorization: `Bearer ${sessionA2.accessToken}`,
    });
    // Arrange or act for this test case.
    isUnauthorized(probeA2.status, probeA2.body, "Invalid token");
    // Assert expected outcome for this case.
    assert.equal(probeA2.handlerRan, false);

    // Await async work into probeB.
    const probeB = await getProbe({
      // Provide Authorization for the object/call below.
      Authorization: `Bearer ${sessionB.accessToken}`,
    });
    // Assert expected outcome for this case.
    assert.equal(probeB.status, 200);
    // Assert expected outcome for this case.
    assert.equal(probeB.handlerRan, true);
    // Assert expected outcome for this case.
    assert.equal(probeB.body.userId, userB.userId);

    // Await side-effecting async work.
    await assert.rejects(
      // Arrange or act for this test case.
      () => rotateRefresh(sessionA1.refreshToken),
      // Arrange or act for this test case.
      (err: unknown) => isAppError401(err, "Refresh token revoked"),
    );
    // Await side-effecting async work.
    await assert.rejects(
      // Arrange or act for this test case.
      () => rotateRefresh(sessionA2.refreshToken),
      // Arrange or act for this test case.
      (err: unknown) => isAppError401(err, "Refresh token revoked"),
    );

    // Await async work into rotatedB.
    const rotatedB = await rotateRefresh(sessionB.refreshToken);
    // Assert expected outcome for this case.
    assert.ok(rotatedB.accessToken);
    // Assert expected outcome for this case.
    assert.notEqual(rotatedB.sessionId, sessionB.sessionId);
  });
});
