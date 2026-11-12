/**
 * Contract smoke for maintenance ticket cursor paging on Repairs.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { fetchTickets } from "./maintenanceApi";

const originalFetch = globalThis.fetch;

// Test lifecycle hook.
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchTickets pagination contract", () => {
  it("legacy calls omit paginated and return an array", async () => {
    let seenUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seenUrl = String(input);
      return new Response(JSON.stringify([{ id: "t1" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const rows = await fetchTickets({ limit: 20, status: "open" });
    assert.match(seenUrl, /limit=20/);
    assert.doesNotMatch(seenUrl, /paginated=/);
    assert.ok(Array.isArray(rows));
    assert.equal(rows.length, 1);
  });

  it("forwards paginated cursor params and returns the page envelope", async () => {
    let seenUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seenUrl = String(input);
      return new Response(
        JSON.stringify({
          items: [{ id: "t2" }],
          nextCursor: "cursor-next",
          total: 120,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const page = await fetchTickets({
      limit: 50,
      status: "open",
      paginated: true,
      cursor: "cursor-abc",
      slaBreached: true,
      blocksRoom: true,
    });
    assert.match(seenUrl, /limit=50/);
    assert.match(seenUrl, /paginated=1/);
    assert.match(seenUrl, /cursor=cursor-abc/);
    assert.match(seenUrl, /slaBreached=1/);
    assert.match(seenUrl, /blocksRoom=1/);
    assert.equal(page.total, 120);
    assert.equal(page.nextCursor, "cursor-next");
    assert.equal(page.items.length, 1);
  });

  it("forwards mine and assigneeId filters with pagination", async () => {
    let seenUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seenUrl = String(input);
      return new Response(
        JSON.stringify({ items: [], nextCursor: null, total: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    await fetchTickets({
      paginated: true,
      limit: 50,
      status: "open",
      mine: true,
    });
    assert.match(seenUrl, /mine=1/);

    await fetchTickets({
      paginated: true,
      limit: 50,
      status: "open",
      assigneeId: "emp-9",
    });
    assert.match(seenUrl, /assigneeId=emp-9/);
  });
});
