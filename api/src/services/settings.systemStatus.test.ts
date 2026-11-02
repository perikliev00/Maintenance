import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getSystemStatus, safeEntityCount } from "./settings";

describe("safeEntityCount", () => {
  it("returns the count when the query succeeds", async () => {
    assert.equal(await safeEntityCount(async () => 7), 7);
    assert.equal(await safeEntityCount(async () => 0), 0);
  });

  it("returns null instead of throwing when a count query fails", async () => {
    assert.equal(
      await safeEntityCount(async () => {
        throw new Error("db down");
      }),
      null,
    );
  });
});

describe("getSystemStatus failure isolation", () => {
  it("keeps other counts when one count runner fails", async () => {
    const status = await getSystemStatus({
      ping: async () => {},
      counts: {
        rooms: async () => 11,
        commonAreas: async () => {
          throw new Error("rooms catalog unavailable");
        },
        openTickets: async () => 3,
        runningSessions: async () => 1,
      },
    });
    assert.equal(status.api.ok, true);
    assert.equal(status.database.ok, true);
    assert.equal(status.counts.rooms, 11);
    assert.equal(status.counts.commonAreas, null);
    assert.equal(status.counts.openTickets, 3);
    assert.equal(status.counts.runningSessions, 1);
  });

  it("returns DOWN db with null counts when ping fails and counts fail", async () => {
    const status = await getSystemStatus({
      ping: async () => {
        throw new Error("connection refused");
      },
      counts: {
        rooms: async () => {
          throw new Error("down");
        },
        commonAreas: async () => {
          throw new Error("down");
        },
        openTickets: async () => {
          throw new Error("down");
        },
        runningSessions: async () => {
          throw new Error("down");
        },
      },
    });
    assert.equal(status.api.ok, true);
    assert.equal(status.database.ok, false);
    assert.equal(status.counts.rooms, null);
    assert.equal(status.counts.commonAreas, null);
    assert.equal(status.counts.openTickets, null);
    assert.equal(status.counts.runningSessions, null);
  });
});
