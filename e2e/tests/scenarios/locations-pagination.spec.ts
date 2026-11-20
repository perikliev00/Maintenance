// Playwright test runner APIs for browser E2E scenarios.
import { expect, test } from "@playwright/test";

// Repeat/poll to widen the race window or wait for lock waiters.
for (const screen of ["rooms", "common", "repairs"] as const) {
  // Case: ${screen}: actual page keeps locations beyond 500 in the board, overdue filter and picker.
  test(`${screen}: actual page keeps locations beyond 500 in the board, overdue filter and picker`, async ({ page }) => {
    const login = await page.request.post("/api/auth/login", { data: { email: "owner@meridian.local", password: "demo1234" } });
    expect(login.status()).toBe(200);
    const { user } = await login.json();
    const sample = (await (await page.request.get("/api/rooms")).json())[0];
    expect(sample).toBeTruthy();
    const endpoint = screen === "common" ? "common-areas" : "rooms";
    const late = { ...sample, id: "pagination-late", number: "LATE-PAGE-ROOM", activeTask: null, blockingIssues: [] };
    const first = Array.from({ length: 500 }, (_, i) => ({ ...sample, id: `pagination-${i}`, number: `PAGE-${i}`, activeTask: null, blockingIssues: [] }));
    await page.route(`**/api/${endpoint}*`, route => {
      const next = new URL(route.request().url()).searchParams.has("cursor");
      return route.fulfill({ json: next ? [late] : first, headers: next ? {} : { "X-Result-Truncated": "1", "X-Next-Cursor": "page-two" } });
    });
    await page.route("**/api/cleaning/sessions/review", route => route.fulfill({ json: [
      { sessionId: "late-session", taskId: "late-task", startedAt: new Date().toISOString(), elapsedMinutes: 600, employee: { id: "cleaner", fullName: "Late cleaner", employeeNumber: "1" }, room: { id: late.id, number: late.number, buildingCode: "PAGE", floor: 1 } },
      { sessionId: "foreign-session", taskId: "foreign-task", startedAt: new Date().toISOString(), elapsedMinutes: 600, employee: { id: "foreign", fullName: "Foreign cleaner", employeeNumber: "2" }, room: { id: "not-on-board", number: "FOREIGN-ROOM", buildingCode: "FOREIGN", floor: 1 } },
    ] }));
    await page.route("**/__scenario", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><main id='root'></main>" }));
    await page.goto("/__scenario");
    await page.evaluate(async ({ user, screen }) => {
      const refresh = await import(/* @vite-ignore */ String("/@react-refresh"));
      refresh.default.injectIntoGlobalHook(window);
      Object.assign(window, { $RefreshReg$: () => {}, $RefreshSig$: () => (type: unknown) => type, __vite_plugin_react_preamble_installed__: true });
      const scope = await import(/* @vite-ignore */ "/src/offline/userScope.ts");
      scope.setOfflineUser(user.id);
      await scope.whenOfflineUserSettled();
      (window as any).screenHarness = (await import(/* @vite-ignore */ "/tests/browserHarness.tsx")).mountScreen(screen, user);
    }, { user, screen });
    if (screen === "repairs") {
      const picker = page.getByRole("combobox", { name: "Room", exact: true });
      await expect(picker.locator("option")).toHaveCount(501);
      await picker.selectOption(late.id);
      await expect(picker).toHaveValue(late.id);
    } else {
      await expect(page.locator("article[data-location-id]")).toHaveCount(501);
      await expect(page.locator("article[data-location-id]").filter({ hasText: late.number })).toHaveCount(1);
      await expect(page.getByText(/Late cleaner/)).toBeVisible();
      await expect(page.getByText(/Foreign cleaner/)).toHaveCount(0);
    }
  });
}
