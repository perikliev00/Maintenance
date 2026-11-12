// Import module node:assert/strict for this service.
import assert from "node:assert/strict";
// Import module node:test for this service.
import { describe, it } from "node:test";
// Import module ./settings for this service.
import { getSystemStatus, safeEntityCount } from "./settings";

// Run next step: describe("safeEntityCount", () => {
describe("safeEntityCount", () => {
  // Run next step: it("returns the count when the query succeeds", async () => …
  it("returns the count when the query succeeds", async () => {
    // Run next step: assert.equal(await safeEntityCount(async () => 7), 7);
    assert.equal(await safeEntityCount(async () => 7), 7);
    // Run next step: assert.equal(await safeEntityCount(async () => 0), 0);
    assert.equal(await safeEntityCount(async () => 0), 0);
  });

  // Run next step: it("returns null instead of throwing when a count query fail…
  it("returns null instead of throwing when a count query fails", async () => {
    // Run next step: assert.equal(
    assert.equal(
      // Wait for the async step before continuing.
      await safeEntityCount(async () => {
        // Abort with an error so callers can react.
        throw new Error("db down");
      }),
      // Run next step: null,
      null,
    );
  });
});

// Run next step: describe("getSystemStatus failure isolation", () => {
describe("getSystemStatus failure isolation", () => {
  // Run next step: it("keeps other counts when one count runner fails", async (…
  it("keeps other counts when one count runner fails", async () => {
    // Load status asynchronously for the next steps.
    const status = await getSystemStatus({
      // Set ping on the structure being built.
      ping: async () => {},
      // Set counts on the structure being built.
      counts: {
        // Set rooms on the structure being built.
        rooms: async () => 11,
        // Set commonAreas on the structure being built.
        commonAreas: async () => {
          // Abort with an error so callers can react.
          throw new Error("rooms catalog unavailable");
        },
        // Set openTickets on the structure being built.
        openTickets: async () => 3,
        // Set runningSessions on the structure being built.
        runningSessions: async () => 1,
      },
    });
    // Run next step: assert.equal(status.api.ok, true);
    assert.equal(status.api.ok, true);
    // Run next step: assert.equal(status.database.ok, true);
    assert.equal(status.database.ok, true);
    // Run next step: assert.equal(status.counts.rooms, 11);
    assert.equal(status.counts.rooms, 11);
    // Run next step: assert.equal(status.counts.commonAreas, null);
    assert.equal(status.counts.commonAreas, null);
    // Run next step: assert.equal(status.counts.openTickets, 3);
    assert.equal(status.counts.openTickets, 3);
    // Run next step: assert.equal(status.counts.runningSessions, 1);
    assert.equal(status.counts.runningSessions, 1);
  });

  // Run next step: it("returns DOWN db with null counts when ping fails and cou…
  it("returns DOWN db with null counts when ping fails and counts fail", async () => {
    // Load status asynchronously for the next steps.
    const status = await getSystemStatus({
      // Set ping on the structure being built.
      ping: async () => {
        // Abort with an error so callers can react.
        throw new Error("connection refused");
      },
      // Set counts on the structure being built.
      counts: {
        // Set rooms on the structure being built.
        rooms: async () => {
          // Abort with an error so callers can react.
          throw new Error("down");
        },
        // Set commonAreas on the structure being built.
        commonAreas: async () => {
          // Abort with an error so callers can react.
          throw new Error("down");
        },
        // Set openTickets on the structure being built.
        openTickets: async () => {
          // Abort with an error so callers can react.
          throw new Error("down");
        },
        // Set runningSessions on the structure being built.
        runningSessions: async () => {
          // Abort with an error so callers can react.
          throw new Error("down");
        },
      },
    });
    // Run next step: assert.equal(status.api.ok, true);
    assert.equal(status.api.ok, true);
    // Run next step: assert.equal(status.database.ok, false);
    assert.equal(status.database.ok, false);
    // Run next step: assert.equal(status.counts.rooms, null);
    assert.equal(status.counts.rooms, null);
    // Run next step: assert.equal(status.counts.commonAreas, null);
    assert.equal(status.counts.commonAreas, null);
    // Run next step: assert.equal(status.counts.openTickets, null);
    assert.equal(status.counts.openTickets, null);
    // Run next step: assert.equal(status.counts.runningSessions, null);
    assert.equal(status.counts.runningSessions, null);
  });
});
