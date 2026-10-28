import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Mirrors LocationsPage refresh revision gating: a slower earlier response
 * must not overwrite a newer one.
 */
async function runRefreshSequence() {
  let revision = 0;
  let locations: string[] = [];

  async function refresh(label: string, delayMs: number) {
    const mine = ++revision;
    await new Promise((r) => setTimeout(r, delayMs));
    if (mine !== revision) return;
    locations = [label];
  }

  await Promise.all([refresh("stale", 40), refresh("fresh", 10)]);
  return locations;
}

describe("refresh revision race", () => {
  it("keeps the newest successful refresh payload", async () => {
    const locations = await runRefreshSequence();
    assert.deepEqual(locations, ["fresh"]);
  });
});
