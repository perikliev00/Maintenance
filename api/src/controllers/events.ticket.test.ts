// Import dependency node:assert/strict.
import assert from "node:assert/strict";
// Import dependency node:test.
import { describe, it } from "node:test";
// Import dependency jsonwebtoken.
import jwt from "jsonwebtoken";
// Import dependency @prisma/client.
import { Role } from "@prisma/client";
// Import local module ../errors.
import { AppError } from "../errors";
// Import local module ./events.
import { resolveSseTicketUser } from "./events";

/**
 * Mirrors api/src/controllers/events.ts ticket contract without booting Express/DB.
 */
const SSE_TICKET_PURPOSE = "sse";
// Bind SSE_TICKET_EXPIRES_SEC for use in the handler below.
const SSE_TICKET_EXPIRES_SEC = 5 * 60;

// Test suite grouping related cases.
describe("SSE stream ticket contract", () => {
  // Single test case asserting expected behavior.
  it("signs and verifies a short-lived sse ticket payload", () => {
    // Arrange or act for this test case.
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-sse";
    // Bind secret for use in the handler below.
    const secret = process.env.JWT_SECRET;

    // Bind payload for use in the handler below.
    const payload = {
      // Provide purpose for the object/call below.
      purpose: SSE_TICKET_PURPOSE,
      // Provide userId for the object/call below.
      userId: "u1",
      // Provide employeeId for the object/call below.
      employeeId: "e1",
      // Provide role for the object/call below.
      role: Role.housekeeper,
      // Provide email for the object/call below.
      email: "hk@example.com",
      // Provide sid for the object/call below.
      sid: "sess-1",
    };

    // Bind token for use in the handler below.
    const token = jwt.sign(payload, secret, {
      // Provide expiresIn for the object/call below.
      expiresIn: SSE_TICKET_EXPIRES_SEC,
    });
    // Bind decoded for use in the handler below.
    const decoded = jwt.verify(token, secret) as typeof payload & {
      // Provide exp for the object/call below.
      exp: number;
      // Provide iat for the object/call below.
      iat: number;
    };

    // Assert expected outcome for this case.
    assert.equal(decoded.purpose, "sse");
    // Assert expected outcome for this case.
    assert.equal(decoded.userId, "u1");
    // Assert expected outcome for this case.
    assert.equal(decoded.role, Role.housekeeper);
    // Assert expected outcome for this case.
    assert.ok(decoded.exp - decoded.iat <= SSE_TICKET_EXPIRES_SEC + 1);
  });

  // Single test case asserting expected behavior.
  it("rejects session access tokens used as tickets (no purpose)", () => {
    // Arrange or act for this test case.
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-sse";
    // Bind secret for use in the handler below.
    const secret = process.env.JWT_SECRET;

    // Bind sessionToken for use in the handler below.
    const sessionToken = jwt.sign(
      {
        // Provide userId for the object/call below.
        userId: "u1",
        // Provide employeeId for the object/call below.
        employeeId: "e1",
        // Provide role for the object/call below.
        role: Role.manager,
        // Provide email for the object/call below.
        email: "m@example.com",
        // Provide sid for the object/call below.
        sid: "sess-1",
      },
      // Pass secret through.
      secret,
      // Arrange or act for this test case.
      { expiresIn: "15m" },
    );

    // Bind decoded for use in the handler below.
    const decoded = jwt.verify(sessionToken, secret) as {
      // Arrange or act for this test case.
      purpose?: string;
    };
    // Assert expected outcome for this case.
    assert.notEqual(decoded.purpose, "sse");
  });

  // Single test case asserting expected behavior.
  it("rejects expired tickets", () => {
    // Arrange or act for this test case.
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-sse";
    // Bind secret for use in the handler below.
    const secret = process.env.JWT_SECRET;

    // Bind token for use in the handler below.
    const token = jwt.sign(
      {
        // Provide purpose for the object/call below.
        purpose: SSE_TICKET_PURPOSE,
        // Provide userId for the object/call below.
        userId: "u1",
        // Provide employeeId for the object/call below.
        employeeId: "e1",
        // Provide role for the object/call below.
        role: Role.housekeeper,
        // Provide email for the object/call below.
        email: "hk@example.com",
        // Provide sid for the object/call below.
        sid: "sess-1",
      },
      // Pass secret through.
      secret,
      // Arrange or act for this test case.
      { expiresIn: -1 },
    );

    // Assert expected outcome for this case.
    assert.throws(() => jwt.verify(token, secret));
  });
});

