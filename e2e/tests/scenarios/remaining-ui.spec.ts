// Playwright test runner APIs for browser E2E scenarios.
import { expect, test, type Page } from "@playwright/test";
// Import bindings from ./helpers/ticketListMock.
import { ticketListResponse } from "./helpers/ticketListMock";

// Define an individual test case.
test.beforeEach(async ({ page }) => {
  // response: HTTP response captured for status/body checks.
  const response = await page.request.post("/api/auth/login", { data: { email: "owner@meridian.local", password: "demo1234" } });
  // Assert response/page reached the expected status.
  expect(response.status()).toBe(200);
  // Await async work before asserting or releasing locks.
  const { user } = await response.json();
  // Await async work before asserting or releasing locks.
  await page.route("**/__scenario", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><main id='root'></main>" }));
  // Drive the browser through the user-visible workflow step.
  await page.goto("/__scenario");
  // Await async work before asserting or releasing locks.
  await page.evaluate(async user => {
    // refresh: synchronize actors so the race window is observable.
    const refresh = await import(/* @vite-ignore */ String("/@react-refresh"));
    // Session/CSRF step exercising auth lifecycle.
    refresh.default.injectIntoGlobalHook(window);
    // Session/CSRF step exercising auth lifecycle.
    Object.assign(window, { $RefreshReg$: () => {}, $RefreshSig$: () => (type: unknown) => type, __vite_plugin_react_preamble_installed__: true, scenarioUser: user });
    // scope: synchronize actors so the race window is observable.
    const scope = await import(/* @vite-ignore */ "/src/offline/userScope.ts");
    // Execute the next setup or assertion step for this scenario.
    scope.setOfflineUser(user.id);
    // Await async work before asserting or releasing locks.
    await scope.whenOfflineUserSettled();
  // Execute the next setup or assertion step for this scenario.
  }, user);
  // Keep domain events under test control so an unrelated connected catch-up
  // cannot start an additional request while an A/B barrier is held.
  await page.evaluate(() => {
    // Bind realFetch for later setup or assertions in this scope.
    const realFetch = window.fetch;
    // Execute the next setup or assertion step for this scenario.
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (String(input).includes("/events/stream")) {
        // Return the arranged value/result to the caller.
        return Promise.resolve(new Response(new ReadableStream({ start(controller) {
          // Execute the next setup or assertion step for this scenario.
          (window as any).scenarioStream = controller;
          // Execute the next setup or assertion step for this scenario.
          init?.signal?.addEventListener("abort", () => { try { controller.close(); } catch {} });
        // Execute the next setup or assertion step for this scenario.
        } })));
      }
      // Return the arranged value/result to the caller.
      return realFetch(input, init);
    // Execute the next setup or assertion step for this scenario.
    }) as typeof fetch;
  });
});

// Local helper mount used by cases in this file.
async function mount(page: Page, screen: string) {
  // Await async work before asserting or releasing locks.
  await page.evaluate(async screen => {
    // Await async work before asserting or releasing locks.
    (window as any).screenHarness = (await import(/* @vite-ignore */ "/tests/browserHarness.tsx")).mountScreen(screen, (window as any).scenarioUser);
  // Execute the next setup or assertion step for this scenario.
  }, screen);
}

