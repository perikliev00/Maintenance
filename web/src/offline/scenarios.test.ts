import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { drainQueue } from "./queueDrain";
import { markReachable, setDraining } from "./connState";
import { setOfflineUser, whenOfflineUserSettled } from "./userScope";
import type { QueuedAction } from "./storage";

function row(n: number): QueuedAction {
  return { id: `q-${String(n).padStart(4, "0")}`, userId: "scenario", commandId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, type: "ticket.start", url: `/maintenance/tickets/t-${n}/start`, method: "POST", body: { commandId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}` }, createdAt: n, updatedAt: n, status: "pending", lastError: null, conflictCode: null, conflictMessage: null, conflictDetails: null, retries: 0 };
}
async function bind() {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  setOfflineUser("scenario"); await whenOfflineUserSettled();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
}
afterEach(async () => {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  setOfflineUser(null); await whenOfflineUserSettled(); setDraining(false); markReachable();
});
for (const count of [100, 101, 205]) it(`P2-51 ${count} queued commands use batches <=100 without fallback or loss`, async () => {
  await bind();
  const initial = Array.from({ length: count }, (_, i) => row(i + 1));
  const store = new Map(initial.map(r => [r.id, r]));
  const batches: string[][] = [];
  let fallbacks = 0;
  await drainQueue({
    listQueueForUserFn: async () => [...store.values()],
    putQueuedActionFn: async r => { store.set(r.id, r); },
    deleteQueuedActionFn: async id => { store.delete(id); },
    headersFn: () => ({}),
    fetchFn: async (_url, init) => {
      const commands = JSON.parse(init!.body as string).commands;
      batches.push(commands.map((c: any) => c.commandId));
      return new Response(JSON.stringify({ results: commands.map((c: any) => ({ commandId: c.commandId, status: "ok" })) }), { status: commands.length > 100 ? 400 : 200 });
    },
    postJsonFn: async () => { fallbacks++; },
  });
  assert.equal(fallbacks, 0);
  assert.deepEqual(batches.map(b => b.length), count === 100 ? [100] : count === 101 ? [100, 1] : [100, 100, 5]);
  assert.deepEqual(batches.flat(), initial.map(r => r.commandId));
  assert.equal(store.size, 0);
});
it("P1-108 batch 429 retains all commands pending and avoids per-item request storm", async () => {
  await bind();
  const initial = [row(1), row(2)]; const store = new Map(initial.map(r => [r.id, r]));
  let fallbacks = 0;
  await drainQueue({ listQueueForUserFn: async () => [...store.values()], putQueuedActionFn: async r => { store.set(r.id, r); }, deleteQueuedActionFn: async id => { store.delete(id); }, headersFn: () => ({}), fetchFn: async () => new Response("{}", { status: 429 }), postJsonFn: async () => { fallbacks++; throw Object.assign(new Error("limited"), { status: 429 }); } });
  assert.equal(fallbacks, 0);
  assert.equal(store.size, 2); assert.ok([...store.values()].every(r => r.status === "pending"));
});
it("P1-102 P1-103 mixed, missing and unknown sync results preserve unconfirmed payloads", async () => {
  await bind(); const initial = [row(1), row(2), row(3), row(4), row(5)]; const store = new Map(initial.map(r => [r.id, r]));
  await drainQueue({ listQueueForUserFn: async () => [...store.values()], putQueuedActionFn: async r => { store.set(r.id, r); }, deleteQueuedActionFn: async id => { store.delete(id); }, headersFn: () => ({}), fetchFn: async () => new Response(JSON.stringify({ results: [{ commandId: row(1).commandId, status: "ok" }, { commandId: row(2).commandId, status: "conflict", code: "version_conflict", details: { currentVersion: 4 } }, { commandId: row(3).commandId, status: "forbidden" }, { commandId: row(4).commandId, status: "invented" }, { commandId: "not-sent", status: "ok" }] }), { status: 200 }) });
  assert.equal(store.has(row(1).id), false);
  assert.deepEqual([2, 3, 4, 5].map(i => store.get(row(i).id)!.status), ["conflict", "failed", "pending", "pending"]);
  for (const i of [2, 3, 4, 5]) assert.deepEqual(store.get(row(i).id)!.body, row(i).body);
});
