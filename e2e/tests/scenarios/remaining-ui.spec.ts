import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  const response = await page.request.post("/api/auth/login", { data: { email: "owner@meridian.local", password: "demo1234" } });
  expect(response.status()).toBe(200);
  const { user } = await response.json();
  await page.route("**/__scenario", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><main id='root'></main>" }));
  await page.goto("/__scenario");
  await page.evaluate(async user => {
    const refresh = await import(/* @vite-ignore */ String("/@react-refresh"));
    refresh.default.injectIntoGlobalHook(window);
    Object.assign(window, { $RefreshReg$: () => {}, $RefreshSig$: () => (type: unknown) => type, __vite_plugin_react_preamble_installed__: true, scenarioUser: user });
    const scope = await import(/* @vite-ignore */ "/src/offline/userScope.ts");
    scope.setOfflineUser(user.id);
    await scope.whenOfflineUserSettled();
  }, user);
  // Keep domain events under test control so an unrelated connected catch-up
  // cannot start an additional request while an A/B barrier is held.
  await page.evaluate(() => {
    const realFetch = window.fetch;
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/events/stream")) {
        return Promise.resolve(new Response(new ReadableStream({ start(controller) {
          (window as any).scenarioStream = controller;
          init?.signal?.addEventListener("abort", () => { try { controller.close(); } catch {} });
        } })));
      }
      return realFetch(input, init);
    }) as typeof fetch;
  });
});

async function mount(page: Page, screen: string) {
  await page.evaluate(async screen => {
    (window as any).screenHarness = (await import(/* @vite-ignore */ "/tests/browserHarness.tsx")).mountScreen(screen, (window as any).scenarioUser);
  }, screen);
}

for (const screen of ["rooms", "mywork", "repairs"] as const) {
  const events = screen === "repairs" ? ["ticket.changed", "location.changed"] : ["location.changed", "cleaning.changed", "ticket.changed"];
  for (const eventType of events) {
    test(`P1-117 ${eventType} refreshes actual ${screen} page`, async ({ page }) => {
      const rooms = await (await page.request.get("/api/rooms")).json();
      expect(rooms.length).toBeGreaterThan(0);
      const tickets = screen === "repairs" ? await (await page.request.get("/api/maintenance/tickets?status=all&limit=1")).json() : [];
      const endpoint = screen === "rooms" ? "/api/rooms" : screen === "mywork" ? "/api/my-work" : "/api/maintenance/tickets";
      let current = false;
      let requests = 0;
      await page.route(`**${endpoint}${screen === "rooms" ? "" : "?*"}`, route => {
        requests++;
        const marker = current ? "AFTER-DOMAIN-EVENT" : "BEFORE-DOMAIN-EVENT";
        const task = { id: "event-task", status: "assigned", priority: "normal", version: 1, sessions: [], inspections: [], location: { id: rooms[0].id, number: marker, floor: { number: 1, building: { code: "EVENT", name: "Event" } } } };
        const json = screen === "rooms" ? [{ ...rooms[0], number: marker }] : screen === "mywork" ? { tasks: [task], tickets: [], hotelDate: "2000-01-01", summary: { taskCount: 1, ticketCount: 0, runningSessions: 0 } } : [{ ...tickets[0], blocksRoom: false, title: marker, status: "new" }];
        return route.fulfill({ json });
      });
      await mount(page, screen);
      await expect(page.getByText(/BEFORE-DOMAIN-EVENT/).first()).toBeVisible();
      await expect.poll(() => page.evaluate(() => Boolean((window as any).scenarioStream))).toBe(true);
      const before = requests;
      current = true;
      await page.evaluate(eventType => (window as any).scenarioStream.enqueue(new TextEncoder().encode(`event: ${eventType}\ndata: {"type":"${eventType}"}\n\n`)), eventType);
      await expect(page.getByText(/AFTER-DOMAIN-EVENT/).first()).toBeVisible();
      expect(requests).toBeGreaterThan(before);
      await expect(page.getByText(/BEFORE-DOMAIN-EVENT/)).toHaveCount(0);
    });
  }
}

