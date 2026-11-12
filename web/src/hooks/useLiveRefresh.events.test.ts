/**
 * Contract: auth bootstrap must listen for permissions.changed .
 * Pure check — no React renderer required.
 */
import assert from "node:assert/strict";
// Import dependency used by this module.
import { readFileSync } from "node:fs";
// Import dependency used by this module.
import path from "node:path";
// Import dependency used by this module.
import { describe, it } from "node:test";
// Import dependency used by this module.
import { fileURLToPath } from "node:url";

// Local constant binding.
const here = path.dirname(fileURLToPath(import.meta.url));

// Group related unit tests.
describe("live capability event wiring", () => {
  // Unit test case.
  it("useAuthBootstrap subscribes to permissions.changed", () => {
    // Local constant binding.
    const src = readFileSync(
      // Invoke helper or pass arguments.
      path.join(here, "../app/useAuthBootstrap.ts"),
      // Continue multi-line list/arguments.
      "utf8",
    );
    // Assert expected test outcome.
    assert.match(src, /permissions\.changed/);
    // Assert expected test outcome.
    assert.match(
      // List item in import/export/params.
      src,
      // JSX element boundary.
      /eventTypes:\s*\[[^\]]*permissions\.changed[^\]]*\]/s,
    );
  });

  // Unit test case.
  it("liveEvents allowlists permissions.changed", () => {
    // Local constant binding.
    const src = readFileSync(
      // Invoke helper or pass arguments.
      path.join(here, "../api/liveEvents.ts"),
      // Continue multi-line list/arguments.
      "utf8",
    );
    // Assert expected test outcome.
    assert.match(src, /"permissions\.changed"/);
  });
});
