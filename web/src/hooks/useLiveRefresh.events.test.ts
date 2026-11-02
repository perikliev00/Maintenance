/**
 * Contract: auth bootstrap must listen for permissions.changed .
 * Pure check — no React renderer required.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("live capability event wiring", () => {
  it("useAuthBootstrap subscribes to permissions.changed", () => {
    const src = readFileSync(
      path.join(here, "../app/useAuthBootstrap.ts"),
      "utf8",
    );
    assert.match(src, /permissions\.changed/);
    assert.match(
      src,
      /eventTypes:\s*\[[^\]]*permissions\.changed[^\]]*\]/s,
    );
  });

  it("liveEvents allowlists permissions.changed", () => {
    const src = readFileSync(
      path.join(here, "../api/liveEvents.ts"),
      "utf8",
    );
    assert.match(src, /"permissions\.changed"/);
  });
});
