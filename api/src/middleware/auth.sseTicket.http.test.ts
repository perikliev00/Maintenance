// Strict assertions for SSE-ticket rejection on requireAuth routes.
import assert from "node:assert/strict";
// Ephemeral HTTP server for integration-style middleware tests.
import http from "node:http";
// Resolve api/.env relative to this middleware test file.
import path from "node:path";
// Node test lifecycle hooks and suite helpers.
import { after, before, describe, it } from "node:test";
// Minimal Express app hosting a requireAuth probe route.
import express from "express";
// Craft purpose=sse JWTs that must not authenticate ordinary routes.
import jwt from "jsonwebtoken";
// Prisma client + Role for fixture users.
import { PrismaClient, Role } from "@prisma/client";
// Load JWT_SECRET and DATABASE_URL from api/.env.
import dotenv from "dotenv";
// Shared employee+user fixture helpers for auth tests.
import {
  cleanupEmployeeGraph,
  createEmployeeWithUser,
  type EmployeeUserFixture,
} from "../../tests/fixtures";
// Creates a real AuthSession so SSE tickets can carry a valid sid.
import { createSession } from "../services/authSessions";
// Middleware under test: must reject purpose=sse Bearer tokens.
import { requireAuth } from "./auth";

// Prefer api/.env over ambient process env for deterministic secrets.
dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});
// Fallback secret when .env lacks JWT_SECRET in local runs.
process.env.JWT_SECRET =
  // Read or override process environment for this test/runtime.
  process.env.JWT_SECRET || "test-secret-for-sse-ticket-auth";

/** Mirrors api/src/controllers/events.ts issueTicket contract. */
const SSE_TICKET_PURPOSE = "sse";
// Same TTL the production ticket issuer uses.
const SSE_TICKET_EXPIRES_SEC = 5 * 60;

// Dedicated Prisma client for this suite's fixtures and audit checks.
const prisma = new PrismaClient();
// Prefix for audit markers created (and cleaned) by this suite.
const AUDIT_MARKER_PREFIX = "t-p008-sse";

describe("SSE ticket must not authenticate requireAuth", () => {
  // Employee ids created in before() for graph cleanup.
  const fixtureIds: string[] = [];
  // Audit action markers to delete after each suite run.
  const auditActions: string[] = [];
  // True only if the protected handler body executed.
  let handlerRan = false;
  // Marker the probe route will write when auth succeeds.
  let pendingMarker = "";
  let server: http.Server;
  let baseUrl = "";
  let userA: EmployeeUserFixture;

  // Register test lifecycle hook for setup or teardown.
  before(async () => {
    const stamp = Date.now();
    // Unique housekeeper fixture for this process.
    userA = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-P008-A-${stamp}`,
      email: `t-p008-a-${stamp}@test.local`,
      role: Role.housekeeper,
      fullName: "T P008 Sse Ticket A",
    });
    fixtureIds.push(userA.employeeId);

    // Probe route that would write audit if requireAuth incorrectly passed.
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

  // Register test lifecycle hook for setup or teardown.
  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    // Remove audit rows created by successful positive-control posts.
    if (auditActions.length) {
      await prisma.auditEvent.deleteMany({
        where: { action: { in: auditActions } },
      });
    }
    // Belt-and-suspenders cleanup by marker prefix.
    await prisma.auditEvent.deleteMany({
      where: { action: { startsWith: AUDIT_MARKER_PREFIX } },
    });
    await cleanupEmployeeGraph(prisma, fixtureIds);
    await prisma.$disconnect();
  });

  // POST the probe route and capture status/body/handlerRan.
  async function postProbeMutate(headers?: HeadersInit) {
    handlerRan = false;
    // Capture remote/API result needed by this flow.
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
    // Craft a purpose=sse JWT that looks otherwise like an access token.
    const sseTicket = jwt.sign(
      {
        purpose: SSE_TICKET_PURPOSE,
        userId: userA.userId,
        employeeId: userA.employeeId,
        role: userA.role,
        email: userA.email,
        sid: tokens.sessionId,
      },
      // Read or override process environment for this test/runtime.
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
      // Expected numeric assertion argument for this check.
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
      // Expected numeric assertion argument for this check.
      1,
    );
  });
});
