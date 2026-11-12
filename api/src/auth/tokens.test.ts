// Strict assertions for HS256 algorithm pinning on access JWTs.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
// Used to craft HS384 tokens that verifyAccessToken must reject.
import jwt from "jsonwebtoken";
// Access-token helpers under test.
import {
  ACCESS_JWT_ALGORITHMS,
  signAccessToken,
  verifyAccessToken,
} from "./tokens";

describe("access JWT algorithm pin", () => {
  // Preserve prior JWT_SECRET so other suites are unaffected.
  const prev = process.env.JWT_SECRET;

  // Happy path: signed tokens use HS256 and round-trip claims.
  it("signs and verifies with HS256", () => {
    // Pass process.env.JWT_SECRET prop/value into the element or config.
    process.env.JWT_SECRET = "test-secret-for-jwt-alg-pin-at-least-32-chars";
    try {
      const token = signAccessToken({
        userId: "u1",
        employeeId: "e1",
        role: "technician",
        email: "t@example.com",
        sid: "s1",
      });
      // Decode header only to assert the algorithm claim.
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

  // alg:none must never verify even if the payload looks valid.
  it("rejects tokens whose header claims a disallowed algorithm", () => {
    // Pass process.env.JWT_SECRET prop/value into the element or config.
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

  // Even a correctly signed HS384 token is refused by the algorithm allowlist.
  it("rejects HS384 even when signed with the same secret", () => {
    // Pass process.env.JWT_SECRET prop/value into the element or config.
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
