// Import dependency used by this module.
import assert from "node:assert/strict";
// Import dependency used by this module.
import { afterEach, it } from "node:test";
// Import dependency used by this module.
import { drainQueue } from "./queueDrain";
// Import dependency used by this module.
import { markReachable, setDraining } from "./connState";
// Import dependency used by this module.
import { setOfflineUser, whenOfflineUserSettled } from "./userScope";
// Import dependency used by this module.
import type { QueuedAction } from "./storage";

// Function definition.
function row(n: number): QueuedAction {
  // Return computed result to caller.
  return { id: `q-${String(n).padStart(4, "0")}`, userId: "scenario", commandId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, type: "ticket.start", url: `/maintenance/tickets/t-${n}/start`, method: "POST", body: { commandId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}` }, createdAt: n, updatedAt: n, status: "pending", lastError: null, conflictCode: null, conflictMessage: null, conflictDetails: null, retries: 0 };
}
// Function definition.
async function bind() {
  // Invoke helper or pass arguments.
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  // Invoke helper or pass arguments.
  setOfflineUser("scenario"); await whenOfflineUserSettled();
  // Invoke helper or pass arguments.
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
}
// Test lifecycle hook.
afterEach(async () => {
  // Invoke helper or pass arguments.
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  // Invoke helper or pass arguments.
  setOfflineUser(null); await whenOfflineUserSettled(); setDraining(false); markReachable();
});
// Iterate collection / range.
for (const count of [100, 101, 205]) it(`${count} queued commands use batches <=100 without fallback or loss`, async () => {
  // Await async work before continuing.
  await bind();
  // Local constant binding.
  const initial = Array.from({ length: count }, (_, i) => row(i + 1));
  // Local constant binding.
  const store = new Map(initial.map(r => [r.id, r]));
  // Local constant binding.
  const batches: string[][] = [];
  // Mutable local binding.
  let fallbacks = 0;
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
      // Local constant binding.
      const commands = JSON.parse(init!.body as string).commands;
      // Arrow function / callback body.
      batches.push(commands.map((c: any) => c.commandId));
      // Return computed result to caller.
      return new Response(JSON.stringify({ results: commands.map((c: any) => ({ commandId: c.commandId, status: "ok" })) }), { status: commands.length > 100 ? 400 : 200 });
    },
    // Arrow function / callback body.
    postJsonFn: async () => { fallbacks++; },
  });
  // Assert expected test outcome.
  assert.equal(fallbacks, 0);
  // Assert expected test outcome.
  assert.deepEqual(batches.map(b => b.length), count === 100 ? [100] : count === 101 ? [100, 1] : [100, 100, 5]);
  // Assert expected test outcome.
  assert.deepEqual(batches.flat(), initial.map(r => r.commandId));
  // Assert expected test outcome.
  assert.equal(store.size, 0);
});
// Unit test case.
it("batch 429 retains all commands pending and avoids per-item request storm", async () => {
  // Await async work before continuing.
  await bind();
  // Local constant binding.
  const initial = [row(1), row(2)]; const store = new Map(initial.map(r => [r.id, r]));
  // Mutable local binding.
  let fallbacks = 0;
  // Await async work before continuing.
  await drainQueue({ listQueueForUserFn: async () => [...store.values()], putQueuedActionFn: async r => { store.set(r.id, r); }, deleteQueuedActionFn: async id => { store.delete(id); }, headersFn: () => ({}), fetchFn: async () => new Response("{}", { status: 429 }), postJsonFn: async () => { fallbacks++; throw Object.assign(new Error("limited"), { status: 429 }); } });
  // Assert expected test outcome.
  assert.equal(fallbacks, 0);
  // Assert expected test outcome.
  assert.equal(store.size, 2); assert.ok([...store.values()].every(r => r.status === "pending"));
});
// Unit test case.
it("mixed, missing and unknown sync results preserve unconfirmed payloads", async () => {
  // Await async work before continuing.
  await bind(); const initial = [row(1), row(2), row(3), row(4), row(5)]; const store = new Map(initial.map(r => [r.id, r]));
  // Await async work before continuing.
  await drainQueue({ listQueueForUserFn: async () => [...store.values()], putQueuedActionFn: async r => { store.set(r.id, r); }, deleteQueuedActionFn: async id => { store.delete(id); }, headersFn: () => ({}), fetchFn: async () => new Response(JSON.stringify({ results: [{ commandId: row(1).commandId, status: "ok" }, { commandId: row(2).commandId, status: "conflict", code: "version_conflict", details: { currentVersion: 4 } }, { commandId: row(3).commandId, status: "forbidden" }, { commandId: row(4).commandId, status: "invented" }, { commandId: "not-sent", status: "ok" }] }), { status: 200 }) });
  // Assert expected test outcome.
  assert.equal(store.has(row(1).id), false);
  // Assert expected test outcome.
  assert.deepEqual([2, 3, 4, 5].map(i => store.get(row(i).id)!.status), ["conflict", "failed", "pending", "pending"]);
  // Iterate collection / range.
  for (const i of [2, 3, 4, 5]) assert.deepEqual(store.get(row(i).id)!.body, row(i).body);
});
