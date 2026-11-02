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

describe("mid-drain account switch", () => {
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
      it(`${fallback ? "fallback": "batch"} does not retry after pending refresh and A→B${switchBack ? "→A": ""}`, async () => {
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

  it("unchanged binding retries successful refresh and consumes the same command", async () => {
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

describe("drainQueue commandPayload URL enrichment", () => {
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

  function queued(
    partial: Pick<QueuedAction, "type" | "url" | "body"> &
      Partial<Pick<QueuedAction, "commandId" | "id">>,
  ): QueuedAction {
    const now = Date.now();
    const commandId =
      partial.commandId ?? "22222222-2222-4222-8222-222222222222";
    return {
      id: partial.id ?? `q-payload-${partial.type}`,
      userId: "payload-user",
      commandId,
      type: partial.type,
      url: partial.url,
      method: "POST",
      body: partial.body,
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

  async function capturePushPayload(
    rows: QueuedAction[],
  ): Promise<Array<{ commandId: string; type: string; payload: Record<string, unknown> }>> {
    await bindUserOffline("payload-user");
    const store = new Map(rows.map((r) => [r.id, r]));
    let captured: Array<{
      commandId: string;
      type: string;
      payload: Record<string, unknown>;
    }> = [];
    await drainQueue({
      listQueueForUserFn: async (userId) =>
        [...store.values()].filter((r) => r.userId === userId),
      putQueuedActionFn: async (r) => {
        store.set(r.id, r);
      },
      deleteQueuedActionFn: async (id) => {
        store.delete(id);
      },
      headersFn: () => ({ "Content-Type": "application/json" }),
      fetchFn: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as {
          commands: Array<{
            commandId: string;
            type: string;
            payload: Record<string, unknown>;
          }>;
        };
        captured = body.commands;
        return new Response(
          JSON.stringify({
            results: body.commands.map((c) => ({
              commandId: c.commandId,
              status: "ok",
            })),
          }),
          { status: 200 },
        );
      },
    });
    return captured;
  }

  it("enriches ticket lifecycle payloads with ticketId from the REST URL", async () => {
    const commandId = "33333333-3333-4333-8333-333333333333";
    const commands = await capturePushPayload([
      queued({
        type: "ticket.start",
        url: "/api/maintenance/tickets/t-9/start",
        body: { commandId },
        commandId,
      }),
    ]);
    assert.equal(commands.length, 1);
    assert.equal(commands[0]!.type, "ticket.start");
    assert.equal(commands[0]!.payload.ticketId, "t-9");
    assert.equal(commands[0]!.payload.commandId, commandId);
  });

  it("enriches ticket.assign/close/reopen with ticketId and preserves body fields", async () => {
    const assignId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const closeId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const reopenId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const commands = await capturePushPayload([
      queued({
        id: "q-assign",
        type: "ticket.assign",
        url: "/api/maintenance/tickets/t-asg/assign",
        body: { commandId: assignId, assigneeId: "emp-1" },
        commandId: assignId,
      }),
      queued({
        id: "q-close",
        type: "ticket.close",
        url: "/api/maintenance/tickets/t-cls/close",
        body: { commandId: closeId },
        commandId: closeId,
      }),
      queued({
        id: "q-reopen",
        type: "ticket.reopen",
        url: "/api/maintenance/tickets/t-rop/reopen?x=1",
        body: { commandId: reopenId, reason: "again" },
        commandId: reopenId,
      }),
    ]);
    const assign = commands.find((c) => c.type === "ticket.assign");
    const close = commands.find((c) => c.type === "ticket.close");
    const reopen = commands.find((c) => c.type === "ticket.reopen");
    assert.equal(assign?.payload.ticketId, "t-asg");
    assert.equal(assign?.payload.assigneeId, "emp-1");
    assert.equal(close?.payload.ticketId, "t-cls");
    assert.equal(reopen?.payload.ticketId, "t-rop");
    assert.equal(reopen?.payload.reason, "again");
  });

  it("enriches cleaning.start/complete with taskId and sessionId", async () => {
    const startId = "44444444-4444-4444-8444-444444444444";
    const completeId = "55555555-5555-4555-8555-555555555555";
    const commands = await capturePushPayload([
      queued({
        id: "q-start",
        type: "cleaning.start",
        url: "/api/cleaning/tasks/task-42/start",
        body: { commandId: startId, expectedVersion: 3 },
        commandId: startId,
      }),
      queued({
        id: "q-complete",
        type: "cleaning.complete",
        url: "/api/cleaning/sessions/sess-7/complete",
        body: { commandId: completeId, notes: "done" },
        commandId: completeId,
      }),
    ]);
    assert.equal(commands.length, 2);
    const start = commands.find((c) => c.type === "cleaning.start");
    const complete = commands.find((c) => c.type === "cleaning.complete");
    assert.equal(start?.payload.taskId, "task-42");
    assert.equal(start?.payload.expectedVersion, 3);
    assert.equal(complete?.payload.sessionId, "sess-7");
    assert.equal(complete?.payload.notes, "done");
  });

  it("preserves body fields and strips query/hash from extracted ids", async () => {
    const commandId = "66666666-6666-4666-8666-666666666666";
    const commands = await capturePushPayload([
      queued({
        type: "ticket.resolve",
        url: "/api/maintenance/tickets/tkt-abc/resolve?retry=1#frag",
        body: { commandId, resolutionNotes: "fixed" },
        commandId,
      }),
    ]);
    assert.equal(commands[0]!.payload.ticketId, "tkt-abc");
    assert.equal(commands[0]!.payload.resolutionNotes, "fixed");
    assert.equal(commands[0]!.payload.commandId, commandId);
  });

  it("does not invent ticketId for ticket.report or unsupported URL shapes", async () => {
    const reportId = "77777777-7777-4777-8777-777777777777";
    const badStartId = "88888888-8888-4888-8888-888888888888";
    const commands = await capturePushPayload([
      queued({
        id: "q-report",
        type: "ticket.report",
        url: "/api/maintenance/tickets",
        body: { commandId: reportId, title: "leak", locationId: "loc-1" },
        commandId: reportId,
      }),
      queued({
        id: "q-bad",
        type: "ticket.start",
        url: "/api/maintenance/ticket-missing-segment/start",
        body: { commandId: badStartId },
        commandId: badStartId,
      }),
    ]);
    const report = commands.find((c) => c.type === "ticket.report");
    const badStart = commands.find((c) => c.type === "ticket.start");
    assert.equal(report?.payload.ticketId, undefined);
    assert.equal(report?.payload.title, "leak");
    assert.equal(report?.payload.locationId, "loc-1");
    assert.equal(badStart?.payload.ticketId, undefined);
    assert.equal(badStart?.payload.commandId, badStartId);
  });
});
