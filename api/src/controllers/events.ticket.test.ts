import assert from "node:assert/strict";
import { describe, it } from "node:test";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";
import { AppError } from "../errors";
import { resolveSseTicketUser } from "./events";

/**
 * Mirrors api/src/controllers/events.ts ticket contract without booting Express/DB.
 */
const SSE_TICKET_PURPOSE = "sse";
const SSE_TICKET_EXPIRES_SEC = 5 * 60;

describe("SSE stream ticket contract", () => {
  it("signs and verifies a short-lived sse ticket payload", () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-sse";
    const secret = process.env.JWT_SECRET;

    const payload = {
      purpose: SSE_TICKET_PURPOSE,
      userId: "u1",
      employeeId: "e1",
      role: Role.housekeeper,
      email: "hk@example.com",
      sid: "sess-1",
    };

    const token = jwt.sign(payload, secret, {
      expiresIn: SSE_TICKET_EXPIRES_SEC,
    });
    const decoded = jwt.verify(token, secret) as typeof payload & {
      exp: number;
      iat: number;
    };

    assert.equal(decoded.purpose, "sse");
    assert.equal(decoded.userId, "u1");
    assert.equal(decoded.role, Role.housekeeper);
    assert.ok(decoded.exp - decoded.iat <= SSE_TICKET_EXPIRES_SEC + 1);
  });

  it("rejects session access tokens used as tickets (no purpose)", () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-sse";
    const secret = process.env.JWT_SECRET;

    const sessionToken = jwt.sign(
      {
        userId: "u1",
        employeeId: "e1",
        role: Role.manager,
        email: "m@example.com",
        sid: "sess-1",
      },
      secret,
      { expiresIn: "15m" },
    );

    const decoded = jwt.verify(sessionToken, secret) as {
      purpose?: string;
    };
    assert.notEqual(decoded.purpose, "sse");
  });

  it("rejects expired tickets", () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-sse";
    const secret = process.env.JWT_SECRET;

    const token = jwt.sign(
      {
        purpose: SSE_TICKET_PURPOSE,
        userId: "u1",
        employeeId: "e1",
        role: Role.housekeeper,
        email: "hk@example.com",
        sid: "sess-1",
      },
      secret,
      { expiresIn: -1 },
    );

    assert.throws(() => jwt.verify(token, secret));
  });
});

describe("resolveSseTicketUser", () => {
  it("uses DB role from assertSessionActive, not JWT role claim", async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-sse";
    const secret = process.env.JWT_SECRET;

    const ticket = jwt.sign(
      {
        purpose: SSE_TICKET_PURPOSE,
        userId: "u1",
        employeeId: "e-stale",
        role: Role.owner,
        email: "stale@example.com",
        sid: "sess-1",
      },
      secret,
      { expiresIn: SSE_TICKET_EXPIRES_SEC },
    );

    const user = await resolveSseTicketUser(ticket, async (sid, userId) => {
      assert.equal(sid, "sess-1");
      assert.equal(userId, "u1");
      return {
        id: "sess-1",
        userId: "u1",
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        user: {
          id: "u1",
          isActive: true,
          role: Role.housekeeper,
          email: "hk@example.com",
          employeeId: "e-db",
        },
      } as Awaited<ReturnType<typeof import("../services/authSessions").assertSessionActive>>;
    });

    assert.ok(user);
    assert.equal(user.role, Role.housekeeper);
    assert.equal(user.email, "hk@example.com");
    assert.equal(user.employeeId, "e-db");
    assert.equal(user.sid, "sess-1");
    assert.equal(user.userId, "u1");
  });

  it("returns null when session is revoked", async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-sse";
    const secret = process.env.JWT_SECRET;

    const ticket = jwt.sign(
      {
        purpose: SSE_TICKET_PURPOSE,
        userId: "u1",
        employeeId: "e1",
        role: Role.owner,
        email: "owner@example.com",
        sid: "sess-revoked",
      },
      secret,
      { expiresIn: SSE_TICKET_EXPIRES_SEC },
    );

    const user = await resolveSseTicketUser(ticket, async () => {
      throw new AppError(401, "unauthorized", "Session revoked");
    });

    assert.equal(user, null);
  });

  it("returns null for non-sse access tokens", async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-sse";
    const secret = process.env.JWT_SECRET;

    const access = jwt.sign(
      {
        userId: "u1",
        employeeId: "e1",
        role: Role.manager,
        email: "m@example.com",
        sid: "sess-1",
      },
      secret,
      { expiresIn: "15m" },
    );

    let assertCalled = false;
    const user = await resolveSseTicketUser(access, async () => {
      assertCalled = true;
      throw new Error("should not be called");
    });

    assert.equal(user, null);
    assert.equal(assertCalled, false);
  });
});
