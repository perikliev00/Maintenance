import assert from "node:assert/strict";
import { afterEach, beforeEach, it } from "node:test";
import { setImmediate as tick } from "node:timers/promises";
import { drainQueue, type DrainQueueDeps } from "./queueDrain";
import { markReachable, setDraining, isDraining } from "./connState";
import { setOfflineUser, whenOfflineUserSettled } from "./userScope";
import type { QueuedAction } from "./storage";

const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
let next = 0;
const timers = new Map<number, { callback: () => void; delay: number }>();
// Test lifecycle hook.
beforeEach(async () => {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  setOfflineUser("retry-user"); await whenOfflineUserSettled();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  globalThis.setTimeout = ((callback: () => void, delay: number) => {
    const id = ++next; timers.set(id, { callback, delay }); return id;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => { timers.delete(id); }) as unknown as typeof clearTimeout;
});
// Test lifecycle hook.
afterEach(async () => {
  markReachable({ cancelCommandRetry: true }); setDraining(false); timers.clear();
  globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear;
  if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else Reflect.deleteProperty(globalThis, "window");
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  setOfflineUser(null); await whenOfflineUserSettled();
});
// Function definition.
function row(n: number): QueuedAction {
  const commandId = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return { id: String(n), userId: "retry-user", commandId, type: "ticket.start", url: `/maintenance/tickets/t${n}/start`, method: "POST", body: { commandId }, createdAt: n, updatedAt: n, status: "pending", retries: 0, lastError: null, conflictCode: null, conflictMessage: null, conflictDetails: null };
}
// Function definition.
async function fire() {
  const [id, timer] = [...timers.entries()][0]!;
  assert.ok(timer, "automatic retry timer"); timers.delete(id); timer.callback();
  // Iterate collection / range.
  for (let i = 0; i < 100 && isDraining(); i++) await tick();
  assert.equal(isDraining(), false);
}
// Function definition.
function deps(store: Map<string, QueuedAction>, reply: (commands: QueuedAction[], attempt: number) => unknown[]): DrainQueueDeps & { batches: string[][] } {
  const batches: string[][] = [];
  return { batches, listQueueForUserFn: async () => [...store.values()],
    putQueuedActionFn: async r => { store.set(r.id, r); }, deleteQueuedActionFn: async id => { store.delete(id); }, headersFn: () => ({}),
    fetchFn: async (_url, init) => {
      const commands = JSON.parse(String(init?.body)).commands;
      batches.push(commands.map((c: QueuedAction) => c.commandId));
      return new Response(JSON.stringify({ results: reply(commands, batches.length) }));
    },
  };
}
it("transient batch result retries automatically and holds later batches behind the pending command", async () => {
  const initial = Array.from({ length: 205 }, (_, i) => row(i + 1));
  const store = new Map(initial.map(r => [r.id, r]));
  const d = deps(store, (commands, attempt) => commands.map((c, i) => ({ commandId: c.commandId,
    status: attempt === 1 && i === 0 ? "error" : "ok", retryable: true })));
  await drainQueue(d);
  assert.equal(d.batches.length, 1);
  assert.equal(store.size, 106);
  assert.equal([...timers.values()][0]?.delay, 2000);
  await fire();
  assert.equal(store.size, 0);
  assert.deepEqual(d.batches[1], [initial[0]!, ...initial.slice(100, 199)].map(r => r.commandId));
  assert.equal(timers.size, 0);
});
it("retryable errors stop at the retry limit with increasing bounded delays", async () => {
  const item = row(1); const store = new Map([[item.id, item]]);
  const d = deps(store, commands => commands.map(c => ({ commandId: c.commandId, status: "error", retryable: true })));
  await drainQueue(d);
  const delays: number[] = [];
  // Loop while condition holds.
  while (timers.size) { delays.push([...timers.values()][0]!.delay); await fire(); assert.ok(d.batches.length <= 8); }
  assert.equal(d.batches.length, 8); assert.equal(store.get(item.id)?.status, "failed");
  assert.deepEqual(delays, [2000, 5000, 15000, 15000, 15000, 15000, 15000]);
});
it("unrelated successful I/O does not cancel a command retry or reset its backoff", async () => {
  const item = row(1), store = new Map([[item.id, item]]);
  const d = deps(store, (commands, attempt) => commands.map(c => ({ commandId: c.commandId,
    status: attempt < 3 ? "error" : "ok", retryable: true })));
  await drainQueue(d);
  markReachable();
  assert.equal(timers.size, 1);
  await fire();
  assert.equal([...timers.values()][0]?.delay, 5000);
  markReachable();
  await fire();
  assert.equal(store.size, 0); assert.equal(timers.size, 0);
});
it("permanent validation/permission failures and conflicts do not auto-retry", async () => {
  const store = new Map([1, 2, 3].map(n => { const r = row(n); return [r.id, r]; }));
  const d = deps(store, commands => commands.map((c, i) => ({ commandId: c.commandId,
    status: ["error", "forbidden", "conflict"][i], retryable: false, message: i === 1 ? "Missing tickets.resolve" : "validation" })));
  await drainQueue(d);
  assert.deepEqual([...store.values()].map(r => r.status), ["failed", "failed", "conflict"]);
  assert.equal(timers.size, 0);
});
it("a scheduled retry cannot send the preceding account's commands", async () => {
  const item = row(1), store = new Map([[item.id, item]]);
  const d = deps(store, commands => commands.map(c => ({ commandId: c.commandId, status: "error", retryable: true })));
  await drainQueue(d);
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  setOfflineUser("other-user"); await whenOfflineUserSettled();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  await fire();
  assert.equal(d.batches.length, 1);
});
