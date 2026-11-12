// Playwright test runner APIs for browser E2E scenarios.
import { expect, test } from "@playwright/test";

// Browser integration: production modules + real IndexedDB, controlled transport.
test.beforeEach(async ({ page }) => {
  // Await async work before asserting or releasing locks.
  await page.route("**/__scenario", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Browser integration harness</title><main id='root'></main>" }));
  // Drive the browser through the user-visible workflow step.
  await page.goto("/__scenario");
  // Await async work before asserting or releasing locks.
  await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { configurable: true, value: false }); });
});

// Case: temporary batch command failure retries on its own despite unrelated successful I/O.
test("temporary batch command failure retries on its own despite unrelated successful I/O", async ({ page }) => {
  // result: synchronize actors so the race window is observable.
  const result = await page.evaluate(async () => {
    // scope: synchronize actors so the race window is observable.
    const scope = await import(/* @vite-ignore */ "/src/offline/userScope.ts");
    // Await async work before asserting or releasing locks.
    scope.setOfflineUser("automatic-retry"); await scope.whenOfflineUserSettled();
    // ops: synchronize actors so the race window is observable.
    const ops = await import(/* @vite-ignore */ "/src/offline/queueOps.ts");
    // storage: synchronize actors so the race window is observable.
    const storage = await import(/* @vite-ignore */ "/src/offline/storage.ts");
    // Await async work before asserting or releasing locks.
    const { drainQueue } = await import(/* @vite-ignore */ "/src/offline/queueDrain.ts");
    // Await async work before asserting or releasing locks.
    const { postJsonWithSessionRefresh } = await import(/* @vite-ignore */ "/src/offline/transport.ts");
    // commandId: unique stamp so parallel runs do not collide.
    const commandId = crypto.randomUUID();
    // Await async work before asserting or releasing locks.
    await ops.enqueue({ commandId, type: "ticket.start", url: "/tickets/retry/start", method: "POST", body: { commandId } });
    // Execute the next setup or assertion step for this scenario.
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    // Execute the next setup or assertion step for this scenario.
    const sent: string[] = [];
    // Execute the next setup or assertion step for this scenario.
    let completed!: () => void;
    // Bind retried for later setup or assertions in this scope.
    const retried = new Promise<void>(resolve => { completed = resolve; });
    // Await async work before asserting or releasing locks.
    await drainQueue({ headersFn: () => ({}), fetchFn: async (_url: string, init: RequestInit) => {
      // Bind command for later setup or assertions in this scope.
      const command = JSON.parse(String(init.body)).commands[0];
      // Execute the next setup or assertion step for this scenario.
      sent.push(command.commandId);
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (sent.length === 2) completed();
      // Return the arranged value/result to the caller.
      return new Response(JSON.stringify({ results: [{ commandId: command.commandId,
        // Fixture field status for the seeded actor/entity.
        status: sent.length === 1 ? "error" : "ok", retryable: true }] }));
    // Execute the next setup or assertion step for this scenario.
    } });
    // pending: synchronize actors so the race window is observable.
    const pending = await storage.listQueueForUser("automatic-retry");
    // This production transport calls markReachable after successful I/O.
    await postJsonWithSessionRefresh("/unrelated", {}, { headersFn: () => ({}),
      // Execute the next setup or assertion step for this scenario.
      fetchFn: async () => new Response("{}") });
    // Brief yield so lock waiters/UI can settle before asserting.
    await Promise.race([retried, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("No automatic retry")), 10000))]);
    // Wait for the retry's production storage writes, not an extra drain/event.
    const { isDraining } = await import(/* @vite-ignore */ "/src/offline/connState.ts");
    // Repeat/poll to widen the race window or wait for lock waiters.
    while (isDraining()) await new Promise(resolve => setTimeout(resolve, 10));
    // Return the arranged value/result to the caller.
    return { commandId, sent, pending, after: await storage.listQueueForUser("automatic-retry") };
  });
  // Assert browser/UI outcome matches the scenario intent.
  expect(result.pending).toHaveLength(1);
  // Assert response/page reached the expected status.
  expect(result.pending[0]).toMatchObject({ status: "pending", retries: 1 });
  // Assert browser/UI outcome matches the scenario intent.
  expect(result.sent).toEqual([result.commandId, result.commandId]);
  // Assert browser/UI outcome matches the scenario intent.
  expect(result.after).toEqual([]);
});
// Case: real IndexedDB survives reload, recovers sending and retains unconfirmed results.
test("real IndexedDB survives reload, recovers sending and retains unconfirmed results", async ({ page }) => {
  // Await async work before asserting or releasing locks.
  await page.evaluate(async () => {
    // Bind load for later setup or assertions in this scope.
    const load = (p: string) => import(/* @vite-ignore */ p);
    // scope: synchronize actors so the race window is observable.
    const scope = await load("/src/offline/userScope.ts"); const ops = await load("/src/offline/queueOps.ts"); const storage = await load("/src/offline/storage.ts");
    // Await async work before asserting or releasing locks.
    scope.setOfflineUser("A"); await scope.whenOfflineUserSettled();
    // Repeat/poll to widen the race window or wait for lock waiters.
    for (let i = 0; i < 5; i++) {
      // result: HTTP response captured for status/body checks.
      const result = await ops.enqueue({ commandId: `cmd-${i}`, type: "ticket.start", url: `/tickets/${i}/start`, method: "POST", body: { commandId: `cmd-${i}` } });
      // Guard optional cleanup or alternate assertion paths.
      if (i === 0) await storage.putQueuedAction({ ...result, status: "sending" });
    }
    // Await async work before asserting or releasing locks.
    await ops.saveMyWorkCache({ tasks: [{ id: "own-task" }], tickets: [{ id: "own-ticket" }], savedAt: 1, hotelDate: "2026-10-19" });
  });
  // Await async work before asserting or releasing locks.
  await page.reload();
  // result: synchronize actors so the race window is observable.
  const result = await page.evaluate(async () => {
    // Execute the next setup or assertion step for this scenario.
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    // Bind load for later setup or assertions in this scope.
    const load = (p: string) => import(/* @vite-ignore */ p);
    // scope: synchronize actors so the race window is observable.
    const scope = await load("/src/offline/userScope.ts"); const ops = await load("/src/offline/queueOps.ts"); const storage = await load("/src/offline/storage.ts");
    // Await async work before asserting or releasing locks.
    scope.setOfflineUser("A"); await scope.whenOfflineUserSettled();
    // before: synchronize actors so the race window is observable.
    const before = await ops.listQueuedActions(); const cache = await ops.loadMyWorkCache();
    // Execute the next setup or assertion step for this scenario.
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    // drain: synchronize actors so the race window is observable.
    const drain = await load("/src/offline/queueDrain.ts"); let sent: string[] = [];
    // Await async work before asserting or releasing locks.
    await drain.drainQueue({ headersFn: () => ({}), fetchFn: async (_u: string, init: RequestInit) => {
      // Execute the next setup or assertion step for this scenario.
      sent = JSON.parse(init.body as string).commands.map((c: any) => c.commandId);
      // Return the arranged value/result to the caller.
      return new Response(JSON.stringify({ results: [{ commandId: "cmd-0", status: "ok" }, { commandId: "cmd-1", status: "conflict", code: "version_conflict", details: { currentVersion: 4 } }, { commandId: "cmd-2", status: "forbidden" }, { commandId: "cmd-3", status: "unexpected" }] }));
    // Execute the next setup or assertion step for this scenario.
    } });
    // Return the arranged value/result to the caller.
    return { before, cache, sent, after: await storage.listQueueForUser("A"), stats: await ops.getQueueStats() };
  });
  // Assert browser/UI outcome matches the scenario intent.
  expect(result.before).toHaveLength(5); expect(result.cache.tasks).toEqual([{ id: "own-task" }]);
  // Assert browser/UI outcome matches the scenario intent.
  expect(result.sent).toHaveLength(5); expect(result.sent).toContain("cmd-0");
  // Assert response/page reached the expected status.
  expect(Object.fromEntries(result.after.map((r: any) => [r.commandId, r.status]))).toEqual({ "cmd-1": "conflict", "cmd-2": "failed", "cmd-3": "pending", "cmd-4": "pending" });
  // Assert browser/UI outcome matches the scenario intent.
  expect(result.stats).toEqual({ pending: 2, sending: 0, conflict: 1, failed: 1 });
  // Await async work before asserting or releasing locks.
  await page.reload();
  // Assert browser/UI outcome matches the scenario intent.
  expect(await page.evaluate(async () => (await import(/* @vite-ignore */ "/src/offline/storage.ts")).listQueueForUser("A"))).toHaveLength(4);
});
// Case: failed rows support scoped retry/dismiss and account switch survives failed purge.
test("failed rows support scoped retry/dismiss and account switch survives failed purge", async ({ page }) => {
  // result: synchronize actors so the race window is observable.
  const result = await page.evaluate(async () => {
    // Bind load for later setup or assertions in this scope.
    const load = (p: string) => import(/* @vite-ignore */ p);
    // scope: synchronize actors so the race window is observable.
    const scope = await load("/src/offline/userScope.ts"); const ops = await load("/src/offline/queueOps.ts"); const storage = await load("/src/offline/storage.ts"); const conn = await load("/src/offline/connState.ts");
    // Await async work before asserting or releasing locks.
    scope.setOfflineUser("A"); await scope.whenOfflineUserSettled();
    // a: HTTP response captured for status/body checks.
    const a = await ops.enqueue({ commandId: "A-command", type: "ticket.start", url: "/tickets/a/start", method: "POST", body: { commandId: "A-command" } });
    // Bind b for later setup or assertions in this scope.
    const b = { ...a, id: "B-row", userId: "B", commandId: "B-command", status: "failed", lastError: "other" };
    // Await async work before asserting or releasing locks.
    await storage.putQueuedAction(b);
    // Await async work before asserting or releasing locks.
    await storage.putQueuedAction({ ...a, retries: 7 });
    // Execute the next setup or assertion step for this scenario.
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    // Await async work before asserting or releasing locks.
    await (await load("/src/offline/queueDrain.ts")).drainQueue({ headersFn: () => ({}), fetchFn: async () => { throw new Error("offline transport"); }, postJsonFn: async () => { throw new Error("final failure"); } }); conn.markReachable();
    // Execute the next setup or assertion step for this scenario.
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    // failed: synchronize actors so the race window is observable.
    const failed = await storage.listQueueForUser("A");
    // Await async work before asserting or releasing locks.
    await ops.retryQueuedAction("B-row"); const foreign = await storage.listQueueForUser("B");
    // Await async work before asserting or releasing locks.
    await ops.retryQueuedAction(a.id); const retried = await storage.listQueueForUser("A");
    // Await async work before asserting or releasing locks.
    await storage.putQueuedAction({ ...retried[0], status: "failed" });
    // dismissed: synchronize actors so the race window is observable.
    const dismissed = await ops.resolveQueuedAction(a.id, { mode: "dismiss" });
    // Await async work before asserting or releasing locks.
    await ops.saveMyWorkCache({ tasks: [{ id: "secret-A" }], tickets: [{ id: "secret-ticket" }], hotelDate: "2026-10-19", savedAt: 1 });
    // Fail real object-store clear, so physical A data remains as a negative control.
    const clear = IDBObjectStore.prototype.clear;
    // Execute the next setup or assertion step for this scenario.
    IDBObjectStore.prototype.clear = function () { throw new DOMException("fault: purge unavailable", "QuotaExceededError"); };
    // Try path where partial failure must not leak suite state.
    try { scope.setOfflineUser("B"); await scope.whenOfflineUserSettled(); }
    // Always run cleanup to preserve DB/server isolation across cases.
    finally { IDBObjectStore.prototype.clear = clear; }
    // Return the arranged value/result to the caller.
    return { failed, foreign, retried, dismissed, stats: await ops.getQueueStats(), visible: await ops.listQueuedActions(), cache: await ops.loadMyWorkCache(), physicalA: await storage.readMyWorkCache("A") };
  });
  // Assert response/page reached the expected status.
  expect(result.failed[0]).toMatchObject({ status: "failed", retries: 8, lastError: "final failure", commandId: "A-command" });
  // Assert response/page reached the expected status.
  expect(result.foreign[0]).toMatchObject({ status: "failed", commandId: "B-command", lastError: "other" });
  // Assert response/page reached the expected status.
  expect(result.retried[0]).toMatchObject({ status: "pending", retries: 0, commandId: "A-command" });
  // Assert browser/UI outcome matches the scenario intent.
  expect(result.dismissed).toBe(true); expect(result.cache).toBeNull(); expect(result.physicalA.tasks[0].id).toBe("secret-A");
  // Assert response/page reached the expected status.
  expect(result.visible.every((r: any) => r.userId === "B")).toBe(true); expect(result.stats.failed).toBe(1);
});
// Case: real v1 upgrade discards unowned queue/cache and accepts scoped new records.
test("real v1 upgrade discards unowned queue/cache and accepts scoped new records", async ({ page }) => {
  // Await async work before asserting or releasing locks.
  await page.evaluate(async () => {
    // Await async work before asserting or releasing locks.
    await new Promise<void>((resolve, reject) => { const r = indexedDB.deleteDatabase("meridian-offline"); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error); });
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    await new Promise<void>((resolve, reject) => { const r = indexedDB.open("meridian-offline", 1); r.onupgradeneeded = () => { r.result.createObjectStore("queue", { keyPath: "id" }); r.result.createObjectStore("cache", { keyPath: "key" }); }; r.onerror = () => reject(r.error); r.onsuccess = () => { const db = r.result; const tx = db.transaction(["queue", "cache"], "readwrite"); tx.objectStore("queue").put({ id: "unowned", body: { secret: "legacy" } }); tx.objectStore("cache").put({ key: "mywork", tasks: ["legacy"] }); tx.oncomplete = () => { db.close(); resolve(); }; }; });
  });
  // result: synchronize actors so the race window is observable.
  const result = await page.evaluate(async () => {
    // storage: synchronize actors so the race window is observable.
    const storage = await import(/* @vite-ignore */ "/src/offline/storage.ts");
    // before: synchronize actors so the race window is observable.
    const before = await storage.listQueueForUser("A"); const cache = await storage.readMyWorkCache("A");
    // scope: synchronize actors so the race window is observable.
    const scope = await import(/* @vite-ignore */ "/src/offline/userScope.ts"); scope.setOfflineUser("A"); await scope.whenOfflineUserSettled();
    // Await async work before asserting or releasing locks.
    await (await import(/* @vite-ignore */ "/src/offline/queueOps.ts")).enqueue({ commandId: "new", type: "ticket.start", url: "/tickets/new/start", method: "POST", body: {} });
    // Return the arranged value/result to the caller.
    return { before, cache, after: await storage.listQueueForUser("A") };
  });
  // Assert browser/UI outcome matches the scenario intent.
  expect(result.before).toEqual([]); expect(result.cache).toBeNull(); expect(result.after).toHaveLength(1); expect(result.after[0].userId).toBe("A");
});
// Case: persistence abort rejects the queued action without success.
test("persistence abort rejects the queued action without success", async ({ page }) => {
  // result: synchronize actors so the race window is observable.
  const result = await page.evaluate(async () => {
    // scope: synchronize actors so the race window is observable.
    const scope = await import(/* @vite-ignore */ "/src/offline/userScope.ts"); scope.setOfflineUser("A"); await scope.whenOfflineUserSettled();
    // storage: synchronize actors so the race window is observable.
    const storage = await import(/* @vite-ignore */ "/src/offline/storage.ts"); await storage.listQueueForUser("A");
    // Bind put for later setup or assertions in this scope.
    const put = IDBObjectStore.prototype.put;
    // Execute the next setup or assertion step for this scenario.
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) { const request = put.apply(this, args); this.transaction.abort(); return request; };
    // Bind error for later setup or assertions in this scope.
    let error = ""; let success = false;
    // Try path where partial failure must not leak suite state.
    try { await (await import(/* @vite-ignore */ "/src/offline/runOrEnqueue.ts")).startTicketQueued("ticket"); success = true; }
    // Swallow/record expected errors without abandoning isolation cleanup.
    catch (err) { error = String(err); }
    // Always run cleanup to preserve DB/server isolation across cases.
    finally { IDBObjectStore.prototype.put = put; }
    // Return the arranged value/result to the caller.
    return { error, success, rows: await storage.listQueueForUser("A") };
  });
  // Assert browser/UI outcome matches the scenario intent.
  expect(result.success).toBe(false); expect(result.error).toBeTruthy(); expect(result.rows).toEqual([]);
});
// Case probes concurrency/isolation: real IndexedDB preserves creation order with tied clocks across the 100-command boundary.
test("real IndexedDB preserves creation order with tied clocks across the 100-command boundary", async ({ page }) => {
  // result: synchronize actors so the race window is observable.
  const result = await page.evaluate(async () => {
    // Bind load for later setup or assertions in this scope.
    const load = (p: string) => import(/* @vite-ignore */ p);
    // scope: synchronize actors so the race window is observable.
    const scope = await load("/src/offline/userScope.ts"); const ops = await load("/src/offline/queueOps.ts");
    // Await async work before asserting or releasing locks.
    scope.setOfflineUser("A"); await scope.whenOfflineUserSettled();
    // Bind dateNow for later setup or assertions in this scope.
    const dateNow = Date.now; Date.now = () => 1792368000000;
    // Try path where partial failure must not leak suite state.
    try {
      // Repeat/poll to widen the race window or wait for lock waiters.
      for (let i = 0; i < 101; i++) await ops.enqueue({ id: `reverse-${String(101 - i).padStart(4, "0")}`, commandId: `cmd-${i}`, type: "ticket.start", url: `/maintenance/tickets/${i}/start`, method: "POST", body: { commandId: `cmd-${i}` } });
    // Execute the next setup or assertion step for this scenario.
    } finally { Date.now = dateNow; }
    // Execute the next setup or assertion step for this scenario.
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    // Execute the next setup or assertion step for this scenario.
    const batches: string[][] = []; let fallbacks = 0;
    // Await async work before asserting or releasing locks.
    await (await load("/src/offline/queueDrain.ts")).drainQueue({ headersFn: () => ({}), fetchFn: async (_u: string, init: RequestInit) => {
      // Bind commands for later setup or assertions in this scope.
      const commands = JSON.parse(init.body as string).commands; batches.push(commands.map((c: any) => c.commandId));
      // Return the arranged value/result to the caller.
      return new Response(JSON.stringify({ results: commands.map((c: any) => ({ commandId: c.commandId, status: "ok" })) }), { status: commands.length <= 100 ? 200 : 400 });
    // Execute the next setup or assertion step for this scenario.
    }, postJsonFn: async () => { fallbacks++; } });
    // Return the arranged value/result to the caller.
    return { batches, fallbacks, rows: await ops.listQueuedActions() };
  });
  // Assert response/page reached the expected status.
  expect(result.batches.map(b => b.length)).toEqual([100, 1]); expect(result.fallbacks).toBe(0);
  // Assert browser/UI outcome matches the scenario intent.
  expect(result.batches.flat()).toEqual(Array.from({ length: 101 }, (_, i) => `cmd-${i}`)); expect(result.rows).toEqual([]);
});
// Case probes concurrency/isolation: concurrent interactive and outbox 401s share refresh and retry identical bodies with fresh CSRF.
test("concurrent interactive and outbox 401s share refresh and retry identical bodies with fresh CSRF", async ({ page }) => {
  // result: synchronize actors so the race window is observable.
  const result = await page.evaluate(async () => {
    // http: synchronize actors so the race window is observable.
    const http = await import(/* @vite-ignore */ "/src/api/http.ts");
    // transport: synchronize actors so the race window is observable.
    const transport = await import(/* @vite-ignore */ "/src/offline/transport.ts");
    // Session/CSRF step exercising auth lifecycle.
    document.cookie = "csrf=before; path=/";
    // Bind original for later setup or assertions in this scope.
    const original = window.fetch; const attempts: Record<string, any[]> = {}; let refreshes = 0; let firsts = 0; let release: (() => void) | undefined;
    // Bind maybe for later setup or assertions in this scope.
    const maybe = () => { if (firsts === 3 && release) release(); };
    // Execute the next setup or assertion step for this scenario.
    window.fetch = (async (input: any, init: any) => {
      // Bind url for later setup or assertions in this scope.
      const url = String(input);
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (url.endsWith("/auth/refresh")) {
        // Session/CSRF step exercising auth lifecycle.
        refreshes++;
        // Await async work before asserting or releasing locks.
        await new Promise<void>(r => { release = r; maybe(); }); document.cookie = "csrf=after; path=/";
        // Return the arranged value/result to the caller.
        return new Response("{}", { status: 200 });
      }
      // Bind rows for later setup or assertions in this scope.
      const rows = attempts[url] ??= []; rows.push({ body: init.body, csrf: new Headers(init.headers).get("X-CSRF-Token") });
      // Guard optional cleanup or alternate assertion paths.
      if (rows.length === 1) { firsts++; maybe(); return new Response("{}", { status: 401 }); }
      // Return the arranged value/result to the caller.
      return new Response("{}", { status: 200 });
    // Execute the next setup or assertion step for this scenario.
    }) as typeof fetch;
    // Try path where partial failure must not leak suite state.
    try {
      // Run actors together to expose races and serialization bugs.
      await Promise.all([
        // Execute the next setup or assertion step for this scenario.
        http.apiFetch("/api/scenario-a", { method: "POST", headers: http.authHeaders("POST"), body: JSON.stringify({ commandId: "a", nested: { value: 1 } }) }),
        // Execute the next setup or assertion step for this scenario.
        http.apiFetch("/api/scenario-b", { method: "POST", headers: http.authHeaders("POST"), body: JSON.stringify({ commandId: "b", value: 2 }) }),
        // Session/CSRF step exercising auth lifecycle.
        transport.postJsonWithSessionRefresh("/api/scenario-c", { commandId: "c", value: 3 }),
      ]);
      // Return the arranged value/result to the caller.
      return { refreshes, attempts };
    // Execute the next setup or assertion step for this scenario.
    } finally { window.fetch = original; }
  });
  // Assert response/page reached the expected status.
  expect(result.refreshes).toBe(1);
  // Iterate to cover variants or wait until a condition holds.
  for (const rows of Object.values(result.attempts)) {
    // Assert browser/UI outcome matches the scenario intent.
    expect(rows).toHaveLength(2); expect(rows[0].body).toBe(rows[1].body); expect(rows.map(r => r.csrf)).toEqual(["before", "after"]);
  }
});
// Case checks authz/session policy: refresh transient failure preserves nonempty private stores; rejection/logout purge them.
test("refresh transient failure preserves nonempty private stores; rejection/logout purge them", async ({ page }) => {
  // result: synchronize actors so the race window is observable.
  const result = await page.evaluate(async () => {
    // Bind load for later setup or assertions in this scope.
    const load = (p: string) => import(/* @vite-ignore */ p);
    // scope: synchronize actors so the race window is observable.
    const scope = await load("/src/offline/userScope.ts"); const ops = await load("/src/offline/queueOps.ts"); const storage = await load("/src/offline/storage.ts"); const http = await load("/src/api/http.ts");
    // Await async work before asserting or releasing locks.
    scope.setOfflineUser("A"); await scope.whenOfflineUserSettled(); localStorage.setItem("user", JSON.stringify({ id: "A" }));
    // Await async work before asserting or releasing locks.
    await ops.enqueue({ commandId: "keep", type: "ticket.start", url: "/tickets/a/start", method: "POST", body: { commandId: "keep" } });
    // Await async work before asserting or releasing locks.
    await ops.saveMyWorkCache({ tasks: [{ id: "task-A" }], tickets: [{ id: "ticket-A" }], hotelDate: "2026-10-19", savedAt: 1 });
    // Bind original for later setup or assertions in this scope.
    const original = window.fetch;
    // Try path where partial failure must not leak suite state.
    try {
      // Execute the next setup or assertion step for this scenario.
      window.fetch = (async () => new Response("{}", { status: 503 })) as typeof fetch;
      // transient: synchronize actors so the race window is observable.
      const transient = await http.refreshAccessToken(); const kept = await storage.listQueueForUser("A"); const cache = await storage.readMyWorkCache("A");
      // Execute the next setup or assertion step for this scenario.
      window.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
      // rejected: synchronize actors so the race window is observable.
      const rejected = await http.refreshAccessToken(); await scope.whenOfflineUserSettled();
      // purged: synchronize actors so the race window is observable.
      const purged = await storage.listQueueForUser("A"); const erased = await storage.readMyWorkCache("A");
      // Await async work before asserting or releasing locks.
      scope.setOfflineUser("A"); await scope.whenOfflineUserSettled(); await ops.enqueue({ commandId: "logout", type: "ticket.start", url: "/tickets/a/start", method: "POST", body: {} });
      // Await async work before asserting or releasing locks.
      await http.logout();
      // Return the arranged value/result to the caller.
      return { transient, kept, cache, rejected, purged, erased, logout: await storage.listQueueForUser("A"), user: localStorage.getItem("user") };
    // Execute the next setup or assertion step for this scenario.
    } finally { window.fetch = original; }
  });
  // Assert browser/UI outcome matches the scenario intent.
  expect(result.transient).toBe("transient"); expect(result.kept).toHaveLength(1); expect(result.cache.tasks).toHaveLength(1);
  // Assert browser/UI outcome matches the scenario intent.
  expect(result.rejected).toBe("rejected"); expect(result.purged).toEqual([]); expect(result.erased).toBeNull(); expect(result.logout).toEqual([]); expect(result.user).toBeNull();
});
// Case: server 503 queues identical payload; 401/429 preserve real pending storage.
test("server 503 queues identical payload; 401/429 preserve real pending storage", async ({ page }) => {
  // result: synchronize actors so the race window is observable.
  const result = await page.evaluate(async () => {
    // scope: synchronize actors so the race window is observable.
    const scope = await import(/* @vite-ignore */ "/src/offline/userScope.ts"); const ops = await import(/* @vite-ignore */ "/src/offline/queueOps.ts"); const storage = await import(/* @vite-ignore */ "/src/offline/storage.ts"); const conn = await import(/* @vite-ignore */ "/src/offline/connState.ts");
    // Await async work before asserting or releasing locks.
    scope.setOfflineUser("A"); await scope.whenOfflineUserSettled(); Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    // Bind original for later setup or assertions in this scope.
    const original = window.fetch; let body: any;
    // Try path where partial failure must not leak suite state.
    try {
      // Execute the next setup or assertion step for this scenario.
      window.fetch = (async (input: any, init: any) => { if (!String(input).endsWith("/sync/push") && typeof init?.body === "string") body ??= JSON.parse(init.body); Object.defineProperty(navigator, "onLine", { configurable: true, value: false }); return new Response('{"message":"Unavailable"}', { status: 503 }); }) as typeof fetch;
      // queued: synchronize actors so the race window is observable.
      const queued = await (await import(/* @vite-ignore */ "/src/offline/runOrEnqueue.ts")).startTicketQueued("ticket-503");
      // rows: synchronize actors so the race window is observable.
      const rows = await storage.listQueueForUser("A"); const after = [];
      // Iterate to cover variants or wait until a condition holds.
      for (const status of [401, 429]) { Object.defineProperty(navigator, "onLine", { configurable: true, value: true }); conn.markReachable(); let calls = 0; let fallbacks = 0;
        // Await async work before asserting or releasing locks.
        await (await import(/* @vite-ignore */ "/src/offline/queueDrain.ts")).drainQueue({ headersFn: () => ({}), refreshFn: async () => "transient", fetchFn: async () => { calls++; return new Response("{}", { status }); }, postJsonFn: async () => { fallbacks++; } });
        // Await async work before asserting or releasing locks.
        after.push({ status, calls, fallbacks, rows: await ops.listQueuedActions() });
      }
      // Return the arranged value/result to the caller.
      return { queued, body, rows, after };
    // Execute the next setup or assertion step for this scenario.
    } finally { window.fetch = original; }
  });
  // Assert browser/UI outcome matches the scenario intent.
  expect(result.queued.queued).toBe(true); expect(result.rows).toHaveLength(1); expect(result.rows[0].body).toEqual(result.body);
  // Assert response/page reached the expected status.
  for (const item of result.after) { expect(item.calls).toBe(1); expect(item.fallbacks).toBe(0); expect(item.rows).toHaveLength(1); expect(item.rows[0]).toMatchObject({ status: "pending", body: result.body }); }
});
// Case probes concurrency/isolation: explicit rebase changes version only; ownership conflicts remain blocked.
test("explicit rebase changes version only; ownership conflicts remain blocked", async ({ page }) => {
  // result: synchronize actors so the race window is observable.
  const result = await page.evaluate(async () => {
    // scope: synchronize actors so the race window is observable.
    const scope = await import(/* @vite-ignore */ "/src/offline/userScope.ts"); const ops = await import(/* @vite-ignore */ "/src/offline/queueOps.ts"); const storage = await import(/* @vite-ignore */ "/src/offline/storage.ts");
    // Await async work before asserting or releasing locks.
    scope.setOfflineUser("A"); await scope.whenOfflineUserSettled();
    // row: HTTP response captured for status/body checks.
    const row = await ops.enqueue({ commandId: "same-command", type: "cleaning.start", method: "POST", url: "/cleaning/tasks/task/start", body: { taskId: "task", expectedVersion: 1, commandId: "same-command" } });
    // Await async work before asserting or releasing locks.
    await storage.putQueuedAction({ ...row, status: "conflict", conflictCode: "version_conflict", conflictDetails: { currentVersion: 3 } });
    // rebased: synchronize actors so the race window is observable.
    const rebased = await ops.resolveQueuedAction(row.id, { mode: "rebase" }); const fresh = (await ops.listQueuedActions())[0]!;
    // Await async work before asserting or releasing locks.
    await storage.putQueuedAction({ ...fresh, status: "conflict", conflictCode: "assignee_conflict", conflictDetails: { currentVersion: 4, assignedEmployeeId: "other" } });
    // denied: synchronize actors so the race window is observable.
    const denied = await ops.resolveQueuedAction(row.id, { mode: "rebase" }); return { rebased, fresh, denied, final: (await ops.listQueuedActions())[0] };
  });
  // Assert response/page reached the expected status.
  expect(result.rebased).toBe(true); expect(result.fresh.body).toEqual({ taskId: "task", expectedVersion: 3, commandId: "same-command" }); expect(result.denied).toBe(false); expect(result.final!.status).toBe("conflict"); expect(result.final!.body).toEqual(result.fresh.body);
});
