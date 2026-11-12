// Import dependency used by this module.
import assert from "node:assert/strict";
// Import dependency used by this module.
import { afterEach, beforeEach, it } from "node:test";
// Import dependency used by this module.
import { setImmediate as tick } from "node:timers/promises";
// Import dependency used by this module.
import { drainQueue, type DrainQueueDeps } from "./queueDrain";
// Import dependency used by this module.
import { markReachable, setDraining, isDraining } from "./connState";
// Import dependency used by this module.
import { setOfflineUser, whenOfflineUserSettled } from "./userScope";
// Import dependency used by this module.
import type { QueuedAction } from "./storage";

// Local constant binding.
const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
// Local constant binding.
const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
// Mutable local binding.
let next = 0;
// Local constant binding.
const timers = new Map<number, { callback: () => void; delay: number }>();
// Test lifecycle hook.
beforeEach(async () => {
  // Invoke helper or pass arguments.
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  // Invoke helper or pass arguments.
  setOfflineUser("retry-user"); await whenOfflineUserSettled();
  // Invoke helper or pass arguments.
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  // Invoke helper or pass arguments.
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  // Arrow function / callback body.
  globalThis.setTimeout = ((callback: () => void, delay: number) => {
    // Local constant binding.
    const id = ++next; timers.set(id, { callback, delay }); return id;
  // Close multi-line construct with trailing syntax.
  }) as unknown as typeof setTimeout;
  // Arrow function / callback body.
  globalThis.clearTimeout = ((id: number) => { timers.delete(id); }) as unknown as typeof clearTimeout;
});
// Test lifecycle hook.
afterEach(async () => {
  // Invoke helper or pass arguments.
  markReachable({ cancelCommandRetry: true }); setDraining(false); timers.clear();
  // Assign value for subsequent use.
  globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear;
  // Conditional branch for this case.
  if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else Reflect.deleteProperty(globalThis, "window");
  // Invoke helper or pass arguments.
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  // Invoke helper or pass arguments.
  setOfflineUser(null); await whenOfflineUserSettled();
});
// Function definition.
function row(n: number): QueuedAction {
  // Local constant binding.
  const commandId = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  // Return computed result to caller.
  return { id: String(n), userId: "retry-user", commandId, type: "ticket.start", url: `/maintenance/tickets/t${n}/start`, method: "POST", body: { commandId }, createdAt: n, updatedAt: n, status: "pending", retries: 0, lastError: null, conflictCode: null, conflictMessage: null, conflictDetails: null };
}
// Function definition.
async function fire() {
  // Assign value for subsequent use.
  const [id, timer] = [...timers.entries()][0]!;
  // Assert expected test outcome.
  assert.ok(timer, "automatic retry timer"); timers.delete(id); timer.callback();
  // Iterate collection / range.
  for (let i = 0; i < 100 && isDraining(); i++) await tick();
  // Assert expected test outcome.
  assert.equal(isDraining(), false);
}
// Function definition.
function deps(store: Map<string, QueuedAction>, reply: (commands: QueuedAction[], attempt: number) => unknown[]): DrainQueueDeps & { batches: string[][] } {
  // Local constant binding.
  const batches: string[][] = [];
  // Return computed result to caller.
  return { batches, listQueueForUserFn: async () => [...store.values()],
    // Arrow function / callback body.
    putQueuedActionFn: async r => { store.set(r.id, r); }, deleteQueuedActionFn: async id => { store.delete(id); }, headersFn: () => ({}),
    // Arrow function / callback body.
    fetchFn: async (_url, init) => {
      // Local constant binding.
      const commands = JSON.parse(String(init?.body)).commands;
      // Arrow function / callback body.
      batches.push(commands.map((c: QueuedAction) => c.commandId));
      // Return computed result to caller.
      return new Response(JSON.stringify({ results: reply(commands, batches.length) }));
    },
  };
}
// Unit test case.
it("transient batch result retries automatically and holds later batches behind the pending command", async () => {
  // Local constant binding.
  const initial = Array.from({ length: 205 }, (_, i) => row(i + 1));
  // Local constant binding.
  const store = new Map(initial.map(r => [r.id, r]));
  // Local constant binding.
  const d = deps(store, (commands, attempt) => commands.map((c, i) => ({ commandId: c.commandId,
    // Field/property in this shape.
    status: attempt === 1 && i === 0 ? "error" : "ok", retryable: true })));
  // Await async work before continuing.
  await drainQueue(d);
  // Assert expected test outcome.
  assert.equal(d.batches.length, 1);
  // Assert expected test outcome.
  assert.equal(store.size, 106);
  // Assert expected test outcome.
  assert.equal([...timers.values()][0]?.delay, 2000);
  // Await async work before continuing.
  await fire();
  // Assert expected test outcome.
  assert.equal(store.size, 0);
  // Assert expected test outcome.
  assert.deepEqual(d.batches[1], [initial[0]!, ...initial.slice(100, 199)].map(r => r.commandId));
  // Assert expected test outcome.
  assert.equal(timers.size, 0);
});
// Unit test case.
it("retryable errors stop at the retry limit with increasing bounded delays", async () => {
  // Local constant binding.
  const item = row(1); const store = new Map([[item.id, item]]);
  // Local constant binding.
  const d = deps(store, commands => commands.map(c => ({ commandId: c.commandId, status: "error", retryable: true })));
  // Await async work before continuing.
  await drainQueue(d);
  // Local constant binding.
  const delays: number[] = [];
  // Loop while condition holds.
  while (timers.size) { delays.push([...timers.values()][0]!.delay); await fire(); assert.ok(d.batches.length <= 8); }
  // Assert expected test outcome.
  assert.equal(d.batches.length, 8); assert.equal(store.get(item.id)?.status, "failed");
  // Assert expected test outcome.
  assert.deepEqual(delays, [2000, 5000, 15000, 15000, 15000, 15000, 15000]);
});
// Unit test case.
it("unrelated successful I/O does not cancel a command retry or reset its backoff", async () => {
  // Local constant binding.
  const item = row(1), store = new Map([[item.id, item]]);
  // Local constant binding.
  const d = deps(store, (commands, attempt) => commands.map(c => ({ commandId: c.commandId,
    // Field/property in this shape.
    status: attempt < 3 ? "error" : "ok", retryable: true })));
  // Await async work before continuing.
  await drainQueue(d);
  // Invoke helper or pass arguments.
  markReachable();
  // Assert expected test outcome.
  assert.equal(timers.size, 1);
  // Await async work before continuing.
  await fire();
  // Assert expected test outcome.
  assert.equal([...timers.values()][0]?.delay, 5000);
  // Invoke helper or pass arguments.
  markReachable();
  // Await async work before continuing.
  await fire();
  // Assert expected test outcome.
  assert.equal(store.size, 0); assert.equal(timers.size, 0);
});
// Unit test case.
it("permanent validation/permission failures and conflicts do not auto-retry", async () => {
  // Local constant binding.
  const store = new Map([1, 2, 3].map(n => { const r = row(n); return [r.id, r]; }));
  // Local constant binding.
  const d = deps(store, commands => commands.map((c, i) => ({ commandId: c.commandId,
    // Field/property in this shape.
    status: ["error", "forbidden", "conflict"][i], retryable: false, message: i === 1 ? "Missing tickets.resolve" : "validation" })));
  // Await async work before continuing.
  await drainQueue(d);
  // Assert expected test outcome.
  assert.deepEqual([...store.values()].map(r => r.status), ["failed", "failed", "conflict"]);
  // Assert expected test outcome.
  assert.equal(timers.size, 0);
});
// Unit test case.
it("a scheduled retry cannot send the preceding account's commands", async () => {
  // Local constant binding.
  const item = row(1), store = new Map([[item.id, item]]);
  // Local constant binding.
  const d = deps(store, commands => commands.map(c => ({ commandId: c.commandId, status: "error", retryable: true })));
  // Await async work before continuing.
  await drainQueue(d);
  // Invoke helper or pass arguments.
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  // Invoke helper or pass arguments.
  setOfflineUser("other-user"); await whenOfflineUserSettled();
  // Invoke helper or pass arguments.
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  // Await async work before continuing.
  await fire();
  // Assert expected test outcome.
  assert.equal(d.batches.length, 1);
});