// Repeat/poll to widen the race window or wait for lock waiters.
for (const screen of ["rooms", "mywork", "repairs"] as const) {
  // Bind events for later setup or assertions in this scope.
  const events = screen === "repairs" ? ["ticket.changed", "location.changed"] : ["location.changed", "cleaning.changed", "ticket.changed"];
  // Iterate to cover variants or wait until a condition holds.
  for (const eventType of events) {
    // Case: ${eventType} refreshes actual ${screen} page.
    test(`${eventType} refreshes actual ${screen} page`, async ({ page }) => {
      // rooms: HTTP response captured for status/body checks.
      const rooms = await (await page.request.get("/api/rooms")).json();
      // Assert browser/UI outcome matches the scenario intent.
      expect(rooms.length).toBeGreaterThan(0);
      // tickets: HTTP response captured for status/body checks.
      const tickets = screen === "repairs" ? await (await page.request.get("/api/maintenance/tickets?status=all&limit=1")).json() : [];
      // Bind endpoint for later setup or assertions in this scope.
      const endpoint = screen === "rooms" ? "/api/rooms" : screen === "mywork" ? "/api/my-work" : "/api/maintenance/tickets";
      // Bind current for later setup or assertions in this scope.
      let current = false;
      // Bind requests for later setup or assertions in this scope.
      let requests = 0;
      // Await async work before asserting or releasing locks.
      await page.route(`**${endpoint}${screen === "rooms" ? "" : "?*"}`, route => {
        // Execute the next setup or assertion step for this scenario.
        requests++;
        // Bind marker for later setup or assertions in this scope.
        const marker = current ? "AFTER-DOMAIN-EVENT" : "BEFORE-DOMAIN-EVENT";
        // Bind task for later setup or assertions in this scope.
        const task = { id: "event-task", status: "assigned", priority: "normal", version: 1, sessions: [], inspections: [], location: { id: rooms[0].id, number: marker, floor: { number: 1, building: { code: "EVENT", name: "Event" } } } };
        // Bind repairsItems for later setup or assertions in this scope.
        const repairsItems = [{ ...tickets[0], blocksRoom: false, title: marker, status: "new" }];
        // Bind json for later setup or assertions in this scope.
        const json = screen === "rooms"
          ? [{ ...rooms[0], number: marker }]
          : screen === "mywork"
            ? { tasks: [task], tickets: [], hotelDate: "2000-01-01", summary: { taskCount: 1, ticketCount: 0, runningSessions: 0 } }
            : ticketListResponse(route.request().url(), repairsItems);
        // Return the arranged value/result to the caller.
        return route.fulfill({ json });
      });
      // Await async work before asserting or releasing locks.
      await mount(page, screen);
      // Assert UI visibility/state after the user action.
      await expect(page.getByText(/BEFORE-DOMAIN-EVENT/).first()).toBeVisible();
      // Await async work before asserting or releasing locks.
      await expect.poll(() => page.evaluate(() => Boolean((window as any).scenarioStream))).toBe(true);
      // Bind before for later setup or assertions in this scope.
      const before = requests;
      // Execute the next setup or assertion step for this scenario.
      current = true;
      // Await async work before asserting or releasing locks.
      await page.evaluate(eventType => (window as any).scenarioStream.enqueue(new TextEncoder().encode(`event: ${eventType}\ndata: {"type":"${eventType}"}\n\n`)), eventType);
      // Assert UI visibility/state after the user action.
      await expect(page.getByText(/AFTER-DOMAIN-EVENT/).first()).toBeVisible();
      // Assert browser/UI outcome matches the scenario intent.
      expect(requests).toBeGreaterThan(before);
      // Assert UI visibility/state after the user action.
      await expect(page.getByText(/BEFORE-DOMAIN-EVENT/)).toHaveCount(0);
    });
  }
}

