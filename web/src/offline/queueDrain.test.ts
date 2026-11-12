// Import dependency used by this module.
import assert from "node:assert/strict";
// Import dependency used by this module.
import { afterEach, describe, it } from "node:test";
// Import dependency used by this module.
import { setDraining } from "./connState";
// Import dependency used by this module.
import { drainQueue } from "./queueDrain";
// Import dependency used by this module.
import {
  // List item in import/export/params.
  getOfflineUser,
  // List item in import/export/params.
  isOfflineSwitching,
  // List item in import/export/params.
  setOfflineUser,
  // List item in import/export/params.
  whenOfflineUserSettled,
// Close multi-line construct with trailing syntax.
} from "./userScope";
// Import dependency used by this module.
import type { QueuedAction } from "./storage";

// Function definition.
function pendingRow(userId: string): QueuedAction {
  // Local constant binding.
  const now = Date.now();
  // Return computed result to caller.
  return {
    // Field/property in this shape.
    id: `q-${userId}-1`,
    // List item in import/export/params.
    userId,
    // Field/property in this shape.
    commandId: "11111111-1111-4111-8111-111111111111",
    // Field/property in this shape.
    type: "ticket.report",
    // Field/property in this shape.
    url: "/maintenance/tickets",
    // Field/property in this shape.
    method: "POST",
    // Field/property in this shape.
    body: { title: "t" },
    // Field/property in this shape.
    createdAt: now,
    // Field/property in this shape.
    updatedAt: now,
    // Field/property in this shape.
    status: "pending",
    // Field/property in this shape.
    lastError: null,
    // Field/property in this shape.
    conflictCode: null,
    // Field/property in this shape.
    conflictMessage: null,
    // Field/property in this shape.
    conflictDetails: null,
    // Field/property in this shape.
    retries: 0,
  };
}

