/**
 * Unit: people directory query helpers build pagination params correctly.
 */
import assert from "node:assert/strict";
// Import dependency used by this module.
import { afterEach, it } from "node:test";
// Import dependency used by this module.
import { fetchPeoplePage } from "./peopleApi";

// Local constant binding.
const originalFetch = globalThis.fetch;
// Test lifecycle hook.
afterEach(() => {
  // Assign value for subsequent use.
  globalThis.fetch = originalFetch;
});

// Unit test case.
it("fetchPeoplePage requests limit/cursor and returns the envelope", async () => {
  // Local constant binding.
  const calls: string[] = [];
  // Arrow function / callback body.
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    // Invoke helper or pass arguments.
    calls.push(String(input));
    // Return computed result to caller.
    return new Response(
      // Open multi-line construct.
      JSON.stringify({
        // Field/property in this shape.
        items: [{ employeeId: "e1", fullName: "Ada", isActive: true }],
        // Field/property in this shape.
        nextCursor: "cursor-2",
      }),
      // Continue multi-line list/arguments.
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  // Close multi-line construct with trailing syntax.
  }) as typeof fetch;

  // Local constant binding.
  const page = await fetchPeoplePage({
    // Field/property in this shape.
    q: "Ada",
    // Field/property in this shape.
    limit: 25,
    // Field/property in this shape.
    cursor: "cursor-1",
  });

  // Assert expected test outcome.
  assert.equal(page.nextCursor, "cursor-2");
  // Assert expected test outcome.
  assert.equal(page.items.length, 1);
  // Assert expected test outcome.
  assert.match(calls[0]!, /\/people\?/);
  // Assert expected test outcome.
  assert.match(calls[0]!, /q=Ada/);
  // Assert expected test outcome.
  assert.match(calls[0]!, /limit=25/);
  // Assert expected test outcome.
  assert.match(calls[0]!, /cursor=cursor-1/);
});
