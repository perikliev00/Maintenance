// Import dependency used by this module.
import assert from "node:assert/strict";
// Import dependency used by this module.
import { afterEach, it } from "node:test";
// Import dependency used by this module.
import { fetchCommonAreas, fetchRooms } from "./locationsApi";

// Local constant binding.
const originalFetch = globalThis.fetch;
// Test lifecycle hook.
afterEach(() => { globalThis.fetch = originalFetch; });

// Iterate collection / range.
for (const [path, load] of [["rooms", fetchRooms], ["common-areas", fetchCommonAreas]] as const) {
  // Unit test case.
  it(`${path}: drains >500 rows so later-page filters, overdue ids and selectors remain reachable`, async () => {
    // Local constant binding.
    const urls: string[] = [];
    // Arrow function / callback body.
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      // Invoke helper or pass arguments.
      urls.push(String(input));
      // Local constant binding.
      const lastPage = String(input).includes("cursor=page-two");
      // Local constant binding.
      const rows = lastPage
        // Continue module logic.
        ? [{ id: "late-room", number: "Late room", activeTask: { runningSession: { id: "late-session" } } }]
        // Arrow function / callback body.
        : Array.from({ length: 500 }, (_, i) => ({ id: `r${i}`, number: `Room ${i}` }));
      // Return computed result to caller.
      return new Response(JSON.stringify(rows), { headers: lastPage ? {} : { "X-Result-Truncated": "1", "X-Next-Cursor": "page-two" } });
    // Close multi-line construct with trailing syntax.
    }) as typeof fetch;
    // Local constant binding.
    const rows = await load();
    // Assert expected test outcome.
    assert.equal(rows.length, 501);
    // Assert expected test outcome.
    assert.deepEqual(urls, [`/api/${path}`, `/api/${path}?cursor=page-two`]);
    // Assert expected test outcome.
    assert.equal(rows.filter(r => r.number.includes("Late"))[0]?.id, "late-room");
    // Assert expected test outcome.
    assert.equal(rows.find(r => r.id === "late-room")?.activeTask?.runningSession?.id, "late-session");
  });
}

// Unit test case.
it("does not return a partial board when a later page fails", async () => {
  // Mutable local binding.
  let attempts = 0;
  // Arrow function / callback body.
  globalThis.fetch = (async () => ++attempts === 1
    // Invoke helper or pass arguments.
    ? new Response('[{"id":"first"}]', { headers: { "X-Next-Cursor": "next" } })
    // Invoke helper or pass arguments.
    : new Response('{"message":"temporary failure"}', { status: 503 })) as typeof fetch;
  // Await async work before continuing.
  await assert.rejects(fetchRooms(), /temporary failure/);
});

// Unit test case.
it("rejects missing/repeated continuation instead of silently truncating or looping", async () => {
  // Arrow function / callback body.
  globalThis.fetch = (async () => new Response("[]", { headers: { "X-Result-Truncated": "1" } })) as typeof fetch;
  // Await async work before continuing.
  await assert.rejects(fetchRooms(), /incomplete/);
  // Arrow function / callback body.
  globalThis.fetch = (async () => new Response("[]", { headers: { "X-Next-Cursor": "same" } })) as typeof fetch;
  // Await async work before continuing.
  await assert.rejects(fetchRooms(), /did not advance/);
});

// Unit test case.
it("aborts before requesting another page", async () => {
  // Local constant binding.
  const controller = new AbortController();
  // Mutable local binding.
  let attempts = 0;
  // Arrow function / callback body.
  globalThis.fetch = (async () => {
    // Continue module logic.
    attempts++;
    // Invoke helper or pass arguments.
    controller.abort();
    // Return computed result to caller.
    return new Response("[]", { headers: { "X-Next-Cursor": "next" } });
  // Close multi-line construct with trailing syntax.
  }) as typeof fetch;
  // Await async work before continuing.
  await assert.rejects(fetchRooms({ signal: controller.signal }), { name: "AbortError" });
  // Assert expected test outcome.
  assert.equal(attempts, 1);
});
