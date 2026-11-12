/**
 * Contract smoke for notifications cursor paging.
 * Ensures listNotifications forwards cursor/limit so the inbox can load-more.
 */
import assert from "node:assert/strict";
// Import dependency used by this module.
import { afterEach, describe, it } from "node:test";
// Import dependency used by this module.
import { listNotifications } from "./notificationsApi";

// Local constant binding.
const originalFetch = globalThis.fetch;

// Test lifecycle hook.
afterEach(() => {
  // Assign value for subsequent use.
  globalThis.fetch = originalFetch;
});

// Group related unit tests.
describe("listNotifications cursor contract", () => {
  // Unit test case.
  it("forwards limit and cursor query params", async () => {
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
          items: [{ id: "n2", unread: false }],
          // Field/property in this shape.
          nextCursor: null,
        }),
        // Continue multi-line list/arguments.
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    // Close multi-line construct with trailing syntax.
    }) as typeof fetch;

    // Local constant binding.
    const res = await listNotifications({ limit: 50, cursor: "cursor-abc" });
    // Assert expected test outcome.
    assert.match(seenUrl, /limit=50/);
    // Assert expected test outcome.
    assert.match(seenUrl, /cursor=cursor-abc/);
    // Assert expected test outcome.
    assert.equal(res.nextCursor, null);
    // Assert expected test outcome.
    assert.equal(res.items.length, 1);
  });
});
