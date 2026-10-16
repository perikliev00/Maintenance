import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { drainQueue } from "./queueDrain";
import {
  getOfflineUser,
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
    setOfflineUser(null);
    await whenOfflineUserSettled();
  });

  it("aborts with zero network sends when user switches after claim", async () => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });

    const store = new Map<string, QueuedAction>();
    const row = pendingRow("A");
    store.set(row.id, row);

    setOfflineUser("A");
    await whenOfflineUserSettled();
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
        await whenOfflineUserSettled();
        assert.equal(getOfflineUser(), "B");
      },
    });

    assert.equal(networkCalls, 0);
  });

  it("sends once when identity stays bound (deps wire control)", async () => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });

    const store = new Map<string, QueuedAction>();
    const row = pendingRow("A");
    store.set(row.id, row);

    setOfflineUser("A");
    await whenOfflineUserSettled();

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
});
