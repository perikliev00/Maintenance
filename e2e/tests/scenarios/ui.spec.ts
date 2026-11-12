// Playwright test runner APIs for browser E2E scenarios.
import { expect, test, type Page } from "@playwright/test";
// Import bindings from ./helpers/ticketListMock.
import { ticketListResponse } from "./helpers/ticketListMock";
// Execute the next setup or assertion step for this scenario.
let user: any;
// Define an individual test case.
test.beforeEach(async ({ page }) => {
  // login: HTTP response captured for status/body checks.
  const login = await page.request.post("/api/auth/login", { data: { email: "owner@meridian.local", password: "demo1234" } }); expect(login.status()).toBe(200); user = (await login.json()).user;
  // Await async work before asserting or releasing locks.
  await page.route("**/__scenario", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><main id='root'></main>" }));
  // Drive the browser through the user-visible workflow step.
  await page.goto("/__scenario");
  // Await async work before asserting or releasing locks.
  await page.evaluate(async () => { const r = await import(/* @vite-ignore */ String("/@react-refresh")); r.default.injectIntoGlobalHook(window); Object.assign(window, { $RefreshReg$: () => {}, $RefreshSig$: () => (type: unknown) => type, __vite_plugin_react_preamble_installed__: true }); });
});
// Local helper mount used by cases in this file.
async function mount(page: Page, name: string) { await page.evaluate(async ({ name, user }) => { (window as any).screenHarness = (await import(/* @vite-ignore */ "/tests/browserHarness.tsx")).mountScreen(name, user); }, { name, user }); }
// Case: import UI rejects missing/wrong entries instead of posting empty successful batch.
test("import UI rejects missing/wrong entries instead of posting empty successful batch", async ({ page }) => {
  // Bind calls for later setup or assertions in this scope.
  let calls = 0;
  // Await async work before asserting or releasing locks.
  await page.route("**/api/daily-plan/import", route => { calls++; return route.fulfill({ json: { plan: { date: "2000-01-01" }, batch: { status: "completed", createdCount: 0, skippedCount: 0, errorCount: 0 } } }); });
  // Await async work before asserting or releasing locks.
  await mount(page, "import");
  // Iterate to cover variants or wait until a condition holds.
  for (const value of ["{", "{}", '{"entries":{}}', "[]"]) {
    // Drive the browser through the user-visible workflow step.
    await page.getByRole("textbox", { name: /^JSON/ }).fill(value); await page.getByRole("button", { name: "Импортирай" }).click();
    // Assert browser/UI outcome matches the scenario intent.
    await expect(page.getByTestId("error")).not.toBeEmpty(); await expect(page.getByTestId("message")).toBeEmpty();
  }
  // Assert response/page reached the expected status.
  expect(calls).toBe(0);
});
// Case: changing day clears deferred confirmation and ignores late apply response.
test("changing day clears deferred confirmation and ignores late apply response", async ({ page }) => {
  // Execute the next setup or assertion step for this scenario.
  let release!: () => void; const gate = new Promise<void>(r => { release = r; }); let captured = false;
  // Await async work before asserting or releasing locks.
  await page.route("**/api/daily-plan/apply-departure-effects", async route => { captured = true; await gate; await route.fulfill({ json: { total: 1, applied: 0, skipped: 0, deferred: 1, deferredEntryIds: ["old-day-entry"] } }); });
  // Await async work before asserting or releasing locks.
  await mount(page, "departures");
  // Drive the browser through the user-visible workflow step.
  await page.getByRole("button", { name: "Приложи ефекти от напускания" }).click(); await expect.poll(() => captured).toBe(true);
  // Await async work before asserting or releasing locks.
  await page.evaluate(() => (window as any).screenHarness.props({ hotelDate: "2000-01-02" })); release();
  // Assert UI visibility/state after the user action.
  await expect(page.getByRole("button", { name: "Приложи ефекти от напускания" })).toBeEnabled();
  // Assert UI visibility/state after the user action.
  await expect(page.getByRole("button", { name: /Потвърди отложените/ })).toHaveCount(0);
  // Assert browser/UI outcome matches the scenario intent.
  await expect(page.getByTestId("message")).toBeEmpty();
});
// Case: plan day B stays visible after delayed day A response.
test("plan day B stays visible after delayed day A response", async ({ page }) => {
  // original: HTTP response captured for status/body checks.
  const original = await (await page.request.get("/api/daily-plan?hotelDate=2000-01-01")).json();
  // Await async work before asserting or releasing locks.
  await page.route("**/api/rooms", route => route.fulfill({ json: [] }));
  // Execute the next setup or assertion step for this scenario.
  let release!: () => void; const gate = new Promise<void>(r => { release = r; }); let captured = false;
  // Await async work before asserting or releasing locks.
  await page.route("**/api/daily-plan?*", async route => {
    // Bind date for later setup or assertions in this scope.
    const date = new URL(route.request().url()).searchParams.get("hotelDate");
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (date !== "2000-01-02") { captured = true; await gate; }
    // Await async work before asserting or releasing locks.
    await route.fulfill({ json: { ...original, date, lastImport: { sourceLabel: date === "2000-01-02" ? "CURRENT-DAY-B" : "STALE-DAY-A", status: "completed", createdCount: 0, totalCount: 0, createdAt: new Date().toISOString() } } });
  });
  // Await async work before asserting or releasing locks.
  await mount(page, "plan"); await expect.poll(() => captured).toBe(true);
  // Assert UI visibility/state after the user action.
  await page.getByLabel("Дата", { exact: true }).fill("2000-01-02"); await expect(page.getByText(/CURRENT-DAY-B/)).toBeVisible();
  // Await async work before asserting or releasing locks.
  release(); await page.waitForResponse(r => r.url().includes("/api/daily-plan?") && !r.url().includes("2000-01-02"));
  // Assert UI visibility/state after the user action.
  await expect(page.getByText(/CURRENT-DAY-B/)).toBeVisible(); await expect(page.getByText(/STALE-DAY-A/)).toHaveCount(0);
});
// Case: location history ignores delayed A after selecting B.
test("location history ignores delayed A after selecting B", async ({ page }) => {
  // Execute the next setup or assertion step for this scenario.
  let release!: () => void; const gate = new Promise<void>(r => { release = r; }); let captured = false;
  // Await async work before asserting or releasing locks.
  await page.route("**/api/audit-events?*", async route => { const id = new URL(route.request().url()).searchParams.get("locationId"); if (id === "A") { captured = true; await gate; } await route.fulfill({ json: [{ id: `history-${id}`, summary: `HISTORY-${id}` }] }); });
  // Await async work before asserting or releasing locks.
  await mount(page, "location-audit"); await expect.poll(() => captured).toBe(true);
  // Assert browser/UI outcome matches the scenario intent.
  await page.evaluate(() => (window as any).screenHarness.props({ locationId: "B" })); await expect(page.getByTestId("audit")).toContainText("HISTORY-B");
  // Assert browser/UI outcome matches the scenario intent.
  release(); await page.waitForResponse(r => r.url().includes("locationId=A")); await expect(page.getByTestId("audit")).toContainText("HISTORY-B"); await expect(page.getByTestId("audit")).not.toContainText("HISTORY-A");
});
// Case: live board marks delayed polls stale then offline and recovers after success.
test("live board marks delayed polls stale then offline and recovers after success", async ({ page }) => {
  // payload: HTTP response captured for status/body checks.
  const payload = await (await page.request.get("/api/operations/live")).json(); let requests = 0; let release!: () => void; const gate = new Promise<void>(r => { release = r; });
  // Await async work before asserting or releasing locks.
  await page.clock.install({ time: new Date("2026-10-19T10:00:00Z") });
  // Await async work before asserting or releasing locks.
  await page.route("**/api/operations/live", async route => { requests++; if (requests === 2) { await gate; await route.fulfill({ status: 503, json: { error: "unavailable" } }); } else await route.fulfill({ json: payload }); });
  // Assert UI visibility/state after the user action.
  await mount(page, "live"); await expect(page.getByText("Live", { exact: true })).toBeVisible();
  // Assert UI visibility/state after the user action.
  await page.clock.fastForward(46000); await expect(page.getByText("Stale data", { exact: true })).toBeVisible();
  // Assert UI visibility/state after the user action.
  release(); await expect(page.getByText("Offline", { exact: true })).toBeVisible();
  // Assert UI visibility/state after the user action.
  await page.clock.fastForward(15000); await expect(page.getByText("Live", { exact: true })).toBeVisible();
});
// Case: attendance filter B cannot be replaced by delayed unfiltered results.
test("attendance filter B cannot be replaced by delayed unfiltered results", async ({ page }) => {
  // fetched: HTTP response captured for status/body checks.
  const fetched = await (await page.request.get("/api/attendance/intervals?limit=1")).json();
  // P1 seed may have zero intervals; the race only needs a DTO shape to mock.
  const sample = fetched.intervals?.[0] ?? {
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    id: "fixture-interval",
    // Execute the next setup or assertion step for this scenario.
    hotelDate: "2000-01-01",
    // Fixture field status for the seeded actor/entity.
    status: "closed",
    // Execute the next setup or assertion step for this scenario.
    startedAt: "2000-01-01T08:00:00.000Z",
    // Execute the next setup or assertion step for this scenario.
    endedAt: "2000-01-01T16:00:00.000Z",
    // Execute the next setup or assertion step for this scenario.
    breakMinutes: 30,
    // Execute the next setup or assertion step for this scenario.
    workedMinutes: 450,
    // Execute the next setup or assertion step for this scenario.
    anomalyFlags: [],
    // Execute the next setup or assertion step for this scenario.
    adjustments: [],
    // Execute the next setup or assertion step for this scenario.
    employee: { id: "e1", fullName: "Fixture", employeeNumber: "F1", department: null },
  };
  // Bind payload for later setup or assertions in this scope.
  const payload = {
    // Execute the next setup or assertion step for this scenario.
    total: 1,
    // Pagination step for list/contract coverage.
    nextCursor: null,
    // Pagination step for list/contract coverage.
    limit: 50,
    // Concurrency/isolation step for the race under test.
    maxClockSkewSeconds: 0,
    // Continue the call chain for setup or assertion detail.
    ...fetched,
    // Execute the next setup or assertion step for this scenario.
    intervals: [sample],
  };
  // Execute the next setup or assertion step for this scenario.
  let release!: () => void; const gate = new Promise<void>(r => { release = r; });
  // Bind captured for later setup or assertions in this scope.
  let captured = false;
  // Bind aSettled for later setup or assertions in this scope.
  let aSettled = false;
  // Bind capturedB for later setup or assertions in this scope.
  let capturedB = false;
  // Await async work before asserting or releasing locks.
  await page.route("**/api/attendance/intervals**", async route => {
    // Bind url for later setup or assertions in this scope.
    const url = route.request().url();
    // Bind current for later setup or assertions in this scope.
    const current = new URL(url).searchParams.get("q") === "B";
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (!current) {
      // Execute the next setup or assertion step for this scenario.
      captured = true;
      // Await async work before asserting or releasing locks.
      await gate;
      // Try path where partial failure must not leak suite state.
      try {
        // Await async work before asserting or releasing locks.
        await route.fulfill({
          // Execute the next setup or assertion step for this scenario.
          json: {
            // Continue the call chain for setup or assertion detail.
            ...payload,
            // Execute the next setup or assertion step for this scenario.
            intervals: [{ ...sample, employee: { ...sample.employee, fullName: "STALE-FILTER-A" } }],
          },
        });
      // Execute the next setup or assertion step for this scenario.
      } catch { /* aborted stale A */ }
      // Always run cleanup to preserve DB/server isolation across cases.
      finally { aSettled = true; }
      // Execute the next setup or assertion step for this scenario.
      return;
    }
    // Execute the next setup or assertion step for this scenario.
    capturedB = true;
    // Await async work before asserting or releasing locks.
    await route.fulfill({
      // Execute the next setup or assertion step for this scenario.
      json: {
        // Continue the call chain for setup or assertion detail.
        ...payload,
        // Execute the next setup or assertion step for this scenario.
        intervals: [{ ...sample, employee: { ...sample.employee, fullName: "CURRENT-FILTER-B" } }],
      },
    });
  });
  // Await async work before asserting or releasing locks.
  await mount(page, "attendance");
  // Await async work before asserting or releasing locks.
  await expect.poll(() => captured).toBe(true);
  // Assert UI visibility/state after the user action.
  await expect(page.getByLabel("Търсене")).toBeVisible();
  // Await async work before asserting or releasing locks.
  await page.getByLabel("Търсене").fill("B");
  // Await async work before asserting or releasing locks.
  await expect.poll(() => capturedB).toBe(true);
  // Assert UI visibility/state after the user action.
  await expect(page.getByText("CURRENT-FILTER-B", { exact: true })).toBeVisible();
  // Execute the next setup or assertion step for this scenario.
  release();
  // Await async work before asserting or releasing locks.
  await expect.poll(() => aSettled).toBe(true);
  // Assert UI visibility/state after the user action.
  await expect(page.getByText("CURRENT-FILTER-B", { exact: true })).toBeVisible();
  // Assert UI visibility/state after the user action.
  await expect(page.getByText("STALE-FILTER-A", { exact: true })).toHaveCount(0);
});
// Case: ticket B keeps its history after delayed A and current filter results remain visible.
test("ticket B keeps its history after delayed A and current filter results remain visible", async ({ page }) => {
  // rows: HTTP response captured for status/body checks.
  const rows = await (await page.request.get("/api/maintenance/tickets?status=all&limit=2")).json(); expect(rows.length).toBeGreaterThan(1);
  // Bind tickets for later setup or assertions in this scope.
  const tickets = rows.slice(0, 2).map((r: any, i: number) => ({ ...r, blocksRoom: false, status: "new", title: `SELECT-TICKET-${i === 0 ? "A" : "B"}` }));
  // Await async work before asserting or releasing locks.
  await page.route("**/api/maintenance/tickets?*", route =>
    // Execute the next setup or assertion step for this scenario.
    route.fulfill({ json: ticketListResponse(route.request().url(), tickets) }),
  );
  // Execute the next setup or assertion step for this scenario.
  let release!: () => void; const gate = new Promise<void>(r => { release = r; }); let captured = false;
  // Await async work before asserting or releasing locks.
  await page.route("**/api/maintenance/tickets/*/events", async route => { const a = route.request().url().includes(tickets[0].id); if (a) { captured = true; await gate; } await route.fulfill({ json: [{ id: a ? "event-a" : "event-b", toStatus: "assigned", fromStatus: "new", occurredAt: new Date().toISOString(), reason: a ? "HISTORY-A" : "HISTORY-B", actor: { fullName: "Actor" } }] }); });
  // Await async work before asserting or releasing locks.
  await mount(page, "repairs"); await page.getByText("SELECT-TICKET-A", { exact: true }).first().click(); await expect.poll(() => captured).toBe(true);
  // Assert UI visibility/state after the user action.
  await page.getByText("SELECT-TICKET-B", { exact: true }).first().click(); await expect(page.getByText("HISTORY-B")).toBeVisible();
  // old: synchronize actors so the race window is observable.
  const old = page.waitForResponse(r => r.url().includes(`${tickets[0].id}/events`)); release(); await old;
  // Assert UI visibility/state after the user action.
  await expect(page.getByText("HISTORY-B")).toBeVisible(); await expect(page.getByText("HISTORY-A")).toHaveCount(0);
});
