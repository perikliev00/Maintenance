/**
 * Contract smoke for notifications cursor paging.
 * Ensures listNotifications forwards cursor/limit so the inbox can load-more.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { listNotifications } from "./notificationsApi";

const originalFetch = globalThis.fetch;

// Test lifecycle hook.
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("listNotifications cursor contract", () => {
  it("forwards limit and cursor query params", async () => {
    let seenUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seenUrl = String(input);
      return new Response(
        JSON.stringify({
          items: [{ id: "n2", unread: false }],
          nextCursor: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const res = await listNotifications({ limit: 50, cursor: "cursor-abc" });
    assert.match(seenUrl, /limit=50/);
    assert.match(seenUrl, /cursor=cursor-abc/);
    assert.equal(res.nextCursor, null);
    assert.equal(res.items.length, 1);
  });
});
