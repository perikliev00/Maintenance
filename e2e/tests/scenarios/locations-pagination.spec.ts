// Playwright test runner APIs for browser E2E scenarios.
import { expect, test } from "@playwright/test";

// Repeat/poll to widen the race window or wait for lock waiters.
for (const screen of ["rooms", "common", "repairs"] as const) {
  // Case: ${screen}: actual page keeps locations beyond 500 in the board, overdue filter and picker.
  test(`${screen}: actual page keeps locations beyond 500 in the board, overdue filter and picker`, async ({ page }) => {
    // login: HTTP response captured for status/body checks.
    const login = await page.request.post("/api/auth/login", { data: { email: "owner@meridian.local", password: "demo1234" } });
    // Assert response/page reached the expected status.
    expect(login.status()).toBe(200);
    // Await async work before asserting or releasing locks.
    const { user } = await login.json();
    // sample: HTTP response captured for status/body checks.
    const sample = (await (await page.request.get("/api/rooms")).json())[0];
    // Assert browser/UI outcome matches the scenario intent.
    expect(sample).toBeTruthy();
    // Bind endpoint for later setup or assertions in this scope.
    const endpoint = screen === "common" ? "common-areas" : "rooms";
    // Bind late for later setup or assertions in this scope.
    const late = { ...sample, id: "pagination-late", number: "LATE-PAGE-ROOM", activeTask: null, blockingIssues: [] };
    // Bind first for later setup or assertions in this scope.
    const first = Array.from({ length: 500 }, (_, i) => ({ ...sample, id: `pagination-${i}`, number: `PAGE-${i}`, activeTask: null, blockingIssues: [] }));
    // Await async work before asserting or releasing locks.
    await page.route(`**/api/${endpoint}*`, route => {
      // Bind next for later setup or assertions in this scope.
      const next = new URL(route.request().url()).searchParams.has("cursor");
      // Return the arranged value/result to the caller.
      return route.fulfill({ json: next ? [late] : first, headers: next ? {} : { "X-Result-Truncated": "1", "X-Next-Cursor": "page-two" } });
    });
    // Await async work before asserting or releasing locks.
    await page.route("**/api/cleaning/sessions/review", route => route.fulfill({ json: [
      // Session/CSRF step exercising auth lifecycle.
      { sessionId: "late-session", taskId: "late-task", startedAt: new Date().toISOString(), elapsedMinutes: 600, employee: { id: "cleaner", fullName: "Late cleaner", employeeNumber: "1" }, room: { id: late.id, number: late.number, buildingCode: "PAGE", floor: 1 } },
      // Session/CSRF step exercising auth lifecycle.
      { sessionId: "foreign-session", taskId: "foreign-task", startedAt: new Date().toISOString(), elapsedMinutes: 600, employee: { id: "foreign", fullName: "Foreign cleaner", employeeNumber: "2" }, room: { id: "not-on-board", number: "FOREIGN-ROOM", buildingCode: "FOREIGN", floor: 1 } },
    // Execute the next setup or assertion step for this scenario.
    ] }));
    // Await async work before asserting or releasing locks.
    await page.route("**/__scenario", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><main id='root'></main>" }));
    // Drive the browser through the user-visible workflow step.
    await page.goto("/__scenario");
    // Await async work before asserting or releasing locks.
    await page.evaluate(async ({ user, screen }) => {
      // refresh: synchronize actors so the race window is observable.
      const refresh = await import(/* @vite-ignore */ String("/@react-refresh"));
      // Session/CSRF step exercising auth lifecycle.
      refresh.default.injectIntoGlobalHook(window);
      // Session/CSRF step exercising auth lifecycle.
      Object.assign(window, { $RefreshReg$: () => {}, $RefreshSig$: () => (type: unknown) => type, __vite_plugin_react_preamble_installed__: true });
      // scope: synchronize actors so the race window is observable.
      const scope = await import(/* @vite-ignore */ "/src/offline/userScope.ts");
      // Execute the next setup or assertion step for this scenario.
      scope.setOfflineUser(user.id);
      // Await async work before asserting or releasing locks.
      await scope.whenOfflineUserSettled();
      // Await async work before asserting or releasing locks.
      (window as any).screenHarness = (await import(/* @vite-ignore */ "/tests/browserHarness.tsx")).mountScreen(screen, user);
    // Execute the next setup or assertion step for this scenario.
    }, { user, screen });
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (screen === "repairs") {
      // Bind picker for later setup or assertions in this scope.
      const picker = page.getByRole("combobox", { name: "Room", exact: true });
      // Assert UI visibility/state after the user action.
      await expect(picker.locator("option")).toHaveCount(501);
      // Await async work before asserting or releasing locks.
      await picker.selectOption(late.id);
      // Assert browser/UI outcome matches the scenario intent.
      await expect(picker).toHaveValue(late.id);
    // Execute the next setup or assertion step for this scenario.
    } else {
      // Assert UI visibility/state after the user action.
      await expect(page.locator("table tbody tr")).toHaveCount(501);
      // Assert UI visibility/state after the user action.
      await expect(page.locator("table tbody tr").filter({ hasText: late.number })).toHaveCount(1);
      // Assert UI visibility/state after the user action.
      await expect(page.getByText(/Late cleaner/)).toBeVisible();
      // Assert UI visibility/state after the user action.
      await expect(page.getByText(/Foreign cleaner/)).toHaveCount(0);
    }
  });
}
