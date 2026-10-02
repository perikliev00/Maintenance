import assert from "node:assert/strict";
import { describe, it } from "node:test";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";

/**
 * Mirrors api/src/routes/events.ts ticket contract without booting Express/DB.
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
