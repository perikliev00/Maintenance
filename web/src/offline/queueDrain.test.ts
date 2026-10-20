import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { setDraining } from "./connState";
import { drainQueue } from "./queueDrain";
import {
  getOfflineUser,
  isOfflineSwitching,
  setOfflineUser,
  whenOfflineUserSettled,
} from "./userScope";
import type { QueuedAction } from "./storage";

function pendingRow(userId: string): QueuedAction {
  const now = Date.now();
  return {
    id: `q-${userId}-1`,
    userId,
    commandId: "11111111-1111-4111-8111-111111111111",
    type: "ticket.report",
    url: "/maintenance/tickets",
    method: "POST",
    body: { title: "t" },
    createdAt: now,
    updatedAt: now,
    status: "pending",
    lastError: null,
    conflictCode: null,
    conflictMessage: null,
    conflictDetails: null,
    retries: 0,
  };
}

describe("T-DRAIN-01 mid-drain account switch", () => {
  const originalOnline = navigator.onLine;

  afterEach(async () => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: originalOnline,
    });
    setDraining(false);
    setOfflineUser(null);
    await whenOfflineUserSettled();
  });

  /** Bind user while offline so setOfflineUser does not kick a real drain. */
  async function bindUserOffline(userId: string) {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });
    setOfflineUser(userId);
    await whenOfflineUserSettled();
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
    setDraining(false);
  }

  it("aborts with zero network sends when user switches after claim", async () => {
    const store = new Map<string, QueuedAction>();
    const row = pendingRow("A");
    store.set(row.id, row);

    await bindUserOffline("A");
    assert.equal(getOfflineUser(), "A");

    let networkCalls = 0;

    await drainQueue({
      listQueueForUserFn: async (userId) =>
        [...store.values()].filter((r) => r.userId === userId),
      putQueuedActionFn: async (r) => {
        store.set(r.id, r);
      },
      deleteQueuedActionFn: async (id) => {
        store.delete(id);
      },
      fetchFn: async () => {
        networkCalls += 1;
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      },
      postJsonFn: async () => {
        networkCalls += 1;
      },
      headersFn: () => ({ "Content-Type": "application/json" }),
      afterClaim: async () => {
        setOfflineUser("B");
        assert.equal(isOfflineSwitching(), true, "switch must block sends before its first microtask");
        await whenOfflineUserSettled();
        assert.equal(getOfflineUser(), "B");
      },
    });

    assert.equal(networkCalls, 0);
    // In-memory store: drain itself must not delete/reassign after abort.
    // Real logout/account switch also purges IndexedDB (covered by e2e).
    const kept = store.get(row.id);
    assert.ok(kept, "user A row must remain in the outbox after abort");
    assert.equal(kept.userId, "A");
    assert.equal(kept.commandId, row.commandId);
    assert.equal(kept.status, "sending");
  });

  it("sends once when identity stays bound (deps wire control)", async () => {
    const store = new Map<string, QueuedAction>();
    const row = pendingRow("A");
    store.set(row.id, row);

    await bindUserOffline("A");

    let networkCalls = 0;

    await drainQueue({
      listQueueForUserFn: async (userId) =>
        [...store.values()].filter((r) => r.userId === userId),
      putQueuedActionFn: async (r) => {
        store.set(r.id, r);
      },
      deleteQueuedActionFn: async (id) => {
        store.delete(id);
      },
      fetchFn: async () => {
        networkCalls += 1;
        return new Response(
          JSON.stringify({
            results: [
              {
                commandId: row.commandId,
                status: "ok",
              },
            ],
          }),
          { status: 200 },
        );
      },
      headersFn: () => ({ "Content-Type": "application/json" }),
    });

    assert.equal(networkCalls, 1);
  });

  for (const fallback of [false, true]) {
    for (const switchBack of [false, true]) {
      it(`P0-10 ${fallback ? "fallback" : "batch"} does not retry after pending refresh and A→B${switchBack ? "→A" : ""}`, async () => {
        const row = pendingRow("A");
        const store = new Map([[row.id, row]]);
        await bindUserOffline("A");
        let enterRefresh!: () => void;
        const entered = new Promise<void>(resolve => { enterRefresh = resolve; });
        let finishRefresh!: () => void;
        const pendingRefresh = new Promise<void>(resolve => { finishRefresh = resolve; });
        const sends: Array<{ url: string; userId: string | null }> = [];
        let deletions = 0;
        const draining = drainQueue({
          listQueueForUserFn: async id => [...store.values()].filter(r => r.userId === id),
          putQueuedActionFn: async r => { store.set(r.id, r); },
          deleteQueuedActionFn: async id => { deletions++; store.delete(id); },
          headersFn: () => ({}),
          fetchFn: async url => {
            sends.push({ url, userId: getOfflineUser() });
            return new Response("{}", { status: fallback && url.endsWith("/sync/push") ? 501 : 401 });
          },
          refreshFn: async () => { enterRefresh(); await pendingRefresh; return "refreshed"; },
        });
        await entered;
        await bindUserOffline("B");
        if (switchBack) await bindUserOffline("A");
        finishRefresh();
        await draining;
        assert.equal(sends.length, fallback ? 2 : 1, "no retry or fallback send after identity transition");
        assert.ok(sends.every(send => send.userId === "A"));
        assert.equal(deletions, 0, "stale completion must not consume the original command");
        assert.deepEqual(store.get(row.id), { ...row, status: "sending", updatedAt: store.get(row.id)!.updatedAt });
      });
    }
  }

  it("P0-10 unchanged binding retries successful refresh and consumes the same command", async () => {
    const row = pendingRow("A");
    const store = new Map([[row.id, row]]);
    await bindUserOffline("A");
    const bodies: string[] = [];
    await drainQueue({
      listQueueForUserFn: async () => [...store.values()],
      putQueuedActionFn: async r => { store.set(r.id, r); },
      deleteQueuedActionFn: async id => { store.delete(id); },
      headersFn: () => ({}),
      fetchFn: async (_url, init) => {
        assert.equal(new Headers(init.headers).get("X-Offline-User"), "A");
        bodies.push(String(init.body));
        return new Response(JSON.stringify({ results: [{ commandId: row.commandId, status: "ok" }] }), { status: bodies.length === 1 ? 401 : 200 });
      },
      refreshFn: async () => "refreshed",
    });
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0], bodies[1]);
    assert.equal(store.size, 0);
  });
});
