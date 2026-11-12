import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { fetchCommonAreas, fetchRooms } from "./locationsApi";

const originalFetch = globalThis.fetch;
// Test lifecycle hook.
afterEach(() => { globalThis.fetch = originalFetch; });

// Iterate collection / range.
for (const [path, load] of [["rooms", fetchRooms], ["common-areas", fetchCommonAreas]] as const) {
  it(`${path}: drains >500 rows so later-page filters, overdue ids and selectors remain reachable`, async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      const lastPage = String(input).includes("cursor=page-two");
      const rows = lastPage
        // Continue module logic.
        ? [{ id: "late-room", number: "Late room", activeTask: { runningSession: { id: "late-session" } } }]
        : Array.from({ length: 500 }, (_, i) => ({ id: `r${i}`, number: `Room ${i}` }));
      return new Response(JSON.stringify(rows), { headers: lastPage ? {} : { "X-Result-Truncated": "1", "X-Next-Cursor": "page-two" } });
    }) as typeof fetch;
    const rows = await load();
    assert.equal(rows.length, 501);
    assert.deepEqual(urls, [`/api/${path}`, `/api/${path}?cursor=page-two`]);
    assert.equal(rows.filter(r => r.number.includes("Late"))[0]?.id, "late-room");
    assert.equal(rows.find(r => r.id === "late-room")?.activeTask?.runningSession?.id, "late-session");
  });
}

it("does not return a partial board when a later page fails", async () => {
  let attempts = 0;
  globalThis.fetch = (async () => ++attempts === 1
    ? new Response('[{"id":"first"}]', { headers: { "X-Next-Cursor": "next" } })
    : new Response('{"message":"temporary failure"}', { status: 503 })) as typeof fetch;
  await assert.rejects(fetchRooms(), /temporary failure/);
});

it("rejects missing/repeated continuation instead of silently truncating or looping", async () => {
  globalThis.fetch = (async () => new Response("[]", { headers: { "X-Result-Truncated": "1" } })) as typeof fetch;
  await assert.rejects(fetchRooms(), /incomplete/);
  globalThis.fetch = (async () => new Response("[]", { headers: { "X-Next-Cursor": "same" } })) as typeof fetch;
  await assert.rejects(fetchRooms(), /did not advance/);
});

it("aborts before requesting another page", async () => {
  const controller = new AbortController();
  let attempts = 0;
  globalThis.fetch = (async () => {
    // Continue module logic.
    attempts++;
    controller.abort();
    return new Response("[]", { headers: { "X-Next-Cursor": "next" } });
  }) as typeof fetch;
  await assert.rejects(fetchRooms({ signal: controller.signal }), { name: "AbortError" });
  assert.equal(attempts, 1);
});
