// Import module dependency from node:assert/strict.
import assert from "node:assert/strict";
// Import module dependency from node:test.
import { describe, it } from "node:test";

/**
 * Mirrors LocationsPage refresh revision gating: a slower earlier response
 * must not overwrite a newer one.
 */
async function runRefreshSequence() {
  // Bind revision for use in the following logic.
  let revision = 0;
  // Initialize an array used by subsequent logic.
  let locations: string[] = [];

  // Define function refresh and its behavior.
  async function refresh(label: string, delayMs: number) {
    // Bind mine for use in the following logic.
    const mine = ++revision;
    // Wait for an async operation before continuing.
    await new Promise((r) => setTimeout(r, delayMs));
    // Conditional branch for the case described by this guard.
    if (mine !== revision) return;
    // Pass locations prop/value into the element or config.
    locations = [label];
  }

  // Wait for an async operation before continuing.
  await Promise.all([refresh("stale", 40), refresh("fresh", 10)]);
  // Return early result or rendered output from this path.
  return locations;
}

// Group related tests under a shared suite name.
describe("refresh revision race", () => {
  // Define a single test case and its expectation.
  it("keeps the newest successful refresh payload", async () => {
    // Bind locations for use in the following logic.
    const locations = await runRefreshSequence();
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(locations, ["fresh"]);
  });
});