// Group related unit tests.
describe("mid-drain account switch", () => {
  // Local constant binding.
  const originalOnline = navigator.onLine;

  // Test lifecycle hook.
  afterEach(async () => {
    // Open multi-line construct.
    Object.defineProperty(navigator, "onLine", {
      // Field/property in this shape.
      configurable: true,
      // Field/property in this shape.
      value: originalOnline,
    });
    // Invoke helper or pass arguments.
    setDraining(false);
    // Invoke helper or pass arguments.
    setOfflineUser(null);
    // Await async work before continuing.
    await whenOfflineUserSettled();
  });

  /** Bind user while offline so setOfflineUser does not kick a real drain. */
  async function bindUserOffline(userId: string) {
    // Open multi-line construct.
    Object.defineProperty(navigator, "onLine", {
      // Field/property in this shape.
      configurable: true,
      // Field/property in this shape.
      value: false,
    });
    // Invoke helper or pass arguments.
    setOfflineUser(userId);
    // Await async work before continuing.
    await whenOfflineUserSettled();
    // Open multi-line construct.
    Object.defineProperty(navigator, "onLine", {
      // Field/property in this shape.
      configurable: true,
      // Field/property in this shape.
      value: true,
    });
    // Invoke helper or pass arguments.
    setDraining(false);
  }

  // Unit test case.
  it("aborts with zero network sends when user switches after claim", async () => {
    // Local constant binding.
    const store = new Map<string, QueuedAction>();
    // Local constant binding.
    const row = pendingRow("A");
    // Invoke helper or pass arguments.
    store.set(row.id, row);

    // Await async work before continuing.
    await bindUserOffline("A");
    // Assert expected test outcome.
    assert.equal(getOfflineUser(), "A");

    // Mutable local binding.
    let networkCalls = 0;

    // Await async work before continuing.
    await drainQueue({
      // Arrow function / callback body.
      listQueueForUserFn: async (userId) =>
        // Arrow function / callback body.
        [...store.values()].filter((r) => r.userId === userId),
      // Arrow function / callback body.
      putQueuedActionFn: async (r) => {
        // Invoke helper or pass arguments.
        store.set(r.id, r);
      },
      // Arrow function / callback body.
      deleteQueuedActionFn: async (id) => {
        // Invoke helper or pass arguments.
        store.delete(id);
      },
      // Arrow function / callback body.
      fetchFn: async () => {
        // Assign value for subsequent use.
        networkCalls += 1;
        // Return computed result to caller.
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      },
      // Arrow function / callback body.
      postJsonFn: async () => {
        // Assign value for subsequent use.
        networkCalls += 1;
      },
      // Arrow function / callback body.
      headersFn: () => ({ "Content-Type": "application/json" }),
      // Arrow function / callback body.
      afterClaim: async () => {
        // Invoke helper or pass arguments.
        setOfflineUser("B");
        // Assert expected test outcome.
        assert.equal(isOfflineSwitching(), true, "switch must block sends before its first microtask");
        // Await async work before continuing.
        await whenOfflineUserSettled();
        // Assert expected test outcome.
        assert.equal(getOfflineUser(), "B");
      },
    });

    // Assert expected test outcome.
    assert.equal(networkCalls, 0);
    // In-memory store: drain itself must not delete/reassign after abort.
    // Real logout/account switch also purges IndexedDB (covered by e2e).
    const kept = store.get(row.id);
    // Assert expected test outcome.
    assert.ok(kept, "user A row must remain in the outbox after abort");
    // Assert expected test outcome.
    assert.equal(kept.userId, "A");
    // Assert expected test outcome.
    assert.equal(kept.commandId, row.commandId);
    // Assert expected test outcome.
    assert.equal(kept.status, "sending");
  });

  // Unit test case.
  it("sends once when identity stays bound (deps wire control)", async () => {
    // Local constant binding.
    const store = new Map<string, QueuedAction>();
    // Local constant binding.
    const row = pendingRow("A");
    // Invoke helper or pass arguments.
    store.set(row.id, row);

    // Await async work before continuing.
    await bindUserOffline("A");

    // Mutable local binding.
    let networkCalls = 0;

    // Await async work before continuing.
    await drainQueue({
      // Arrow function / callback body.
      listQueueForUserFn: async (userId) =>
        // Arrow function / callback body.
        [...store.values()].filter((r) => r.userId === userId),
      // Arrow function / callback body.
      putQueuedActionFn: async (r) => {
        // Invoke helper or pass arguments.
        store.set(r.id, r);
      },
      // Arrow function / callback body.
      deleteQueuedActionFn: async (id) => {
        // Invoke helper or pass arguments.
        store.delete(id);
      },
      // Arrow function / callback body.
      fetchFn: async () => {
        // Assign value for subsequent use.
        networkCalls += 1;
        // Return computed result to caller.
        return new Response(
          // Open multi-line construct.
          JSON.stringify({
            // Field/property in this shape.
            results: [
              {
                // Field/property in this shape.
                commandId: row.commandId,
                // Field/property in this shape.
                status: "ok",
              },
            ],
          }),
          // Continue multi-line list/arguments.
          { status: 200 },
        );
      },
      // Arrow function / callback body.
      headersFn: () => ({ "Content-Type": "application/json" }),
    });

    // Assert expected test outcome.
    assert.equal(networkCalls, 1);
  });

  // Iterate collection / range.
  for (const fallback of [false, true]) {
    // Iterate collection / range.
    for (const switchBack of [false, true]) {
      // Unit test case.
      it(`${fallback ? "fallback": "batch"} does not retry after pending refresh and A→B${switchBack ? "→A": ""}`, async () => {
        // Local constant binding.
        const row = pendingRow("A");
        // Local constant binding.
        const store = new Map([[row.id, row]]);
        // Await async work before continuing.
        await bindUserOffline("A");
        // Mutable local binding.
        let enterRefresh!: () => void;
        // Local constant binding.
        const entered = new Promise<void>(resolve => { enterRefresh = resolve; });
        // Mutable local binding.
        let finishRefresh!: () => void;
        // Local constant binding.
        const pendingRefresh = new Promise<void>(resolve => { finishRefresh = resolve; });
        // Local constant binding.
        const sends: Array<{ url: string; userId: string | null }> = [];
        // Mutable local binding.
        let deletions = 0;
        // Local constant binding.
        const draining = drainQueue({
          // Arrow function / callback body.
          listQueueForUserFn: async id => [...store.values()].filter(r => r.userId === id),
          // Arrow function / callback body.
          putQueuedActionFn: async r => { store.set(r.id, r); },
          // Arrow function / callback body.
          deleteQueuedActionFn: async id => { deletions++; store.delete(id); },
          // Arrow function / callback body.
          headersFn: () => ({}),
          // Arrow function / callback body.
          fetchFn: async url => {
            // Invoke helper or pass arguments.
            sends.push({ url, userId: getOfflineUser() });
            // Return computed result to caller.
            return new Response("{}", { status: fallback && url.endsWith("/sync/push") ? 501 : 401 });
          },
          // Arrow function / callback body.
          refreshFn: async () => { enterRefresh(); await pendingRefresh; return "refreshed"; },
        });
        // Await async work before continuing.
        await entered;
        // Await async work before continuing.
        await bindUserOffline("B");
        // Conditional branch for this case.
        if (switchBack) await bindUserOffline("A");
        // Invoke helper or pass arguments.
        finishRefresh();
        // Await async work before continuing.
        await draining;
        // Assert expected test outcome.
        assert.equal(sends.length, fallback ? 2 : 1, "no retry or fallback send after identity transition");
        // Assert expected test outcome.
        assert.ok(sends.every(send => send.userId === "A"));
        // Assert expected test outcome.
        assert.equal(deletions, 0, "stale completion must not consume the original command");
        // Assert expected test outcome.
        assert.deepEqual(store.get(row.id), { ...row, status: "sending", updatedAt: store.get(row.id)!.updatedAt });
      });
    }
  }

  // Unit test case.
  it("unchanged binding retries successful refresh and consumes the same command", async () => {
    // Local constant binding.
    const row = pendingRow("A");
    // Local constant binding.
    const store = new Map([[row.id, row]]);
    // Await async work before continuing.
    await bindUserOffline("A");
    // Local constant binding.
    const bodies: string[] = [];
    // Await async work before continuing.
    await drainQueue({
      // Arrow function / callback body.
      listQueueForUserFn: async () => [...store.values()],
      // Arrow function / callback body.
      putQueuedActionFn: async r => { store.set(r.id, r); },
      // Arrow function / callback body.
      deleteQueuedActionFn: async id => { store.delete(id); },
      // Arrow function / callback body.
      headersFn: () => ({}),
      // Arrow function / callback body.
      fetchFn: async (_url, init) => {
        // Assert expected test outcome.
        assert.equal(new Headers(init.headers).get("X-Offline-User"), "A");
        // Invoke helper or pass arguments.
        bodies.push(String(init.body));
        // Return computed result to caller.
        return new Response(JSON.stringify({ results: [{ commandId: row.commandId, status: "ok" }] }), { status: bodies.length === 1 ? 401 : 200 });
      },
      // Arrow function / callback body.
      refreshFn: async () => "refreshed",
    });
    // Assert expected test outcome.
    assert.equal(bodies.length, 2);
    // Assert expected test outcome.
    assert.equal(bodies[0], bodies[1]);
    // Assert expected test outcome.
    assert.equal(store.size, 0);
  });
});

