// Import dependency used by this module.
import assert from "node:assert/strict";
// Import dependency used by this module.
import { describe, it } from "node:test";
// Import dependency used by this module.
import { postJsonWithSessionRefresh } from "./transport";

// Function definition.
function jsonResponse(status: number, body: unknown): Response {
  // Return computed result to caller.
  return new Response(JSON.stringify(body), {
    // List item in import/export/params.
    status,
    // Field/property in this shape.
    headers: { "Content-Type": "application/json" },
  });
}

// Group related unit tests.
describe("postJsonWithSessionRefresh", () => {
  // Unit test case.
  it("401 → successful refresh → retries same body and returns 200", async () => {
    // Local constant binding.
    const commandId = "11111111-1111-1111-1111-111111111111";
    // Local constant binding.
    const bodies: string[] = [];
    // Mutable local binding.
    let refreshCalls = 0;
    // Mutable local binding.
    let call = 0;

    // Local constant binding.
    const data = await postJsonWithSessionRefresh(
      // Continue multi-line list/arguments.
      "/api/cleaning/tasks/t1/start",
      // Continue multi-line list/arguments.
      { commandId, expectedVersion: 1 },
      {
        // Arrow function / callback body.
        fetchFn: async (_url, init) => {
          // Invoke helper or pass arguments.
          bodies.push(String(init?.body ?? ""));
          // Assign value for subsequent use.
          call += 1;
          // Conditional branch for this case.
          if (call === 1) return jsonResponse(401, { error: "unauthorized" });
          // Return computed result to caller.
          return jsonResponse(200, { ok: true, commandId });
        },
        // Arrow function / callback body.
        refreshFn: async () => {
          // Assign value for subsequent use.
          refreshCalls += 1;
          // Return computed result to caller.
          return "refreshed";
        },
        // Arrow function / callback body.
        headersFn: () => ({ "Content-Type": "application/json", "X-CSRF-Token": "csrf" }),
      },
    );

    // Assert expected test outcome.
    assert.equal(refreshCalls, 1);
    // Assert expected test outcome.
    assert.equal(call, 2);
    // Assert expected test outcome.
    assert.equal(bodies[0], bodies[1]);
    // Assert expected test outcome.
    assert.ok(bodies[0]!.includes(commandId));
    // Assert expected test outcome.
    assert.deepEqual(data, { ok: true, commandId });
  });

  // Unit test case.
  it("parallel 401s share one refresh", async () => {
    // Mutable local binding.
    let refreshCalls = 0;
    // Mutable local binding.
    let inflight: Promise<"refreshed"> | null = null;
    // Async const function binding.
    const refreshFn = async () => {
      // Conditional branch for this case.
      if (inflight) return inflight;
      // Assign value for subsequent use.
      refreshCalls += 1;
      // Arrow function / callback body.
      inflight = (async () => {
        // Await async work before continuing.
        await new Promise((r) => setTimeout(r, 20));
        // Return computed result to caller.
        return "refreshed" as const;
      // Invoke helper or pass arguments.
      })();
      // Guard fallible work.
      try {
        // Return computed result to caller.
        return await inflight;
      // Open multi-line construct.
      } finally {
        // Assign value for subsequent use.
        inflight = null;
      }
    };

    // Const arrow/function binding.
    const makeFetch = () => {
      // Mutable local binding.
      let n = 0;
      // Return computed result to caller.
      return async () => {
        // Assign value for subsequent use.
        n += 1;
        // Conditional branch for this case.
        if (n === 1) return jsonResponse(401, { error: "unauthorized" });
        // Return computed result to caller.
        return jsonResponse(200, { ok: true });
      };
    };

    // Await async work before continuing.
    await Promise.all([
      // Open multi-line construct.
      postJsonWithSessionRefresh("/a", { commandId: "a" }, {
        // Field/property in this shape.
        fetchFn: makeFetch(),
        // List item in import/export/params.
        refreshFn,
        // Arrow function / callback body.
        headersFn: () => ({}),
      }),
      // Open multi-line construct.
      postJsonWithSessionRefresh("/b", { commandId: "b" }, {
        // Field/property in this shape.
        fetchFn: makeFetch(),
        // List item in import/export/params.
        refreshFn,
        // Arrow function / callback body.
        headersFn: () => ({}),
      }),
    ]);

    // Assert expected test outcome.
    assert.equal(refreshCalls, 1);
  });

  // Unit test case.
  it("failed refresh keeps throwing 401 (caller keeps outbox)", async () => {
    // Await async work before continuing.
    await assert.rejects(
      // Arrow function / callback body.
      () =>
        // Open multi-line construct.
        postJsonWithSessionRefresh(
          // Continue multi-line list/arguments.
          "/api/x",
          // Continue multi-line list/arguments.
          { commandId: "c" },
          {
            // Arrow function / callback body.
            fetchFn: async () => jsonResponse(401, { error: "unauthorized" }),
            // Arrow function / callback body.
            refreshFn: async () => "rejected",
            // Arrow function / callback body.
            headersFn: () => ({}),
          },
        ),
      // Arrow function / callback body.
      (err: unknown) =>
        // Continue module logic.
        err instanceof Error &&
        // Assign value for subsequent use.
        (err as Error & { status?: number }).status === 401,
    );
  });

  // Unit test case.
  it("network errors remain queueable (no status)", async () => {
    // Await async work before continuing.
    await assert.rejects(
      // Arrow function / callback body.
      () =>
        // Open multi-line construct.
        postJsonWithSessionRefresh(
          // Continue multi-line list/arguments.
          "/api/x",
          // Continue multi-line list/arguments.
          { commandId: "c" },
          {
            // Arrow function / callback body.
            fetchFn: async () => {
              // Abort with an error for the caller.
              throw Object.assign(new Error("Network error"), {
                // Field/property in this shape.
                status: undefined,
              });
            },
            // Arrow function / callback body.
            refreshFn: async () => "refreshed",
            // Arrow function / callback body.
            headersFn: () => ({}),
          },
        ),
      // Arrow function / callback body.
      (err: unknown) =>
        // Continue module logic.
        err instanceof Error &&
        // Assign value for subsequent use.
        (err as Error & { status?: number }).status === undefined,
    );
  });
});
