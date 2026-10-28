import { expect, test, type Page } from "@playwright/test";
let user: any;
test.beforeEach(async ({ page }) => {
  const login = await page.request.post("/api/auth/login", { data: { email: "owner@meridian.local", password: "demo1234" } }); expect(login.status()).toBe(200); user = (await login.json()).user;
  await page.route("**/__scenario", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><main id='root'></main>" }));
  await page.goto("/__scenario");
  await page.evaluate(async () => { const r = await import(/* @vite-ignore */ String("/@react-refresh")); r.default.injectIntoGlobalHook(window); Object.assign(window, { $RefreshReg$: () => {}, $RefreshSig$: () => (type: unknown) => type, __vite_plugin_react_preamble_installed__: true }); });
});
async function mount(page: Page, name: string) { await page.evaluate(async ({ name, user }) => { (window as any).screenHarness = (await import(/* @vite-ignore */ "/tests/browserHarness.tsx")).mountScreen(name, user); }, { name, user }); }
test("P2-37 import UI rejects missing/wrong entries instead of posting empty successful batch", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/daily-plan/import", route => { calls++; return route.fulfill({ json: { plan: { date: "2000-01-01" }, batch: { status: "completed", createdCount: 0, skippedCount: 0, errorCount: 0 } } }); });
  await mount(page, "import");
  for (const value of ["{", "{}", '{"entries":{}}', "[]"]) {
    await page.getByRole("textbox", { name: /^JSON/ }).fill(value); await page.getByRole("button", { name: "Импортирай" }).click();
    await expect(page.getByTestId("error")).not.toBeEmpty(); await expect(page.getByTestId("message")).toBeEmpty();
  }
  expect(calls).toBe(0);
});
test("P2-45 changing day clears deferred confirmation and ignores late apply response", async ({ page }) => {
  let release!: () => void; const gate = new Promise<void>(r => { release = r; }); let captured = false;
  await page.route("**/api/daily-plan/apply-departure-effects", async route => { captured = true; await gate; await route.fulfill({ json: { total: 1, applied: 0, skipped: 0, deferred: 1, deferredEntryIds: ["old-day-entry"] } }); });
  await mount(page, "departures");
  await page.getByRole("button", { name: "Приложи ефекти от напускания" }).click(); await expect.poll(() => captured).toBe(true);
  await page.evaluate(() => (window as any).screenHarness.props({ hotelDate: "2000-01-02" })); release();
  await expect(page.getByRole("button", { name: "Приложи ефекти от напускания" })).toBeEnabled();
  await expect(page.getByRole("button", { name: /Потвърди отложените/ })).toHaveCount(0);
  await expect(page.getByTestId("message")).toBeEmpty();
});
test("P2-43 plan day B stays visible after delayed day A response", async ({ page }) => {
  const original = await (await page.request.get("/api/daily-plan?hotelDate=2000-01-01")).json();
  await page.route("**/api/rooms", route => route.fulfill({ json: [] }));
  let release!: () => void; const gate = new Promise<void>(r => { release = r; }); let captured = false;
  await page.route("**/api/daily-plan?*", async route => {
    const date = new URL(route.request().url()).searchParams.get("hotelDate");
    if (date !== "2000-01-02") { captured = true; await gate; }
    await route.fulfill({ json: { ...original, date, lastImport: { sourceLabel: date === "2000-01-02" ? "CURRENT-DAY-B" : "STALE-DAY-A", status: "completed", createdCount: 0, totalCount: 0, createdAt: new Date().toISOString() } } });
  });
  await mount(page, "plan"); await expect.poll(() => captured).toBe(true);
  await page.getByLabel("Дата", { exact: true }).fill("2000-01-02"); await expect(page.getByText(/CURRENT-DAY-B/)).toBeVisible();
  release(); await page.waitForResponse(r => r.url().includes("/api/daily-plan?") && !r.url().includes("2000-01-02"));
  await expect(page.getByText(/CURRENT-DAY-B/)).toBeVisible(); await expect(page.getByText(/STALE-DAY-A/)).toHaveCount(0);
});
test("P2-43 location history ignores delayed A after selecting B", async ({ page }) => {
  let release!: () => void; const gate = new Promise<void>(r => { release = r; }); let captured = false;
  await page.route("**/api/audit-events?*", async route => { const id = new URL(route.request().url()).searchParams.get("locationId"); if (id === "A") { captured = true; await gate; } await route.fulfill({ json: [{ id: `history-${id}`, summary: `HISTORY-${id}` }] }); });
  await mount(page, "location-audit"); await expect.poll(() => captured).toBe(true);
  await page.evaluate(() => (window as any).screenHarness.props({ locationId: "B" })); await expect(page.getByTestId("audit")).toContainText("HISTORY-B");
  release(); await page.waitForResponse(r => r.url().includes("locationId=A")); await expect(page.getByTestId("audit")).toContainText("HISTORY-B"); await expect(page.getByTestId("audit")).not.toContainText("HISTORY-A");
});
test("P1-118 live board marks delayed polls stale then offline and recovers after success", async ({ page }) => {
  const payload = await (await page.request.get("/api/operations/live")).json(); let requests = 0; let release!: () => void; const gate = new Promise<void>(r => { release = r; });
  await page.clock.install({ time: new Date("2026-10-19T10:00:00Z") });
  await page.route("**/api/operations/live", async route => { requests++; if (requests === 2) { await gate; await route.fulfill({ status: 503, json: { error: "unavailable" } }); } else await route.fulfill({ json: payload }); });
  await mount(page, "live"); await expect(page.getByText("Live", { exact: true })).toBeVisible();
  await page.clock.fastForward(46000); await expect(page.getByText("Stale data", { exact: true })).toBeVisible();
  release(); await expect(page.getByText("Offline", { exact: true })).toBeVisible();
  await page.clock.fastForward(15000); await expect(page.getByText("Live", { exact: true })).toBeVisible();
});
test("P2-43 attendance filter B cannot be replaced by delayed unfiltered results", async ({ page }) => {
  const payload = await (await page.request.get("/api/attendance/intervals?limit=1")).json(); expect(payload.intervals.length).toBeGreaterThan(0);
  let release!: () => void; const gate = new Promise<void>(r => { release = r; }); let captured = false;
  await page.route("**/api/attendance/intervals?*", async route => {
    const current = new URL(route.request().url()).searchParams.get("q") === "B";
    if (!current) { captured = true; await gate; }
    await route.fulfill({ json: { ...payload, intervals: [{ ...payload.intervals[0], employee: { ...payload.intervals[0].employee, fullName: current ? "CURRENT-FILTER-B" : "STALE-FILTER-A" } }] } });
  });
  await mount(page, "attendance"); await expect.poll(() => captured).toBe(true);
  await page.getByLabel("Търсене").fill("B"); await expect(page.getByText("CURRENT-FILTER-B", { exact: true })).toBeVisible();
  const oldResponse = page.waitForResponse(r => r.url().includes("/api/attendance/intervals?") && !r.url().includes("q=B")); release(); await oldResponse;
  await expect(page.getByText("CURRENT-FILTER-B", { exact: true })).toBeVisible(); await expect(page.getByText("STALE-FILTER-A", { exact: true })).toHaveCount(0);
});
test("P2-43 ticket B keeps its history after delayed A and current filter results remain visible", async ({ page }) => {
  const rows = await (await page.request.get("/api/maintenance/tickets?status=all&limit=2")).json(); expect(rows.length).toBeGreaterThan(1);
  const tickets = rows.slice(0, 2).map((r: any, i: number) => ({ ...r, blocksRoom: false, status: "new", title: `SELECT-TICKET-${i === 0 ? "A" : "B"}` }));
  await page.route("**/api/maintenance/tickets?*", route => route.fulfill({ json: tickets }));
  let release!: () => void; const gate = new Promise<void>(r => { release = r; }); let captured = false;
  await page.route("**/api/maintenance/tickets/*/events", async route => { const a = route.request().url().includes(tickets[0].id); if (a) { captured = true; await gate; } await route.fulfill({ json: [{ id: a ? "event-a" : "event-b", toStatus: "assigned", fromStatus: "new", occurredAt: new Date().toISOString(), reason: a ? "HISTORY-A" : "HISTORY-B", actor: { fullName: "Actor" } }] }); });
  await mount(page, "repairs"); await page.getByText("SELECT-TICKET-A", { exact: true }).first().click(); await expect.poll(() => captured).toBe(true);
  await page.getByText("SELECT-TICKET-B", { exact: true }).first().click(); await expect(page.getByText("HISTORY-B")).toBeVisible();
  const old = page.waitForResponse(r => r.url().includes(`${tickets[0].id}/events`)); release(); await old;
  await expect(page.getByText("HISTORY-B")).toBeVisible(); await expect(page.getByText("HISTORY-A")).toHaveCount(0);
});
