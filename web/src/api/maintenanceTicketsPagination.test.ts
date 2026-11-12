/**
 * Contract smoke for maintenance ticket cursor paging on Repairs.
 */
import assert from "node:assert/strict";
// Import dependency used by this module.
import { afterEach, describe, it } from "node:test";
// Import dependency used by this module.
import { fetchTickets } from "./maintenanceApi";

// Local constant binding.
const originalFetch = globalThis.fetch;

// Test lifecycle hook.
afterEach(() => {
  // Assign value for subsequent use.
  globalThis.fetch = originalFetch;
});

// Group related unit tests.
describe("fetchTickets pagination contract", () => {
  // Unit test case.
  it("legacy calls omit paginated and return an array", async () => {
    // Mutable local binding.
    let seenUrl = "";
    // Arrow function / callback body.
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      // Assign value for subsequent use.
      seenUrl = String(input);
      // Return computed result to caller.
      return new Response(JSON.stringify([{ id: "t1" }]), {
        // Field/property in this shape.
        status: 200,
        // Field/property in this shape.
        headers: { "Content-Type": "application/json" },
      });
    // Close multi-line construct with trailing syntax.
    }) as typeof fetch;

    // Local constant binding.
    const rows = await fetchTickets({ limit: 20, status: "open" });
    // Assert expected test outcome.
    assert.match(seenUrl, /limit=20/);
    // Assert expected test outcome.
    assert.doesNotMatch(seenUrl, /paginated=/);
    // Assert expected test outcome.
    assert.ok(Array.isArray(rows));
    // Assert expected test outcome.
    assert.equal(rows.length, 1);
  });

  // Unit test case.
  it("forwards paginated cursor params and returns the page envelope", async () => {
    // Mutable local binding.
    let seenUrl = "";
    // Arrow function / callback body.
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      // Assign value for subsequent use.
      seenUrl = String(input);
      // Return computed result to caller.
      return new Response(
        // Open multi-line construct.
        JSON.stringify({
          // Field/property in this shape.
          items: [{ id: "t2" }],
          // Field/property in this shape.
          nextCursor: "cursor-next",
          // Field/property in this shape.
          total: 120,
        }),
        // Continue multi-line list/arguments.
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    // Close multi-line construct with trailing syntax.
    }) as typeof fetch;

    // Local constant binding.
    const page = await fetchTickets({
      // Field/property in this shape.
      limit: 50,
      // Field/property in this shape.
      status: "open",
      // Field/property in this shape.
      paginated: true,
      // Field/property in this shape.
      cursor: "cursor-abc",
      // Field/property in this shape.
      slaBreached: true,
      // Field/property in this shape.
      blocksRoom: true,
    });
    // Assert expected test outcome.
    assert.match(seenUrl, /limit=50/);
    // Assert expected test outcome.
    assert.match(seenUrl, /paginated=1/);
    // Assert expected test outcome.
    assert.match(seenUrl, /cursor=cursor-abc/);
    // Assert expected test outcome.
    assert.match(seenUrl, /slaBreached=1/);
    // Assert expected test outcome.
    assert.match(seenUrl, /blocksRoom=1/);
    // Assert expected test outcome.
    assert.equal(page.total, 120);
    // Assert expected test outcome.
    assert.equal(page.nextCursor, "cursor-next");
    // Assert expected test outcome.
    assert.equal(page.items.length, 1);
  });

  // Unit test case.
  it("forwards mine and assigneeId filters with pagination", async () => {
    // Mutable local binding.
    let seenUrl = "";
    // Arrow function / callback body.
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      // Assign value for subsequent use.
      seenUrl = String(input);
      // Return computed result to caller.
      return new Response(
        // Invoke helper or pass arguments.
        JSON.stringify({ items: [], nextCursor: null, total: 0 }),
        // Continue multi-line list/arguments.
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    // Close multi-line construct with trailing syntax.
    }) as typeof fetch;

    // Await async work before continuing.
    await fetchTickets({
      // Field/property in this shape.
      paginated: true,
      // Field/property in this shape.
      limit: 50,
      // Field/property in this shape.
      status: "open",
      // Field/property in this shape.
      mine: true,
    });
    // Assert expected test outcome.
    assert.match(seenUrl, /mine=1/);

    // Await async work before continuing.
    await fetchTickets({
      // Field/property in this shape.
      paginated: true,
      // Field/property in this shape.
      limit: 50,
      // Field/property in this shape.
      status: "open",
      // Field/property in this shape.
      assigneeId: "emp-9",
    });
    // Assert expected test outcome.
    assert.match(seenUrl, /assigneeId=emp-9/);
  });
});
