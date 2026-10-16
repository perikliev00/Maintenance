import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { PrismaClient, Role } from "@prisma/client";
import dotenv from "dotenv";
import {
  cleanupEmployeeGraph,
  createEmployeeWithUser,
  type EmployeeUserFixture,
} from "../../tests/fixtures";
import { createSession } from "../services/authSessions";
import { requireAuth } from "./auth";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-secret-for-sse-ticket-auth";

/** Mirrors api/src/controllers/events.ts issueTicket contract. */
const SSE_TICKET_PURPOSE = "sse";
const SSE_TICKET_EXPIRES_SEC = 5 * 60;

const prisma = new PrismaClient();
const AUDIT_MARKER_PREFIX = "t-p008-sse";

describe("P0-08 SSE ticket must not authenticate requireAuth", () => {
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
      employeeNumber: `T-P008-A-${stamp}`,
      email: `t-p008-a-${stamp}@test.local`,
      role: Role.housekeeper,
      fullName: "T P008 Sse Ticket A",
    });
    fixtureIds.push(userA.employeeId);

    const app = express();
    app.post("/probe-mutate", requireAuth, async (req, res, next) => {
      handlerRan = true;
      try {
        const marker = pendingMarker;
        auditActions.push(marker);
        await prisma.auditEvent.create({
          data: {
            action: marker,
            entityType: "SseTicketAuthProbe",
            entityId: `probe-${marker}`,
            actorEmployeeId: req.user!.employeeId,
          },
        });
        res.json({ ok: true, marker });
      } catch (err) {
        next(err);
      }
    });

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

  async function postProbeMutate(headers?: HeadersInit) {
    handlerRan = false;
    const res = await fetch(`${baseUrl}/probe-mutate`, {
      method: "POST",
      headers,
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      ok?: boolean;
      marker?: string;
    };
    return { status: res.status, body, handlerRan };
  }

  // AUTH-T-P008-01
  it("rejects SSE ticket Bearer without running handler or writing audit", async () => {
    const marker = `${AUDIT_MARKER_PREFIX}-bearer-${Date.now()}`;
    pendingMarker = marker;
    auditActions.push(marker);

    const tokens = await createSession({ userId: userA.userId });
    const sseTicket = jwt.sign(
      {
        purpose: SSE_TICKET_PURPOSE,
        userId: userA.userId,
        employeeId: userA.employeeId,
        role: userA.role,
        email: userA.email,
        sid: tokens.sessionId,
      },
      process.env.JWT_SECRET!,
      { expiresIn: SSE_TICKET_EXPIRES_SEC },
    );

    const result = await postProbeMutate({
      Authorization: `Bearer ${sseTicket}`,
    });

    assert.equal(result.status, 401);
    assert.equal(result.body.error, "unauthorized");
    assert.equal(result.body.message, "Invalid token");
    assert.equal(result.handlerRan, false);
    assert.equal(
      await prisma.auditEvent.count({ where: { action: marker } }),
      0,
    );
  });

  // AUTH-T-P008-02
  it("allows access token Bearer and writes audit (positive control)", async () => {
    const marker = `${AUDIT_MARKER_PREFIX}-access-${Date.now()}`;
    pendingMarker = marker;
    auditActions.push(marker);

    const tokens = await createSession({ userId: userA.userId });
    const result = await postProbeMutate({
      Authorization: `Bearer ${tokens.accessToken}`,
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.marker, marker);
    assert.equal(result.handlerRan, true);
    assert.equal(
      await prisma.auditEvent.count({ where: { action: marker } }),
      1,
    );
  });
});