// Group related unit tests.
describe("drainQueue commandPayload URL enrichment", () => {
  // Local constant binding.
  const originalOnline = navigator.onLine;

  // Test lifecycle hook.
  afterEach(async () => {
    // Open multi-line construct.
    Object.defineProperty(navigator, "onLine", {
      // Field/property in this shape.
      configurable: true,
      // Field/property in this shape.
      value: originalOnline,
    });
    // Invoke helper or pass arguments.
    setDraining(false);
    // Invoke helper or pass arguments.
    setOfflineUser(null);
    // Await async work before continuing.
    await whenOfflineUserSettled();
  });

  // Function definition.
  async function bindUserOffline(userId: string) {
    // Open multi-line construct.
    Object.defineProperty(navigator, "onLine", {
      // Field/property in this shape.
      configurable: true,
      // Field/property in this shape.
      value: false,
    });
    // Invoke helper or pass arguments.
    setOfflineUser(userId);
    // Await async work before continuing.
    await whenOfflineUserSettled();
    // Open multi-line construct.
    Object.defineProperty(navigator, "onLine", {
      // Field/property in this shape.
      configurable: true,
      // Field/property in this shape.
      value: true,
    });
    // Invoke helper or pass arguments.
    setDraining(false);
  }

  // Function definition.
  function queued(
    // Field/property in this shape.
    partial: Pick<QueuedAction, "type" | "url" | "body"> &
      // Continue multi-line list/arguments.
      Partial<Pick<QueuedAction, "commandId" | "id">>,
  // Open multi-line construct.
  ): QueuedAction {
    // Local constant binding.
    const now = Date.now();
    // Local constant binding.
    const commandId =
      // Continue module logic.
      partial.commandId ?? "22222222-2222-4222-8222-222222222222";
    // Return computed result to caller.
    return {
      // Field/property in this shape.
      id: partial.id ?? `q-payload-${partial.type}`,
      // Field/property in this shape.
      userId: "payload-user",
      // List item in import/export/params.
      commandId,
      // Field/property in this shape.
      type: partial.type,
      // Field/property in this shape.
      url: partial.url,
      // Field/property in this shape.
      method: "POST",
      // Field/property in this shape.
      body: partial.body,
      // Field/property in this shape.
      createdAt: now,
      // Field/property in this shape.
      updatedAt: now,
      // Field/property in this shape.
      status: "pending",
      // Field/property in this shape.
      lastError: null,
      // Field/property in this shape.
      conflictCode: null,
      // Field/property in this shape.
      conflictMessage: null,
      // Field/property in this shape.
      conflictDetails: null,
      // Field/property in this shape.
      retries: 0,
    };
  }

  // Function definition.
  async function capturePushPayload(
    // Field/property in this shape.
    rows: QueuedAction[],
  // Open multi-line construct.
  ): Promise<Array<{ commandId: string; type: string; payload: Record<string, unknown> }>> {
    // Await async work before continuing.
    await bindUserOffline("payload-user");
    // Local constant binding.
    const store = new Map(rows.map((r) => [r.id, r]));
    // Mutable local binding.
    let captured: Array<{
      // Field/property in this shape.
      commandId: string;
      // Field/property in this shape.
      type: string;
      // Field/property in this shape.
      payload: Record<string, unknown>;
    // Assign value for subsequent use.
    }> = [];
    // Await async work before continuing.
    await drainQueue({
      // Arrow function / callback body.
      listQueueForUserFn: async (userId) =>
        // Arrow function / callback body.
        [...store.values()].filter((r) => r.userId === userId),
      // Arrow function / callback body.
      putQueuedActionFn: async (r) => {
        // Invoke helper or pass arguments.
        store.set(r.id, r);
      },
      // Arrow function / callback body.
      deleteQueuedActionFn: async (id) => {
        // Invoke helper or pass arguments.
        store.delete(id);
      },
      // Arrow function / callback body.
      headersFn: () => ({ "Content-Type": "application/json" }),
      // Arrow function / callback body.
      fetchFn: async (_url, init) => {
        // Local constant binding.
        const body = JSON.parse(String(init?.body)) as {
          // Field/property in this shape.
          commands: Array<{
            // Field/property in this shape.
            commandId: string;
            // Field/property in this shape.
            type: string;
            // Field/property in this shape.
            payload: Record<string, unknown>;
          // Close multi-line construct with trailing syntax.
          }>;
        };
        // Assign value for subsequent use.
        captured = body.commands;
        // Return computed result to caller.
        return new Response(
          // Open multi-line construct.
          JSON.stringify({
            // Arrow function / callback body.
            results: body.commands.map((c) => ({
              // Field/property in this shape.
              commandId: c.commandId,
              // Field/property in this shape.
              status: "ok",
            })),
          }),
          // Continue multi-line list/arguments.
          { status: 200 },
        );
      },
    });
    // Return computed result to caller.
    return captured;
  }

  // Unit test case.
  it("enriches ticket lifecycle payloads with ticketId from the REST URL", async () => {
    // Local constant binding.
    const commandId = "33333333-3333-4333-8333-333333333333";
    // Local constant binding.
    const commands = await capturePushPayload([
      // Open multi-line construct.
      queued({
        // Field/property in this shape.
        type: "ticket.start",
        // Field/property in this shape.
        url: "/api/maintenance/tickets/t-9/start",
        // Field/property in this shape.
        body: { commandId },
        // List item in import/export/params.
        commandId,
      }),
    ]);
    // Assert expected test outcome.
    assert.equal(commands.length, 1);
    // Assert expected test outcome.
    assert.equal(commands[0]!.type, "ticket.start");
    // Assert expected test outcome.
    assert.equal(commands[0]!.payload.ticketId, "t-9");
    // Assert expected test outcome.
    assert.equal(commands[0]!.payload.commandId, commandId);
  });

  // Unit test case.
  it("enriches ticket.assign/close/reopen with ticketId and preserves body fields", async () => {
    // Local constant binding.
    const assignId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    // Local constant binding.
    const closeId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    // Local constant binding.
    const reopenId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    // Local constant binding.
    const commands = await capturePushPayload([
      // Open multi-line construct.
      queued({
        // Field/property in this shape.
        id: "q-assign",
        // Field/property in this shape.
        type: "ticket.assign",
        // Field/property in this shape.
        url: "/api/maintenance/tickets/t-asg/assign",
        // Field/property in this shape.
        body: { commandId: assignId, assigneeId: "emp-1" },
        // Field/property in this shape.
        commandId: assignId,
      }),
      // Open multi-line construct.
      queued({
        // Field/property in this shape.
        id: "q-close",
        // Field/property in this shape.
        type: "ticket.close",
        // Field/property in this shape.
        url: "/api/maintenance/tickets/t-cls/close",
        // Field/property in this shape.
        body: { commandId: closeId },
        // Field/property in this shape.
        commandId: closeId,
      }),
      // Open multi-line construct.
      queued({
        // Field/property in this shape.
        id: "q-reopen",
        // Field/property in this shape.
        type: "ticket.reopen",
        // Field/property in this shape.
        url: "/api/maintenance/tickets/t-rop/reopen?x=1",
        // Field/property in this shape.
        body: { commandId: reopenId, reason: "again" },
        // Field/property in this shape.
        commandId: reopenId,
      }),
    ]);
    // Local constant binding.
    const assign = commands.find((c) => c.type === "ticket.assign");
    // Local constant binding.
    const close = commands.find((c) => c.type === "ticket.close");
    // Local constant binding.
    const reopen = commands.find((c) => c.type === "ticket.reopen");
    // Assert expected test outcome.
    assert.equal(assign?.payload.ticketId, "t-asg");
    // Assert expected test outcome.
    assert.equal(assign?.payload.assigneeId, "emp-1");
    // Assert expected test outcome.
    assert.equal(close?.payload.ticketId, "t-cls");
    // Assert expected test outcome.
    assert.equal(reopen?.payload.ticketId, "t-rop");
    // Assert expected test outcome.
    assert.equal(reopen?.payload.reason, "again");
  });

  // Unit test case.
  it("enriches cleaning.start/complete with taskId and sessionId", async () => {
    // Local constant binding.
    const startId = "44444444-4444-4444-8444-444444444444";
    // Local constant binding.
    const completeId = "55555555-5555-4555-8555-555555555555";
    // Local constant binding.
    const commands = await capturePushPayload([
      // Open multi-line construct.
      queued({
        // Field/property in this shape.
        id: "q-start",
        // Field/property in this shape.
        type: "cleaning.start",
        // Field/property in this shape.
        url: "/api/cleaning/tasks/task-42/start",
        // Field/property in this shape.
        body: { commandId: startId, expectedVersion: 3 },
        // Field/property in this shape.
        commandId: startId,
      }),
      // Open multi-line construct.
      queued({
        // Field/property in this shape.
        id: "q-complete",
        // Field/property in this shape.
        type: "cleaning.complete",
        // Field/property in this shape.
        url: "/api/cleaning/sessions/sess-7/complete",
        // Field/property in this shape.
        body: { commandId: completeId, notes: "done" },
        // Field/property in this shape.
        commandId: completeId,
      }),
    ]);
    // Assert expected test outcome.
    assert.equal(commands.length, 2);
    // Local constant binding.
    const start = commands.find((c) => c.type === "cleaning.start");
    // Local constant binding.
    const complete = commands.find((c) => c.type === "cleaning.complete");
    // Assert expected test outcome.
    assert.equal(start?.payload.taskId, "task-42");
    // Assert expected test outcome.
    assert.equal(start?.payload.expectedVersion, 3);
    // Assert expected test outcome.
    assert.equal(complete?.payload.sessionId, "sess-7");
    // Assert expected test outcome.
    assert.equal(complete?.payload.notes, "done");
  });

  // Unit test case.
  it("preserves body fields and strips query/hash from extracted ids", async () => {
    // Local constant binding.
    const commandId = "66666666-6666-4666-8666-666666666666";
    // Local constant binding.
    const commands = await capturePushPayload([
      // Open multi-line construct.
      queued({
        // Field/property in this shape.
        type: "ticket.resolve",
        // Field/property in this shape.
        url: "/api/maintenance/tickets/tkt-abc/resolve?retry=1#frag",
        // Field/property in this shape.
        body: { commandId, resolutionNotes: "fixed" },
        // List item in import/export/params.
        commandId,
      }),
    ]);
    // Assert expected test outcome.
    assert.equal(commands[0]!.payload.ticketId, "tkt-abc");
    // Assert expected test outcome.
    assert.equal(commands[0]!.payload.resolutionNotes, "fixed");
    // Assert expected test outcome.
    assert.equal(commands[0]!.payload.commandId, commandId);
  });

  // Unit test case.
  it("does not invent ticketId for ticket.report or unsupported URL shapes", async () => {
    // Local constant binding.
    const reportId = "77777777-7777-4777-8777-777777777777";
    // Local constant binding.
    const badStartId = "88888888-8888-4888-8888-888888888888";
    // Local constant binding.
    const commands = await capturePushPayload([
      // Open multi-line construct.
      queued({
        // Field/property in this shape.
        id: "q-report",
        // Field/property in this shape.
        type: "ticket.report",
        // Field/property in this shape.
        url: "/api/maintenance/tickets",
        // Field/property in this shape.
        body: { commandId: reportId, title: "leak", locationId: "loc-1" },
        // Field/property in this shape.
        commandId: reportId,
      }),
      // Open multi-line construct.
      queued({
        // Field/property in this shape.
        id: "q-bad",
        // Field/property in this shape.
        type: "ticket.start",
        // Field/property in this shape.
        url: "/api/maintenance/ticket-missing-segment/start",
        // Field/property in this shape.
        body: { commandId: badStartId },
        // Field/property in this shape.
        commandId: badStartId,
      }),
    ]);
    // Local constant binding.
    const report = commands.find((c) => c.type === "ticket.report");
    // Local constant binding.
    const badStart = commands.find((c) => c.type === "ticket.start");
    // Assert expected test outcome.
    assert.equal(report?.payload.ticketId, undefined);
    // Assert expected test outcome.
    assert.equal(report?.payload.title, "leak");
    // Assert expected test outcome.
    assert.equal(report?.payload.locationId, "loc-1");
    // Assert expected test outcome.
    assert.equal(badStart?.payload.ticketId, undefined);
    // Assert expected test outcome.
    assert.equal(badStart?.payload.commandId, badStartId);
  });
});
