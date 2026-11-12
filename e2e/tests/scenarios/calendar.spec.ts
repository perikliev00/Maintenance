// Playwright test runner APIs for browser E2E scenarios.
import { expect, test } from "@playwright/test";
// Case: hotel date and month stay consistent across device zones at Sofia New Year.
test("hotel date and month stay consistent across device zones at Sofia New Year", async ({ browser }) => {
  // Iterate to cover variants or wait until a condition holds.
  for (const timezoneId of ["America/Los_Angeles", "Asia/Tokyo"]) {
    // context: synchronize actors so the race window is observable.
    const context = await browser.newContext({ timezoneId }); const page = await context.newPage();
    // Try path where partial failure must not leak suite state.
    try {
      // response: HTTP response captured for status/body checks.
      const response = await page.request.post("http://127.0.0.1:5185/api/auth/login", { data: { email: "owner@meridian.local", password: "demo1234" } }); expect(response.status()).toBe(200); const user = (await response.json()).user;
      // Await async work before asserting or releasing locks.
      await page.clock.setFixedTime(new Date("2025-12-31T22:30:00Z"));
      // Await async work before asserting or releasing locks.
      await page.route("**/__scenario", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><main id='root'></main>" }));
      // Drive the browser through the user-visible workflow step.
      await page.goto("http://127.0.0.1:5185/__scenario");
      // Await async work before asserting or releasing locks.
      await page.evaluate(async user => { const r = await import(/* @vite-ignore */ String("/@react-refresh")); r.default.injectIntoGlobalHook(window); Object.assign(window, { $RefreshReg$: () => {}, $RefreshSig$: () => (type: unknown) => type, __vite_plugin_react_preamble_installed__: true }); const p = await import(/* @vite-ignore */ "/src/api/planApi.ts"); p.setCachedHotelTimezone("Europe/Sofia"); (window as any).harness = (await import(/* @vite-ignore */ "/tests/browserHarness.tsx")).mountScreen("attendance", user); }, user);
      // Assert browser/UI outcome matches the scenario intent.
      await expect(page.locator('input[type="month"]')).toHaveValue("2026-01");
      // Await async work before asserting or releasing locks.
      await page.evaluate(async user => { (window as any).harness.stop(); (window as any).harness = (await import(/* @vite-ignore */ "/tests/browserHarness.tsx")).mountScreen("plan", user); }, user);
      // Assert browser/UI outcome matches the scenario intent.
      await expect(page.locator('input[type="date"]').first()).toHaveValue("2026-01-01");
    // Await async work before asserting or releasing locks.
    } finally { await context.close(); }
  }
});
