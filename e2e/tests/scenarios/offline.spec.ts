// Playwright test runner APIs for browser E2E scenarios.
import { expect, test } from "@playwright/test";

// Browser integration: production modules + real IndexedDB, controlled transport.
test.beforeEach(async ({ page }) => {
  await page.route("**/__scenario", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Browser integration harness</title><main id='root'></main>" }));
  await page.goto("/__scenario");
  await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { configurable: true, value: false }); });
});

// Case: temporary batch command failure retries on its own despite unrelated successful I/O.
test("temporary batch command failure retries on its own despite unrelated successful I/O", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const scope = await import(/* @vite-ignore */ "/src/offline/userScope.ts");
    scope.setOfflineUser("automatic-retry"); await scope.whenOfflineUserSettled();
    const ops = await import(/* @vite-ignore */ "/src/offline/queueOps.ts");
    const storage = await import(/* @vite-ignore */ "/src/offline/storage.ts");
    const { drainQueue } = await import(/* @vite-ignore */ "/src/offline/queueDrain.ts");
    const { postJsonWithSessionRefresh } = await import(/* @vite-ignore */ "/src/offline/transport.ts");
    const commandId = crypto.randomUUID();
    await ops.enqueue({ commandId, type: "ticket.start", url: "/tickets/retry/start", method: "POST", body: { commandId } });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const sent: string[] = [];
    let completed!: () => void;
    const retried = new Promise<void>(resolve => { completed = resolve; });
    await drainQueue({ headersFn: () => ({}), fetchFn: async (_url: string, init: RequestInit) => {
      const command = JSON.parse(String(init.body)).commands[0];
      sent.push(command.commandId);
      if (sent.length === 2) completed();
      return new Response(JSON.stringify({ results: [{ commandId: command.commandId,
        status: sent.length === 1 ? "error" : "ok", retryable: true }] }));
    } });
    const pending = await storage.listQueueForUser("automatic-retry");
    // This production transport calls markReachable after successful I/O.
    await postJsonWithSessionRefresh("/unrelated", {}, { headersFn: () => ({}),
      fetchFn: async () => new Response("{}") });
    // Brief yield so lock waiters/UI can settle before asserting.
    await Promise.race([retried, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("No automatic retry")), 10000))]);
    // Wait for the retry's production storage writes, not an extra drain/event.
    const { isDraining } = await import(/* @vite-ignore */ "/src/offline/connState.ts");
    // Repeat/poll to widen the race window or wait for lock waiters.
    while (isDraining()) await new Promise(resolve => setTimeout(resolve, 10));
    return { commandId, sent, pending, after: await storage.listQueueForUser("automatic-retry") };
  });
  expect(result.pending).toHaveLength(1);
  expect(result.pending[0]).toMatchObject({ status: "pending", retries: 1 });
  expect(result.sent).toEqual([result.commandId, result.commandId]);
  expect(result.after).toEqual([]);
});
// Case: real IndexedDB survives reload, recovers sending and retains unconfirmed results.
test("real IndexedDB survives reload, recovers sending and retains unconfirmed results", async ({ page }) => {
  await page.evaluate(async () => {
    const load = (p: string) => import(/* @vite-ignore */ p);
    const scope = await load("/src/offline/userScope.ts"); const ops = await load("/src/offline/queueOps.ts"); const storage = await load("/src/offline/storage.ts");
    scope.setOfflineUser("A"); await scope.whenOfflineUserSettled();
    // Repeat/poll to widen the race window or wait for lock waiters.
    for (let i = 0; i < 5; i++) {
      const result = await ops.enqueue({ commandId: `cmd-${i}`, type: "ticket.start", url: `/tickets/${i}/start`, method: "POST", body: { commandId: `cmd-${i}` } });
      if (i === 0) await storage.putQueuedAction({ ...result, status: "sending" });
    }
    await ops.saveMyWorkCache({ tasks: [{ id: "own-task" }], tickets: [{ id: "own-ticket" }], savedAt: 1, hotelDate: "2026-10-19" });
  });
  await page.reload();
  const result = await page.evaluate(async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const load = (p: string) => import(/* @vite-ignore */ p);
    const scope = await load("/src/offline/userScope.ts"); const ops = await load("/src/offline/queueOps.ts"); const storage = await load("/src/offline/storage.ts");
    scope.setOfflineUser("A"); await scope.whenOfflineUserSettled();
    const before = await ops.listQueuedActions(); const cache = await ops.loadMyWorkCache();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const drain = await load("/src/offline/queueDrain.ts"); let sent: string[] = [];
    await drain.drainQueue({ headersFn: () => ({}), fetchFn: async (_u: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string).commands.map((c: any) => c.commandId);
      return new Response(JSON.stringify({ results: [{ commandId: "cmd-0", status: "ok" }, { commandId: "cmd-1", status: "conflict", code: "version_conflict", details: { currentVersion: 4 } }, { commandId: "cmd-2", status: "forbidden" }, { commandId: "cmd-3", status: "unexpected" }] }));
    } });
    return { before, cache, sent, after: await storage.listQueueForUser("A"), stats: await ops.getQueueStats() };
  });
  expect(result.before).toHaveLength(5); expect(result.cache.tasks).toEqual([{ id: "own-task" }]);
  expect(result.sent).toHaveLength(5); expect(result.sent).toContain("cmd-0");
  expect(Object.fromEntries(result.after.map((r: any) => [r.commandId, r.status]))).toEqual({ "cmd-1": "conflict", "cmd-2": "failed", "cmd-3": "pending", "cmd-4": "pending" });
  expect(result.stats).toEqual({ pending: 2, sending: 0, conflict: 1, failed: 1 });
  await page.reload();
  expect(await page.evaluate(async () => (await import(/* @vite-ignore */ "/src/offline/storage.ts")).listQueueForUser("A"))).toHaveLength(4);
});
// Case: failed rows support scoped retry/dismiss and account switch survives failed purge.
test("failed rows support scoped retry/dismiss and account switch survives failed purge", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const load = (p: string) => import(/* @vite-ignore */ p);
    const scope = await load("/src/offline/userScope.ts"); const ops = await load("/src/offline/queueOps.ts"); const storage = await load("/src/offline/storage.ts"); const conn = await load("/src/offline/connState.ts");
    scope.setOfflineUser("A"); await scope.whenOfflineUserSettled();
    const a = await ops.enqueue({ commandId: "A-command", type: "ticket.start", url: "/tickets/a/start", method: "POST", body: { commandId: "A-command" } });
    const b = { ...a, id: "B-row", userId: "B", commandId: "B-command", status: "failed", lastError: "other" };
    await storage.putQueuedAction(b);
    await storage.putQueuedAction({ ...a, retries: 7 });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    await (await load("/src/offline/queueDrain.ts")).drainQueue({ headersFn: () => ({}), fetchFn: async () => { throw new Error("offline transport"); }, postJsonFn: async () => { throw new Error("final failure"); } }); conn.markReachable();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const failed = await storage.listQueueForUser("A");
    await ops.retryQueuedAction("B-row"); const foreign = await storage.listQueueForUser("B");
    await ops.retryQueuedAction(a.id); const retried = await storage.listQueueForUser("A");
    await storage.putQueuedAction({ ...retried[0], status: "failed" });
    const dismissed = await ops.resolveQueuedAction(a.id, { mode: "dismiss" });
    await ops.saveMyWorkCache({ tasks: [{ id: "secret-A" }], tickets: [{ id: "secret-ticket" }], hotelDate: "2026-10-19", savedAt: 1 });
    // Fail real object-store clear, so physical A data remains as a negative control.
    const clear = IDBObjectStore.prototype.clear;
    IDBObjectStore.prototype.clear = function () { throw new DOMException("fault: purge unavailable", "QuotaExceededError"); };
    try { scope.setOfflineUser("B"); await scope.whenOfflineUserSettled(); }
    // Always run cleanup to preserve DB/server isolation across cases.
    finally { IDBObjectStore.prototype.clear = clear; }
    return { failed, foreign, retried, dismissed, stats: await ops.getQueueStats(), visible: await ops.listQueuedActions(), cache: await ops.loadMyWorkCache(), physicalA: await storage.readMyWorkCache("A") };
  });
  expect(result.failed[0]).toMatchObject({ status: "failed", retries: 8, lastError: "final failure", commandId: "A-command" });
  expect(result.foreign[0]).toMatchObject({ status: "failed", commandId: "B-command", lastError: "other" });
  expect(result.retried[0]).toMatchObject({ status: "pending", retries: 0, commandId: "A-command" });
  expect(result.dismissed).toBe(true); expect(result.cache).toBeNull(); expect(result.physicalA.tasks[0].id).toBe("secret-A");
  expect(result.visible.every((r: any) => r.userId === "B")).toBe(true); expect(result.stats.failed).toBe(1);
});
// Case: real v1 upgrade discards unowned queue/cache and accepts scoped new records.
test("real v1 upgrade discards unowned queue/cache and accepts scoped new records", async ({ page }) => {
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => { const r = indexedDB.deleteDatabase("meridian-offline"); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error); });
    await new Promise<void>((resolve, reject) => { const r = indexedDB.open("meridian-offline", 1); r.onupgradeneeded = () => { r.result.createObjectStore("queue", { keyPath: "id" }); r.result.createObjectStore("cache", { keyPath: "key" }); }; r.onerror = () => reject(r.error); r.onsuccess = () => { const db = r.result; const tx = db.transaction(["queue", "cache"], "readwrite"); tx.objectStore("queue").put({ id: "unowned", body: { secret: "legacy" } }); tx.objectStore("cache").put({ key: "mywork", tasks: ["legacy"] }); tx.oncomplete = () => { db.close(); resolve(); }; }; });
  });
  const result = await page.evaluate(async () => {
    const storage = await import(/* @vite-ignore */ "/src/offline/storage.ts");
    const before = await storage.listQueueForUser("A"); const cache = await storage.readMyWorkCache("A");
    const scope = await import(/* @vite-ignore */ "/src/offline/userScope.ts"); scope.setOfflineUser("A"); await scope.whenOfflineUserSettled();
    await (await import(/* @vite-ignore */ "/src/offline/queueOps.ts")).enqueue({ commandId: "new", type: "ticket.start", url: "/tickets/new/start", method: "POST", body: {} });
    return { before, cache, after: await storage.listQueueForUser("A") };
  });
  expect(result.before).toEqual([]); expect(result.cache).toBeNull(); expect(result.after).toHaveLength(1); expect(result.after[0].userId).toBe("A");
});
// Case: persistence abort rejects the queued action without success.
test("persistence abort rejects the queued action without success", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const scope = await import(/* @vite-ignore */ "/src/offline/userScope.ts"); scope.setOfflineUser("A"); await scope.whenOfflineUserSettled();
    const storage = await import(/* @vite-ignore */ "/src/offline/storage.ts"); await storage.listQueueForUser("A");
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) { const request = put.apply(this, args); this.transaction.abort(); return request; };
    let error = ""; let success = false;
    try { await (await import(/* @vite-ignore */ "/src/offline/runOrEnqueue.ts")).startTicketQueued("ticket"); success = true; }
    // Swallow/record expected errors without abandoning isolation cleanup.
    catch (err) { error = String(err); }
    // Always run cleanup to preserve DB/server isolation across cases.
    finally { IDBObjectStore.prototype.put = put; }
    return { error, success, rows: await storage.listQueueForUser("A") };
  });
  expect(result.success).toBe(false); expect(result.error).toBeTruthy(); expect(result.rows).toEqual([]);
});
// Case probes concurrency/isolation: real IndexedDB preserves creation order with tied clocks across the 100-command boundary.
test("real IndexedDB preserves creation order with tied clocks across the 100-command boundary", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const load = (p: string) => import(/* @vite-ignore */ p);
    const scope = await load("/src/offline/userScope.ts"); const ops = await load("/src/offline/queueOps.ts");
    scope.setOfflineUser("A"); await scope.whenOfflineUserSettled();
    const dateNow = Date.now; Date.now = () => 1792368000000;
    try {
      // Repeat/poll to widen the race window or wait for lock waiters.
      for (let i = 0; i < 101; i++) await ops.enqueue({ id: `reverse-${String(101 - i).padStart(4, "0")}`, commandId: `cmd-${i}`, type: "ticket.start", url: `/maintenance/tickets/${i}/start`, method: "POST", body: { commandId: `cmd-${i}` } });
    } finally { Date.now = dateNow; }
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const batches: string[][] = []; let fallbacks = 0;
    await (await load("/src/offline/queueDrain.ts")).drainQueue({ headersFn: () => ({}), fetchFn: async (_u: string, init: RequestInit) => {
      const commands = JSON.parse(init.body as string).commands; batches.push(commands.map((c: any) => c.commandId));
      return new Response(JSON.stringify({ results: commands.map((c: any) => ({ commandId: c.commandId, status: "ok" })) }), { status: commands.length <= 100 ? 200 : 400 });
    }, postJsonFn: async () => { fallbacks++; } });
    return { batches, fallbacks, rows: await ops.listQueuedActions() };
  });
  expect(result.batches.map(b => b.length)).toEqual([100, 1]); expect(result.fallbacks).toBe(0);
  expect(result.batches.flat()).toEqual(Array.from({ length: 101 }, (_, i) => `cmd-${i}`)); expect(result.rows).toEqual([]);
});
// Case probes concurrency/isolation: concurrent interactive and outbox 401s share refresh and retry identical bodies with fresh CSRF.
test("concurrent interactive and outbox 401s share refresh and retry identical bodies with fresh CSRF", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const http = await import(/* @vite-ignore */ "/src/api/http.ts");
    const transport = await import(/* @vite-ignore */ "/src/offline/transport.ts");
    document.cookie = "csrf=before; path=/";
    const original = window.fetch; const attempts: Record<string, any[]> = {}; let refreshes = 0; let firsts = 0; let release: (() => void) | undefined;
    const maybe = () => { if (firsts === 3 && release) release(); };
    window.fetch = (async (input: any, init: any) => {
      const url = String(input);
      if (url.endsWith("/auth/refresh")) {
        refreshes++;
        await new Promise<void>(r => { release = r; maybe(); }); document.cookie = "csrf=after; path=/";
        return new Response("{}", { status: 200 });
      }
      const rows = attempts[url] ??= []; rows.push({ body: init.body, csrf: new Headers(init.headers).get("X-CSRF-Token") });
      if (rows.length === 1) { firsts++; maybe(); return new Response("{}", { status: 401 }); }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      // Run actors together to expose races and serialization bugs.
      await Promise.all([
        http.apiFetch("/api/scenario-a", { method: "POST", headers: http.authHeaders("POST"), body: JSON.stringify({ commandId: "a", nested: { value: 1 } }) }),
        http.apiFetch("/api/scenario-b", { method: "POST", headers: http.authHeaders("POST"), body: JSON.stringify({ commandId: "b", value: 2 }) }),
        transport.postJsonWithSessionRefresh("/api/scenario-c", { commandId: "c", value: 3 }),
      ]);
      return { refreshes, attempts };
    } finally { window.fetch = original; }
  });
  expect(result.refreshes).toBe(1);
  for (const rows of Object.values(result.attempts)) {
    expect(rows).toHaveLength(2); expect(rows[0].body).toBe(rows[1].body); expect(rows.map(r => r.csrf)).toEqual(["before", "after"]);
  }
});
// Case checks authz/session policy: refresh transient failure preserves nonempty private stores; rejection/logout purge them.
test("refresh transient failure preserves nonempty private stores; rejection/logout purge them", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const load = (p: string) => import(/* @vite-ignore */ p);
    const scope = await load("/src/offline/userScope.ts"); const ops = await load("/src/offline/queueOps.ts"); const storage = await load("/src/offline/storage.ts"); const http = await load("/src/api/http.ts");
    scope.setOfflineUser("A"); await scope.whenOfflineUserSettled(); localStorage.setItem("user", JSON.stringify({ id: "A" }));
    await ops.enqueue({ commandId: "keep", type: "ticket.start", url: "/tickets/a/start", method: "POST", body: { commandId: "keep" } });
    await ops.saveMyWorkCache({ tasks: [{ id: "task-A" }], tickets: [{ id: "ticket-A" }], hotelDate: "2026-10-19", savedAt: 1 });
    const original = window.fetch;
    try {
      window.fetch = (async () => new Response("{}", { status: 503 })) as typeof fetch;
      const transient = await http.refreshAccessToken(); const kept = await storage.listQueueForUser("A"); const cache = await storage.readMyWorkCache("A");
      window.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
      const rejected = await http.refreshAccessToken(); await scope.whenOfflineUserSettled();
      const purged = await storage.listQueueForUser("A"); const erased = await storage.readMyWorkCache("A");
      scope.setOfflineUser("A"); await scope.whenOfflineUserSettled(); await ops.enqueue({ commandId: "logout", type: "ticket.start", url: "/tickets/a/start", method: "POST", body: {} });
      await http.logout();
      return { transient, kept, cache, rejected, purged, erased, logout: await storage.listQueueForUser("A"), user: localStorage.getItem("user") };
    } finally { window.fetch = original; }
  });
  expect(result.transient).toBe("transient"); expect(result.kept).toHaveLength(1); expect(result.cache.tasks).toHaveLength(1);
  expect(result.rejected).toBe("rejected"); expect(result.purged).toEqual([]); expect(result.erased).toBeNull(); expect(result.logout).toEqual([]); expect(result.user).toBeNull();
});
// Case: server 503 queues identical payload; 401/429 preserve real pending storage.
test("server 503 queues identical payload; 401/429 preserve real pending storage", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const scope = await import(/* @vite-ignore */ "/src/offline/userScope.ts"); const ops = await import(/* @vite-ignore */ "/src/offline/queueOps.ts"); const storage = await import(/* @vite-ignore */ "/src/offline/storage.ts"); const conn = await import(/* @vite-ignore */ "/src/offline/connState.ts");
    scope.setOfflineUser("A"); await scope.whenOfflineUserSettled(); Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const original = window.fetch; let body: any;
    try {
      window.fetch = (async (input: any, init: any) => { if (!String(input).endsWith("/sync/push") && typeof init?.body === "string") body ??= JSON.parse(init.body); Object.defineProperty(navigator, "onLine", { configurable: true, value: false }); return new Response('{"message":"Unavailable"}', { status: 503 }); }) as typeof fetch;
      const queued = await (await import(/* @vite-ignore */ "/src/offline/runOrEnqueue.ts")).startTicketQueued("ticket-503");
      const rows = await storage.listQueueForUser("A"); const after = [];
      for (const status of [401, 429]) { Object.defineProperty(navigator, "onLine", { configurable: true, value: true }); conn.markReachable(); let calls = 0; let fallbacks = 0;
        await (await import(/* @vite-ignore */ "/src/offline/queueDrain.ts")).drainQueue({ headersFn: () => ({}), refreshFn: async () => "transient", fetchFn: async () => { calls++; return new Response("{}", { status }); }, postJsonFn: async () => { fallbacks++; } });
        after.push({ status, calls, fallbacks, rows: await ops.listQueuedActions() });
      }
      return { queued, body, rows, after };
    } finally { window.fetch = original; }
  });
  expect(result.queued.queued).toBe(true); expect(result.rows).toHaveLength(1); expect(result.rows[0].body).toEqual(result.body);
  for (const item of result.after) { expect(item.calls).toBe(1); expect(item.fallbacks).toBe(0); expect(item.rows).toHaveLength(1); expect(item.rows[0]).toMatchObject({ status: "pending", body: result.body }); }
});
// Case probes concurrency/isolation: explicit rebase changes version only; ownership conflicts remain blocked.
test("explicit rebase changes version only; ownership conflicts remain blocked", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const scope = await import(/* @vite-ignore */ "/src/offline/userScope.ts"); const ops = await import(/* @vite-ignore */ "/src/offline/queueOps.ts"); const storage = await import(/* @vite-ignore */ "/src/offline/storage.ts");
    scope.setOfflineUser("A"); await scope.whenOfflineUserSettled();
    const row = await ops.enqueue({ commandId: "same-command", type: "cleaning.start", method: "POST", url: "/cleaning/tasks/task/start", body: { taskId: "task", expectedVersion: 1, commandId: "same-command" } });
    await storage.putQueuedAction({ ...row, status: "conflict", conflictCode: "version_conflict", conflictDetails: { currentVersion: 3 } });
    const rebased = await ops.resolveQueuedAction(row.id, { mode: "rebase" }); const fresh = (await ops.listQueuedActions())[0]!;
    await storage.putQueuedAction({ ...fresh, status: "conflict", conflictCode: "assignee_conflict", conflictDetails: { currentVersion: 4, assignedEmployeeId: "other" } });
    const denied = await ops.resolveQueuedAction(row.id, { mode: "rebase" }); return { rebased, fresh, denied, final: (await ops.listQueuedActions())[0] };
  });
  expect(result.rebased).toBe(true); expect(result.fresh.body).toEqual({ taskId: "task", expectedVersion: 3, commandId: "same-command" }); expect(result.denied).toBe(false); expect(result.final!.status).toBe("conflict"); expect(result.final!.body).toEqual(result.fresh.body);
});
