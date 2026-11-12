import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import cookieParser from "cookie-parser";
import express from "express";
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
  process.env.JWT_SECRET || "test-secret-for-auth-logout-all";

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
describe("POST /auth/logout-all", () => {
  const fixtureIds: string[] = [];
  // Mutable handlerRan updated as the flow proceeds.
  let handlerRan = false;
  let server: http.Server;
  // Mutable baseUrl updated as the flow proceeds.
  let baseUrl = "";
  let userA: EmployeeUserFixture;
  let userB: EmployeeUserFixture;

  // Setup hook run before tests.
  before(async () => {
    const stamp = Date.now();
    userA = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-LA-A-${stamp}`,
      email: `t-la-a-${stamp}@test.local`,
      role: Role.housekeeper,
      fullName: "T LogoutAll A",
    });
    userB = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-LA-B-${stamp}`,
      email: `t-la-b-${stamp}@test.local`,
      role: Role.technician,
      fullName: "T LogoutAll B",
    });
    fixtureIds.push(userA.employeeId, userB.employeeId);

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

  // Async helper postLogoutAll keeps handler bodies thin.
  async function postLogoutAll(headers?: HeadersInit) {
    const res = await fetch(`${baseUrl}/auth/logout-all`, {
      method: "POST",
      headers: {
        // Pass string literal argument.
        "Content-Type": "application/json",
        ...headers,
      },
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      revoked?: number;
      error?: string;
      message?: string;
    };
    // Return value or early exit.
    return { status: res.status, body };
  }

  // AUTH-T-P003-01: logout-all revokes all sessions for profile; other user untouched
  it("revokes all sessions for caller; other user sessions remain valid", async () => {
    const sessionA1 = await createSession({ userId: userA.userId });
    const sessionA2 = await createSession({ userId: userA.userId });
    const sessionB = await createSession({ userId: userB.userId });

    const activeBeforeA = await prisma.authSession.count({
      where: { userId: userA.userId, revokedAt: null },
    });
    assert.ok(activeBeforeA >= 2);

    const logout = await postLogoutAll({
      Authorization: `Bearer ${sessionA1.accessToken}`,
    });
    assert.equal(logout.status, 200);
    assert.equal(logout.body.ok, true);
    assert.equal(logout.body.revoked, activeBeforeA);

    const rowA1 = await prisma.authSession.findUniqueOrThrow({
      where: { id: sessionA1.sessionId },
    });
    const rowA2 = await prisma.authSession.findUniqueOrThrow({
      where: { id: sessionA2.sessionId },
    });
    const rowB = await prisma.authSession.findUniqueOrThrow({
      where: { id: sessionB.sessionId },
    });
    assert.ok(rowA1.revokedAt !== null);
    assert.ok(rowA2.revokedAt !== null);
    assert.equal(rowB.revokedAt, null);

    const probeA = await getProbe({
      Authorization: `Bearer ${sessionA1.accessToken}`,
    });
    isUnauthorized(probeA.status, probeA.body, "Invalid token");
    assert.equal(probeA.handlerRan, false);

    const probeA2 = await getProbe({
      Authorization: `Bearer ${sessionA2.accessToken}`,
    });
    isUnauthorized(probeA2.status, probeA2.body, "Invalid token");
    assert.equal(probeA2.handlerRan, false);

    const probeB = await getProbe({
      Authorization: `Bearer ${sessionB.accessToken}`,
    });
    assert.equal(probeB.status, 200);
    assert.equal(probeB.handlerRan, true);
    assert.equal(probeB.body.userId, userB.userId);

    // Await side-effecting async work.
    await assert.rejects(
      () => rotateRefresh(sessionA1.refreshToken),
      (err: unknown) => isAppError401(err, "Refresh token revoked"),
    );
    // Await side-effecting async work.
    await assert.rejects(
      () => rotateRefresh(sessionA2.refreshToken),
      (err: unknown) => isAppError401(err, "Refresh token revoked"),
    );

    const rotatedB = await rotateRefresh(sessionB.refreshToken);
    assert.ok(rotatedB.accessToken);
    assert.notEqual(rotatedB.sessionId, sessionB.sessionId);
  });
});
