// Strict assertions for HS256 algorithm pinning on access JWTs.
import assert from "node:assert/strict";
// Node test runner suite helpers.
import { describe, it } from "node:test";
// Used to craft HS384 tokens that verifyAccessToken must reject.
import jwt from "jsonwebtoken";
// Access-token helpers under test.
import {
  // Support the surrounding logic for this step.
  ACCESS_JWT_ALGORITHMS,
  // Support the surrounding logic for this step.
  signAccessToken,
  // Support the surrounding logic for this step.
  verifyAccessToken,
// Support the surrounding logic for this step.
} from "./tokens";

// Group related tests under a shared suite name.
describe("access JWT algorithm pin", () => {
  // Preserve prior JWT_SECRET so other suites are unaffected.
  const prev = process.env.JWT_SECRET;

  // Happy path: signed tokens use HS256 and round-trip claims.
  it("signs and verifies with HS256", () => {
    // Pass process.env.JWT_SECRET prop/value into the element or config.
    process.env.JWT_SECRET = "test-secret-for-jwt-alg-pin-at-least-32-chars";
    // Begin guarded block to catch runtime failures.
    try {
      // Bind token for use in the following logic.
      const token = signAccessToken({
        // Provide userId field used by this structure.
        userId: "u1",
        // Provide employeeId field used by this structure.
        employeeId: "e1",
        // Provide role field used by this structure.
        role: "technician",
        // Provide email field used by this structure.
        email: "t@example.com",
        // Provide sid field used by this structure.
        sid: "s1",
      });
      // Decode header only to assert the algorithm claim.
      const header = JSON.parse(
        // Invoke Buffer.from to perform this step.
        Buffer.from(token.split(".")[0]!, "base64url").toString("utf8"),
      // Support the surrounding logic for this step.
      ) as { alg?: string };
      // Invoke assert.equal to perform this step.
      assert.equal(header.alg, "HS256");
      // Invoke assert.deepEqual to perform this step.
      assert.deepEqual([...ACCESS_JWT_ALGORITHMS], ["HS256"]);
      // Bind user for use in the following logic.
      const user = verifyAccessToken(token);
      // Invoke assert.equal to perform this step.
      assert.equal(user.userId, "u1");
      // Invoke assert.equal to perform this step.
      assert.equal(user.sid, "s1");
    // Support the surrounding logic for this step.
    } finally {
      // Support the surrounding logic for this step.
      process.env.JWT_SECRET = prev;
    }
  });

  // alg:none must never verify even if the payload looks valid.
  it("rejects tokens whose header claims a disallowed algorithm", () => {
    // Pass process.env.JWT_SECRET prop/value into the element or config.
    process.env.JWT_SECRET = "test-secret-for-jwt-alg-pin-at-least-32-chars";
    // Begin guarded block to catch runtime failures.
    try {
      // Craft an unsigned "none" token — verify must refuse it.
      const header = Buffer.from(
        // Invoke JSON.stringify to perform this step.
        JSON.stringify({ alg: "none", typ: "JWT" }),
      // Support the surrounding logic for this step.
      ).toString("base64url");
      // Bind body for use in the following logic.
      const body = Buffer.from(
        // Invoke JSON.stringify to perform this step.
        JSON.stringify({
          // Provide userId field used by this structure.
          userId: "u1",
          // Provide employeeId field used by this structure.
          employeeId: "e1",
          // Provide role field used by this structure.
          role: "technician",
          // Provide email field used by this structure.
          email: "t@example.com",
          // Provide sid field used by this structure.
          sid: "s1",
        }),
      // Support the surrounding logic for this step.
      ).toString("base64url");
      // Bind forged for use in the following logic.
      const forged = `${header}.${body}.`;
      // Invoke assert.throws to perform this step.
      assert.throws(() => verifyAccessToken(forged));
    // Support the surrounding logic for this step.
    } finally {
      // Support the surrounding logic for this step.
      process.env.JWT_SECRET = prev;
    }
  });

  // Even a correctly signed HS384 token is refused by the algorithm allowlist.
  it("rejects HS384 even when signed with the same secret", () => {
    // Pass process.env.JWT_SECRET prop/value into the element or config.
    process.env.JWT_SECRET = "test-secret-for-jwt-alg-pin-at-least-32-chars";
    // Begin guarded block to catch runtime failures.
    try {
      // Bind token for use in the following logic.
      const token = jwt.sign(
        {
          // Provide userId field used by this structure.
          userId: "u1",
          // Provide employeeId field used by this structure.
          employeeId: "e1",
          // Provide role field used by this structure.
          role: "technician",
          // Provide email field used by this structure.
          email: "t@example.com",
          // Provide sid field used by this structure.
          sid: "s1",
        },
        // Support the surrounding logic for this step.
        process.env.JWT_SECRET,
        // Support the surrounding logic for this step.
        { algorithm: "HS384", expiresIn: "15m" },
      );
      // Invoke assert.throws to perform this step.
      assert.throws(() => verifyAccessToken(token));
    // Support the surrounding logic for this step.
    } finally {
      // Support the surrounding logic for this step.
      process.env.JWT_SECRET = prev;
    }
  });
});