test("P1-117 actual repair report defers domain refresh while busy and catches up afterward", async ({ page }) => {
  const tickets = await (await page.request.get("/api/maintenance/tickets?status=all&limit=1")).json();
  expect(tickets.length).toBeGreaterThan(0);
  let current = false;
  let reads = 0;
  await page.route("**/api/maintenance/tickets?*", route => {
    reads++;
    return route.fulfill({ json: [{ ...tickets[0], blocksRoom: false, title: current ? "UPDATED-WHILE-REPORTING" : "BEFORE-REPORTING", status: "new" }] });
  });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let submitted = false;
  await page.route("**/api/maintenance/tickets", async route => {
    submitted = true;
    await gate;
    await route.fulfill({ status: 400, json: { message: "Controlled report failure" } });
  });
  await mount(page, "repairs");
  await expect(page.getByText("BEFORE-REPORTING", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean((window as any).scenarioStream))).toBe(true);
  await page.getByLabel("Title", { exact: true }).fill("Local report");
  await page.getByRole("button", { name: "Report", exact: true }).click();
  await expect.poll(() => submitted).toBe(true);
  const before = reads;
  current = true;
  await page.clock.install();
  await page.evaluate(() => (window as any).scenarioStream.enqueue(new TextEncoder().encode('event: ticket.changed\ndata: {"type":"ticket.changed"}\n\n')));
  await page.clock.fastForward(1000);
  expect(reads).toBe(before);
  await expect(page.getByText("BEFORE-REPORTING", { exact: true })).toBeVisible();
  release();
  await expect(page.getByText("Controlled report failure")).toBeVisible();
  await page.clock.fastForward(500);
  await expect(page.getByText("UPDATED-WHILE-REPORTING", { exact: true })).toBeVisible();
});

async function renderSettled(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

for (const screen of ["analytics", "results", "repairs"] as const) {
  for (const late of ["success", "error", "loading"] as const) {
    test(`P2-43 ${screen}: stale A ${late} cannot replace current B state`, async ({ page }) => {
      const endpoint = screen === "analytics" ? "/api/analytics/summary" : screen === "results" ? "/api/cleaning/results" : "/api/maintenance/tickets";
      const response = await page.request.get(screen === "analytics" ? `${endpoint}?domain=maintenance&from=2000-01-01&to=2000-01-03` : screen === "results" ? `${endpoint}?from=2000-01-01&to=2000-01-03` : `${endpoint}?status=all&limit=1`);
      expect(response.status()).toBe(200);
      const original = await response.json();
      const payload = (current: boolean) => {
        const marker = current ? "CURRENT-FILTER-B" : "STALE-FILTER-A";
        if (screen === "analytics") return { ...original, forecast: { ...original.forecast, formula: marker } };
        if (screen === "results") return { ...original, total: 1, rows: [{ employeeId: marker, fullName: marker, employeeNumber: marker, completedTasks: 0, completedSessions: 0, acceptedTasks: 0, reworkEvents: 0, anomalousSessions: 0, distinctRooms: 0, onTimePct: null, avgValidMinutes: null, totalValidSessionMinutes: 0, totalExcludedSessionMinutes: 0 }] };
        expect(original.length).toBeGreaterThan(0);
        return [{ ...original[0], blocksRoom: false, title: marker, status: current ? "resolved" : "new" }];
      };
      let releaseA!: () => void;
      const gateA = new Promise<void>(resolve => { releaseA = resolve; });
      let releaseB!: () => void;
      const gateB = new Promise<void>(resolve => { releaseB = resolve; });
      let capturedA = false;
      let capturedB = false;
      const isB = (url: string) => new URL(url).searchParams.get(screen === "repairs" ? "status" : "from") === (screen === "repairs" ? "resolved" : "2000-01-02");
      await page.route(`**${endpoint}?*`, async route => {
        const current = isB(route.request().url());
        if (!current) { capturedA = true; await gateA; }
        else { capturedB = true; if (late === "loading") await gateB; }
        await route.fulfill(!current && late === "error" ? { status: 503, json: { message: "STALE-ERROR-A" } } : { json: payload(current) });
      });
      await mount(page, screen);
      await expect.poll(() => capturedA).toBe(true);
      if (screen === "repairs") await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("resolved");
      else await page.getByLabel("От", { exact: true }).fill("2000-01-02");
      await expect.poll(() => capturedB).toBe(true);
      if (late !== "loading") await expect(page.getByText("CURRENT-FILTER-B", { exact: true }).first()).toBeVisible();
      const oldResponse = page.waitForResponse(r => r.url().includes(`${endpoint}?`) && !isB(r.url()));
      releaseA();
      await (await oldResponse).finished();
      await renderSettled(page);
      if (late === "loading") {
        await expect(page.getByText(screen === "analytics" ? "Зареждане на аналитиката…" : screen === "results" ? "Зареждане…" : "Loading…", { exact: true })).toBeVisible();
        releaseB();
      }
      await expect(page.getByText("CURRENT-FILTER-B", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("STALE-FILTER-A", { exact: true })).toHaveCount(0);
      await expect(page.getByText("STALE-ERROR-A", { exact: true })).toHaveCount(0);
    });
  }
}