// Test suite grouping related cases.
describe("resolveSseTicketUser", () => {
  // Single test case asserting expected behavior.
  it("uses DB role from assertSessionActive, not JWT role claim", async () => {
    // Arrange or act for this test case.
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-sse";
    // Bind secret for use in the handler below.
    const secret = process.env.JWT_SECRET;

    // Bind ticket for use in the handler below.
    const ticket = jwt.sign(
      {
        // Provide purpose for the object/call below.
        purpose: SSE_TICKET_PURPOSE,
        // Provide userId for the object/call below.
        userId: "u1",
        // Provide employeeId for the object/call below.
        employeeId: "e-stale",
        // Provide role for the object/call below.
        role: Role.owner,
        // Provide email for the object/call below.
        email: "stale@example.com",
        // Provide sid for the object/call below.
        sid: "sess-1",
      },
      // Pass secret through.
      secret,
      // Arrange or act for this test case.
      { expiresIn: SSE_TICKET_EXPIRES_SEC },
    );

    // Await async work into user.
    const user = await resolveSseTicketUser(ticket, async (sid, userId) => {
      // Assert expected outcome for this case.
      assert.equal(sid, "sess-1");
      // Assert expected outcome for this case.
      assert.equal(userId, "u1");
      // Return value or early exit.
      return {
        // Provide id for the object/call below.
        id: "sess-1",
        // Provide userId for the object/call below.
        userId: "u1",
        // Provide revokedAt for the object/call below.
        revokedAt: null,
        // Provide expiresAt for the object/call below.
        expiresAt: new Date(Date.now() + 60_000),
        // Provide user for the object/call below.
        user: {
          // Provide id for the object/call below.
          id: "u1",
          // Provide isActive for the object/call below.
          isActive: true,
          // Provide role for the object/call below.
          role: Role.housekeeper,
          // Provide email for the object/call below.
          email: "hk@example.com",
          // Provide employeeId for the object/call below.
          employeeId: "e-db",
        },
      // Arrange or act for this test case.
      } as Awaited<ReturnType<typeof import("../services/authSessions").assertSessionActive>>;
    });

    // Assert expected outcome for this case.
    assert.ok(user);
    // Assert expected outcome for this case.
    assert.equal(user.role, Role.housekeeper);
    // Assert expected outcome for this case.
    assert.equal(user.email, "hk@example.com");
    // Assert expected outcome for this case.
    assert.equal(user.employeeId, "e-db");
    // Assert expected outcome for this case.
    assert.equal(user.sid, "sess-1");
    // Assert expected outcome for this case.
    assert.equal(user.userId, "u1");
  });

  // Single test case asserting expected behavior.
  it("returns null when session is revoked", async () => {
    // Arrange or act for this test case.
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-sse";
    // Bind secret for use in the handler below.
    const secret = process.env.JWT_SECRET;

    // Bind ticket for use in the handler below.
    const ticket = jwt.sign(
      {
        // Provide purpose for the object/call below.
        purpose: SSE_TICKET_PURPOSE,
        // Provide userId for the object/call below.
        userId: "u1",
        // Provide employeeId for the object/call below.
        employeeId: "e1",
        // Provide role for the object/call below.
        role: Role.owner,
        // Provide email for the object/call below.
        email: "owner@example.com",
        // Provide sid for the object/call below.
        sid: "sess-revoked",
      },
      // Pass secret through.
      secret,
      // Arrange or act for this test case.
      { expiresIn: SSE_TICKET_EXPIRES_SEC },
    );

    // Await async work into user.
    const user = await resolveSseTicketUser(ticket, async () => {
      // Abort with an application/HTTP error.
      throw new AppError(401, "unauthorized", "Session revoked");
    });

    // Assert expected outcome for this case.
    assert.equal(user, null);
  });

  // Single test case asserting expected behavior.
  it("returns null for non-sse access tokens", async () => {
    // Arrange or act for this test case.
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-sse";
    // Bind secret for use in the handler below.
    const secret = process.env.JWT_SECRET;

    // Bind access for use in the handler below.
    const access = jwt.sign(
      {
        // Provide userId for the object/call below.
        userId: "u1",
        // Provide employeeId for the object/call below.
        employeeId: "e1",
        // Provide role for the object/call below.
        role: Role.manager,
        // Provide email for the object/call below.
        email: "m@example.com",
        // Provide sid for the object/call below.
        sid: "sess-1",
      },
      // Pass secret through.
      secret,
      // Arrange or act for this test case.
      { expiresIn: "15m" },
    );

    // Mutable assertCalled updated as the flow proceeds.
    let assertCalled = false;
    // Await async work into user.
    const user = await resolveSseTicketUser(access, async () => {
      // Arrange or act for this test case.
      assertCalled = true;
      // Abort with an application/HTTP error.
      throw new Error("should not be called");
    });

    // Assert expected outcome for this case.
    assert.equal(user, null);
    // Assert expected outcome for this case.
    assert.equal(assertCalled, false);
  });
});
