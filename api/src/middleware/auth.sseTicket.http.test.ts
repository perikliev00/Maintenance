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
  // List item in import/export/params.
  cleanupEmployeeGraph,
  // List item in import/export/params.
  createEmployeeWithUser,
  // Declare type alias EmployeeUserFixture.
  type EmployeeUserFixture,
// Support the surrounding logic for this step.
} from "../../tests/fixtures";
// Creates a real AuthSession so SSE tickets can carry a valid sid.
import { createSession } from "../services/authSessions";
// Middleware under test: must reject purpose=sse Bearer tokens.
import { requireAuth } from "./auth";

// Prefer api/.env over ambient process env for deterministic secrets.
dotenv.config({
  // Provide path field used by this structure.
  path: path.resolve(__dirname, "../../.env"),
  // Provide override field used by this structure.
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

// Group related tests under a shared suite name.
describe("SSE ticket must not authenticate requireAuth", () => {
  // Employee ids created in before() for graph cleanup.
  const fixtureIds: string[] = [];
  // Audit action markers to delete after each suite run.
  const auditActions: string[] = [];
  // True only if the protected handler body executed.
  let handlerRan = false;
  // Marker the probe route will write when auth succeeds.
  let pendingMarker = "";
  // Bind server for use in the following logic.
  let server: http.Server;
  // Bind baseUrl for use in the following logic.
  let baseUrl = "";
  // Bind userA for use in the following logic.
  let userA: EmployeeUserFixture;

  // Register test lifecycle hook for setup or teardown.
  before(async () => {
    // Bind stamp for use in the following logic.
    const stamp = Date.now();
    // Unique housekeeper fixture for this process.
    userA = await createEmployeeWithUser(prisma, {
      // Provide employeeNumber field used by this structure.
      employeeNumber: `T-P008-A-${stamp}`,
      // Provide email field used by this structure.
      email: `t-p008-a-${stamp}@test.local`,
      // Provide role field used by this structure.
      role: Role.housekeeper,
      // Provide fullName field used by this structure.
      fullName: "T P008 Sse Ticket A",
    });
    // Invoke fixtureIds.push to perform this step.
    fixtureIds.push(userA.employeeId);

    // Probe route that would write audit if requireAuth incorrectly passed.
    const app = express();
    // Invoke app.post to perform this step.
    app.post("/probe-mutate", requireAuth, async (req, res, next) => {
      // Support the surrounding logic for this step.
      handlerRan = true;
      // Begin guarded block to catch runtime failures.
      try {
        // Bind marker for use in the following logic.
        const marker = pendingMarker;
        // Invoke auditActions.push to perform this step.
        auditActions.push(marker);
        // Wait for an async operation before continuing.
        await prisma.auditEvent.create({
          // Provide data field used by this structure.
          data: {
            // Provide action field used by this structure.
            action: marker,
            // Provide entityType field used by this structure.
            entityType: "SseTicketAuthProbe",
            // Provide entityId field used by this structure.
            entityId: `probe-${marker}`,
            // Provide actorEmployeeId field used by this structure.
            actorEmployeeId: req.user!.employeeId,
          },
        });
        // Invoke res.json to perform this step.
        res.json({ ok: true, marker });
      // Support the surrounding logic for this step.
      } catch (err) {
        // Invoke next to perform this step.
        next(err);
      }
    });

    // Support the surrounding logic for this step.
    server = http.createServer(app);
    // Wait for an async operation before continuing.
    await new Promise<void>((resolve, reject) => {
      // Invoke server.once to perform this step.
      server.once("error", reject);
      // Invoke server.listen to perform this step.
      server.listen(0, "127.0.0.1", () => resolve());
    });
    // Bind addr for use in the following logic.
    const addr = server.address();
    // Assert expected behavior in this test case.
    assert.ok(addr && typeof addr === "object");
    // Pass baseUrl prop/value into the element or config.
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  // Register test lifecycle hook for setup or teardown.
  after(async () => {
    // Wait for an async operation before continuing.
    await new Promise<void>((resolve, reject) => {
      // Invoke server.close to perform this step.
      server.close((err) => (err ? reject(err) : resolve()));
    });
    // Remove audit rows created by successful positive-control posts.
    if (auditActions.length) {
      // Wait for an async operation before continuing.
      await prisma.auditEvent.deleteMany({
        // Provide where field used by this structure.
        where: { action: { in: auditActions } },
      });
    }
    // Belt-and-suspenders cleanup by marker prefix.
    await prisma.auditEvent.deleteMany({
      // Provide where field used by this structure.
      where: { action: { startsWith: AUDIT_MARKER_PREFIX } },
    });
    // Wait for an async operation before continuing.
    await cleanupEmployeeGraph(prisma, fixtureIds);
    // Wait for an async operation before continuing.
    await prisma.$disconnect();
  });

  // POST the probe route and capture status/body/handlerRan.
  async function postProbeMutate(headers?: HeadersInit) {
    // Support the surrounding logic for this step.
    handlerRan = false;
    // Capture remote/API result needed by this flow.
    const res = await fetch(`${baseUrl}/probe-mutate`, {
      // Provide method field used by this structure.
      method: "POST",
      // List item in import/export/params.
      headers,
    });
    // Bind body for use in the following logic.
    const body = (await res.json().catch(() => ({}))) as {
      // Support the surrounding logic for this step.
      error?: string;
      // Support the surrounding logic for this step.
      message?: string;
      // Support the surrounding logic for this step.
      ok?: boolean;
      // Support the surrounding logic for this step.
      marker?: string;
    };
    // Return early result or rendered output from this path.
    return { status: res.status, body, handlerRan };
  }

  // AUTH-T-P008-01
  it("rejects SSE ticket Bearer without running handler or writing audit", async () => {
    // Bind marker for use in the following logic.
    const marker = `${AUDIT_MARKER_PREFIX}-bearer-${Date.now()}`;
    // Support the surrounding logic for this step.
    pendingMarker = marker;
    // Invoke auditActions.push to perform this step.
    auditActions.push(marker);

    // Bind tokens for use in the following logic.
    const tokens = await createSession({ userId: userA.userId });
    // Craft a purpose=sse JWT that looks otherwise like an access token.
    const sseTicket = jwt.sign(
      {
        // Provide purpose field used by this structure.
        purpose: SSE_TICKET_PURPOSE,
        // Provide userId field used by this structure.
        userId: userA.userId,
        // Provide employeeId field used by this structure.
        employeeId: userA.employeeId,
        // Provide role field used by this structure.
        role: userA.role,
        // Provide email field used by this structure.
        email: userA.email,
        // Provide sid field used by this structure.
        sid: tokens.sessionId,
      },
      // Read or override process environment for this test/runtime.
      process.env.JWT_SECRET!,
      // Support the surrounding logic for this step.
      { expiresIn: SSE_TICKET_EXPIRES_SEC },
    );

    // Bind result for use in the following logic.
    const result = await postProbeMutate({
      // Provide Authorization field used by this structure.
      Authorization: `Bearer ${sseTicket}`,
    });

    // Assert expected behavior in this test case.
    assert.equal(result.status, 401);
    // Assert expected behavior in this test case.
    assert.equal(result.body.error, "unauthorized");
    // Assert expected behavior in this test case.
    assert.equal(result.body.message, "Invalid token");
    // Assert expected behavior in this test case.
    assert.equal(result.handlerRan, false);
    // Assert expected behavior in this test case.
    assert.equal(
      // Wait for an async operation before continuing.
      await prisma.auditEvent.count({ where: { action: marker } }),
      // Expected numeric assertion argument for this check.
      0,
    );
  });

  // AUTH-T-P008-02
  it("allows access token Bearer and writes audit (positive control)", async () => {
    // Bind marker for use in the following logic.
    const marker = `${AUDIT_MARKER_PREFIX}-access-${Date.now()}`;
    // Support the surrounding logic for this step.
    pendingMarker = marker;
    // Invoke auditActions.push to perform this step.
    auditActions.push(marker);

    // Bind tokens for use in the following logic.
    const tokens = await createSession({ userId: userA.userId });
    // Bind result for use in the following logic.
    const result = await postProbeMutate({
      // Provide Authorization field used by this structure.
      Authorization: `Bearer ${tokens.accessToken}`,
    });

    // Assert expected behavior in this test case.
    assert.equal(result.status, 200);
    // Assert expected behavior in this test case.
    assert.equal(result.body.ok, true);
    // Assert expected behavior in this test case.
    assert.equal(result.body.marker, marker);
    // Assert expected behavior in this test case.
    assert.equal(result.handlerRan, true);
    // Assert expected behavior in this test case.
    assert.equal(
      // Wait for an async operation before continuing.
      await prisma.auditEvent.count({ where: { action: marker } }),
      // Expected numeric assertion argument for this check.
      1,
    );
  });
});
