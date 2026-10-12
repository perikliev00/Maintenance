import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { postJsonWithSessionRefresh } from "./transport";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("postJsonWithSessionRefresh", () => {
  it("401 → successful refresh → retries same body and returns 200", async () => {
    const commandId = "11111111-1111-1111-1111-111111111111";
    const bodies: string[] = [];
    let refreshCalls = 0;
    let call = 0;

    const data = await postJsonWithSessionRefresh(
      "/api/cleaning/tasks/t1/start",
      { commandId, expectedVersion: 1 },
      {
        fetchFn: async (_url, init) => {
          bodies.push(String(init?.body ?? ""));
          call += 1;
          if (call === 1) return jsonResponse(401, { error: "unauthorized" });
          return jsonResponse(200, { ok: true, commandId });
        },
        refreshFn: async () => {
          refreshCalls += 1;
          return "refreshed";
        },
        headersFn: () => ({ "Content-Type": "application/json", "X-CSRF-Token": "csrf" }),
      },
    );

    assert.equal(refreshCalls, 1);
    assert.equal(call, 2);
    assert.equal(bodies[0], bodies[1]);
    assert.ok(bodies[0]!.includes(commandId));
    assert.deepEqual(data, { ok: true, commandId });
  });

  it("parallel 401s share one refresh", async () => {
    let refreshCalls = 0;
    let inflight: Promise<"refreshed"> | null = null;
    const refreshFn = async () => {
      if (inflight) return inflight;
      refreshCalls += 1;
      inflight = (async () => {
        await new Promise((r) => setTimeout(r, 20));
        return "refreshed" as const;
      })();
      try {
        return await inflight;
      } finally {
        inflight = null;
      }
    };

    const makeFetch = () => {
      let n = 0;
      return async () => {
        n += 1;
        if (n === 1) return jsonResponse(401, { error: "unauthorized" });
        return jsonResponse(200, { ok: true });
      };
    };

    await Promise.all([
      postJsonWithSessionRefresh("/a", { commandId: "a" }, {
        fetchFn: makeFetch(),
        refreshFn,
        headersFn: () => ({}),
      }),
      postJsonWithSessionRefresh("/b", { commandId: "b" }, {
        fetchFn: makeFetch(),
        refreshFn,
        headersFn: () => ({}),
      }),
    ]);

    assert.equal(refreshCalls, 1);
  });

  it("failed refresh keeps throwing 401 (caller keeps outbox)", async () => {
    await assert.rejects(
      () =>
        postJsonWithSessionRefresh(
          "/api/x",
          { commandId: "c" },
          {
            fetchFn: async () => jsonResponse(401, { error: "unauthorized" }),
            refreshFn: async () => "rejected",
            headersFn: () => ({}),
          },
        ),
      (err: unknown) =>
        err instanceof Error &&
        (err as Error & { status?: number }).status === 401,
    );
  });

  it("network errors remain queueable (no status)", async () => {
    await assert.rejects(
      () =>
        postJsonWithSessionRefresh(
          "/api/x",
          { commandId: "c" },
          {
            fetchFn: async () => {
              throw Object.assign(new Error("Network error"), {
                status: undefined,
              });
            },
            refreshFn: async () => "refreshed",
            headersFn: () => ({}),
          },
        ),
      (err: unknown) =>
        err instanceof Error &&
        (err as Error & { status?: number }).status === undefined,
    );
  });
});