// Case: actual repair report defers domain refresh while busy and catches up afterward.
test("actual repair report defers domain refresh while busy and catches up afterward", async ({ page }) => {
  // tickets: HTTP response captured for status/body checks.
  const tickets = await (await page.request.get("/api/maintenance/tickets?status=all&limit=1")).json();
  // Assert browser/UI outcome matches the scenario intent.
  expect(tickets.length).toBeGreaterThan(0);
  // Bind current for later setup or assertions in this scope.
  let current = false;
  // Bind reads for later setup or assertions in this scope.
  let reads = 0;
  // Execute the next setup or assertion step for this scenario.
  let release!: () => void;
  // Bind gate for later setup or assertions in this scope.
  const gate = new Promise<void>(resolve => { release = resolve; });
  // Bind submitted for later setup or assertions in this scope.
  let submitted = false;
  // Await async work before asserting or releasing locks.
  await page.route("**/maintenance/tickets**", async route => {
    // Bind method for later setup or assertions in this scope.
    const method = route.request().method();
    // Bind url for later setup or assertions in this scope.
    const url = route.request().url();
    // POST create only — do not steal paginated GETs that share this path.
    if (method === "POST") {
      // Execute the next setup or assertion step for this scenario.
      submitted = true;
      // Await async work before asserting or releasing locks.
      await gate;
      // Return the arranged value/result to the caller.
      return route.fulfill({ status: 400, json: { message: "Controlled report failure" } });
    }
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (method !== "GET") return route.fallback();
    // Execute the next setup or assertion step for this scenario.
    reads++;
    // Bind items for later setup or assertions in this scope.
    const items = [{ ...tickets[0], blocksRoom: false, title: current ? "UPDATED-WHILE-REPORTING" : "BEFORE-REPORTING", status: "new" }];
    // Return the arranged value/result to the caller.
    return route.fulfill({ json: ticketListResponse(url, items) });
  });
  // Await async work before asserting or releasing locks.
  await mount(page, "repairs");
  // Assert UI visibility/state after the user action.
  await expect(page.getByText("BEFORE-REPORTING", { exact: true })).toBeVisible();
  // Await async work before asserting or releasing locks.
  await expect.poll(() => page.evaluate(() => Boolean((window as any).scenarioStream))).toBe(true);
  // Assert UI visibility/state after the user action.
  await expect(page.getByRole("combobox", { name: "Room", exact: true })).not.toHaveValue("");
  // Assert UI visibility/state after the user action.
  await expect(page.getByRole("combobox", { name: "Option", exact: true })).not.toHaveValue("");
  // Catalog option mode shows Title as preview text, not an input — submit as-is.
  await page.getByRole("button", { name: "Report", exact: true }).click();
  // Await async work before asserting or releasing locks.
  await expect.poll(() => submitted).toBe(true);
  // Bind before for later setup or assertions in this scope.
  const before = reads;
  // Execute the next setup or assertion step for this scenario.
  current = true;
  // Await async work before asserting or releasing locks.
  await page.clock.install();
  // Await async work before asserting or releasing locks.
  await page.evaluate(() => (window as any).scenarioStream.enqueue(new TextEncoder().encode('event: ticket.changed\ndata: {"type":"ticket.changed"}\n\n')));
  // Await async work before asserting or releasing locks.
  await page.clock.fastForward(1000);
  // Assert browser/UI outcome matches the scenario intent.
  expect(reads).toBe(before);
  // Assert UI visibility/state after the user action.
  await expect(page.getByText("BEFORE-REPORTING", { exact: true })).toBeVisible();
  // Execute the next setup or assertion step for this scenario.
  release();
  // Assert UI visibility/state after the user action.
  await expect(page.getByText("Controlled report failure")).toBeVisible();
  // Await async work before asserting or releasing locks.
  await page.clock.fastForward(500);
  // Assert UI visibility/state after the user action.
  await expect(page.getByText("UPDATED-WHILE-REPORTING", { exact: true })).toBeVisible();
});

