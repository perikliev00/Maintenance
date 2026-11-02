import assert from "node:assert/strict";
import { describe, it } from "node:test";
import jwt from "jsonwebtoken";
import {
  ACCESS_JWT_ALGORITHMS,
  signAccessToken,
  verifyAccessToken,
} from "./tokens";

describe("access JWT algorithm pin", () => {
  const prev = process.env.JWT_SECRET;

  it("signs and verifies with HS256", () => {
    process.env.JWT_SECRET = "test-secret-for-jwt-alg-pin-at-least-32-chars";
    try {
      const token = signAccessToken({
        userId: "u1",
        employeeId: "e1",
        role: "technician",
        email: "t@example.com",
        sid: "s1",
      });
      const header = JSON.parse(
        Buffer.from(token.split(".")[0]!, "base64url").toString("utf8"),
      ) as { alg?: string };
      assert.equal(header.alg, "HS256");
      assert.deepEqual([...ACCESS_JWT_ALGORITHMS], ["HS256"]);
      const user = verifyAccessToken(token);
      assert.equal(user.userId, "u1");
      assert.equal(user.sid, "s1");
    } finally {
      process.env.JWT_SECRET = prev;
    }
  });

  it("rejects tokens whose header claims a disallowed algorithm", () => {
    process.env.JWT_SECRET = "test-secret-for-jwt-alg-pin-at-least-32-chars";
    try {
      // Craft an unsigned "none" token — verify must refuse it.
      const header = Buffer.from(
        JSON.stringify({ alg: "none", typ: "JWT" }),
      ).toString("base64url");
      const body = Buffer.from(
        JSON.stringify({
          userId: "u1",
          employeeId: "e1",
          role: "technician",
          email: "t@example.com",
          sid: "s1",
        }),
      ).toString("base64url");
      const forged = `${header}.${body}.`;
      assert.throws(() => verifyAccessToken(forged));
    } finally {
      process.env.JWT_SECRET = prev;
    }
  });

  it("rejects HS384 even when signed with the same secret", () => {
    process.env.JWT_SECRET = "test-secret-for-jwt-alg-pin-at-least-32-chars";
    try {
      const token = jwt.sign(
        {
          userId: "u1",
          employeeId: "e1",
          role: "technician",
          email: "t@example.com",
          sid: "s1",
        },
        process.env.JWT_SECRET,
        { algorithm: "HS384", expiresIn: "15m" },
      );
      assert.throws(() => verifyAccessToken(token));
    } finally {
      process.env.JWT_SECRET = prev;
    }
  });
});
