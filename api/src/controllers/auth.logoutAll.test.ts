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
  process.env.JWT_SECRET || "test-secret-for-auth-logout-all";

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

describe("POST /auth/logout-all", () => {
  const fixtureIds: string[] = [];
  let handlerRan = false;
  let server: http.Server;
  let baseUrl = "";
  let userA: EmployeeUserFixture;
  let userB: EmployeeUserFixture;

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

  async function postLogoutAll(headers?: HeadersInit) {
    const res = await fetch(`${baseUrl}/auth/logout-all`, {
      method: "POST",
      headers: {
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

    await assert.rejects(
      () => rotateRefresh(sessionA1.refreshToken),
      (err: unknown) => isAppError401(err, "Refresh token revoked"),
    );
    await assert.rejects(
      () => rotateRefresh(sessionA2.refreshToken),
      (err: unknown) => isAppError401(err, "Refresh token revoked"),
    );

    const rotatedB = await rotateRefresh(sessionB.refreshToken);
    assert.ok(rotatedB.accessToken);
    assert.notEqual(rotatedB.sessionId, sessionB.sessionId);
  });
});