// Local helper renderSettled used by cases in this file.
async function renderSettled(page: Page) {
  // Await async work before asserting or releasing locks.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

// Repeat/poll to widen the race window or wait for lock waiters.
for (const screen of ["analytics", "results", "repairs"] as const) {
  // Iterate to cover variants or wait until a condition holds.
  for (const late of ["success", "error", "loading"] as const) {
    // Case: ${screen}: stale A ${late} cannot replace current B state.
    test(`${screen}: stale A ${late} cannot replace current B state`, async ({ page }) => {
      // Bind endpoint for later setup or assertions in this scope.
      const endpoint = screen === "analytics" ? "/api/analytics/summary" : screen === "results" ? "/api/cleaning/results" : "/api/maintenance/tickets";
      // response: HTTP response captured for status/body checks.
      const response = await page.request.get(screen === "analytics" ? `${endpoint}?domain=maintenance&from=2000-01-01&to=2000-01-03` : screen === "results" ? `${endpoint}?from=2000-01-01&to=2000-01-03` : `${endpoint}?status=all&limit=1`);
      // Assert response/page reached the expected status.
      expect(response.status()).toBe(200);
      // original: synchronize actors so the race window is observable.
      const original = await response.json();
      // Bind payload for later setup or assertions in this scope.
      const payload = (url: string, current: boolean) => {
        // Bind marker for later setup or assertions in this scope.
        const marker = current ? "CURRENT-FILTER-B" : "STALE-FILTER-A";
        // Conditional path for setup, cleanup, or alternate outcomes.
        if (screen === "analytics") return { ...original, forecast: { ...original.forecast, formula: marker } };
        // Conditional path for setup, cleanup, or alternate outcomes.
        if (screen === "results") return { ...original, total: 1, rows: [{ employeeId: marker, fullName: marker, employeeNumber: marker, completedTasks: 0, completedSessions: 0, acceptedTasks: 0, reworkEvents: 0, anomalousSessions: 0, distinctRooms: 0, onTimePct: null, avgValidMinutes: null, totalValidSessionMinutes: 0, totalExcludedSessionMinutes: 0 }] };
        // Assert browser/UI outcome matches the scenario intent.
        expect(original.length).toBeGreaterThan(0);
        // Return the arranged value/result to the caller.
        return ticketListResponse(url, [{ ...original[0], blocksRoom: false, title: marker, status: current ? "resolved" : "new" }]);
      };
      // Execute the next setup or assertion step for this scenario.
      let releaseA!: () => void;
      // Bind gateA for later setup or assertions in this scope.
      const gateA = new Promise<void>(resolve => { releaseA = resolve; });
      // Execute the next setup or assertion step for this scenario.
      let releaseB!: () => void;
      // Bind gateB for later setup or assertions in this scope.
      const gateB = new Promise<void>(resolve => { releaseB = resolve; });
      // Bind capturedA for later setup or assertions in this scope.
      let capturedA = false;
      // Bind capturedB for later setup or assertions in this scope.
      let capturedB = false;
      // Bind aSettled for later setup or assertions in this scope.
      let aSettled = false;
      // Bind isB for later setup or assertions in this scope.
      const isB = (url: string) => new URL(url).searchParams.get(screen === "repairs" ? "status" : "from") === (screen === "repairs" ? "resolved" : "2000-01-02");
      // Await async work before asserting or releasing locks.
      await page.route(`**${endpoint}?*`, async route => {
        // Bind current for later setup or assertions in this scope.
        const current = isB(route.request().url());
        // Conditional path for setup, cleanup, or alternate outcomes.
        if (!current) {
          // Execute the next setup or assertion step for this scenario.
          capturedA = true;
          // Await async work before asserting or releasing locks.
          await gateA;
          // Try path where partial failure must not leak suite state.
          try {
            // Await async work before asserting or releasing locks.
            await route.fulfill(!current && late === "error" ? { status: 503, json: { message: "STALE-ERROR-A" } } : { json: payload(route.request().url(), current) });
          // Execute the next setup or assertion step for this scenario.
          } catch {
            // Client may abort stale A when B starts; that is the race under test.
          } finally {
            // Execute the next setup or assertion step for this scenario.
            aSettled = true;
          }
          // Execute the next setup or assertion step for this scenario.
          return;
        }
        // Execute the next setup or assertion step for this scenario.
        capturedB = true;
        // Conditional path for setup, cleanup, or alternate outcomes.
        if (late === "loading") await gateB;
        // Await async work before asserting or releasing locks.
        await route.fulfill({ json: payload(route.request().url(), current) });
      });
      // Await async work before asserting or releasing locks.
      await mount(page, screen);
      // Await async work before asserting or releasing locks.
      await expect.poll(() => capturedA).toBe(true);
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (screen === "repairs") await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("resolved");
      // Await async work before asserting or releasing locks.
      else await page.getByLabel("От", { exact: true }).fill("2000-01-02");
      // Await async work before asserting or releasing locks.
      await expect.poll(() => capturedB).toBe(true);
      // Assert UI visibility/state after the user action.
      if (late !== "loading") await expect(page.getByText("CURRENT-FILTER-B", { exact: true }).first()).toBeVisible();
      // Prefer route settlement over waitForResponse — aborted A never emits a page response.
      releaseA();
      // Await async work before asserting or releasing locks.
      await expect.poll(() => aSettled).toBe(true);
      // Await async work before asserting or releasing locks.
      await renderSettled(page);
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (late === "loading") {
        // Assert UI visibility/state after the user action.
        await expect(page.getByText(screen === "analytics" ? "Зареждане на аналитиката…" : screen === "results" ? "Зареждане…" : "Loading…", { exact: true })).toBeVisible();
        // Execute the next setup or assertion step for this scenario.
        releaseB();
      }
      // Assert UI visibility/state after the user action.
      await expect(page.getByText("CURRENT-FILTER-B", { exact: true }).first()).toBeVisible();
      // Assert UI visibility/state after the user action.
      await expect(page.getByText("STALE-FILTER-A", { exact: true })).toHaveCount(0);
      // Assert UI visibility/state after the user action.
      await expect(page.getByText("STALE-ERROR-A", { exact: true })).toHaveCount(0);
    });
  }
}
