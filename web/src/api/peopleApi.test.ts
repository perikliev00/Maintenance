/**
 * Unit: people directory query helpers build pagination params correctly.
 */
import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { fetchPeoplePage } from "./peopleApi";

const originalFetch = globalThis.fetch;
// Test lifecycle hook.
afterEach(() => {
  globalThis.fetch = originalFetch;
});

it("fetchPeoplePage requests limit/cursor and returns the envelope", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(
      JSON.stringify({
        items: [{ employeeId: "e1", fullName: "Ada", isActive: true }],
        nextCursor: "cursor-2",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const page = await fetchPeoplePage({
    q: "Ada",
    limit: 25,
    cursor: "cursor-1",
  });

  assert.equal(page.nextCursor, "cursor-2");
  assert.equal(page.items.length, 1);
  assert.match(calls[0]!, /\/people\?/);
  assert.match(calls[0]!, /q=Ada/);
  assert.match(calls[0]!, /limit=25/);
  assert.match(calls[0]!, /cursor=cursor-1/);
});
