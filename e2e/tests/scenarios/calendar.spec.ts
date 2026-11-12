// Playwright test runner APIs for browser E2E scenarios.
import { expect, test } from "@playwright/test";
// Case: hotel date and month stay consistent across device zones at Sofia New Year.
test("hotel date and month stay consistent across device zones at Sofia New Year", async ({ browser }) => {
  for (const timezoneId of ["America/Los_Angeles", "Asia/Tokyo"]) {
    const context = await browser.newContext({ timezoneId }); const page = await context.newPage();
    try {
      const response = await page.request.post("http://127.0.0.1:5185/api/auth/login", { data: { email: "owner@meridian.local", password: "demo1234" } }); expect(response.status()).toBe(200); const user = (await response.json()).user;
      await page.clock.setFixedTime(new Date("2025-12-31T22:30:00Z"));
      await page.route("**/__scenario", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><main id='root'></main>" }));
      await page.goto("http://127.0.0.1:5185/__scenario");
      await page.evaluate(async user => { const r = await import(/* @vite-ignore */ String("/@react-refresh")); r.default.injectIntoGlobalHook(window); Object.assign(window, { $RefreshReg$: () => {}, $RefreshSig$: () => (type: unknown) => type, __vite_plugin_react_preamble_installed__: true }); const p = await import(/* @vite-ignore */ "/src/api/planApi.ts"); p.setCachedHotelTimezone("Europe/Sofia"); (window as any).harness = (await import(/* @vite-ignore */ "/tests/browserHarness.tsx")).mountScreen("attendance", user); }, user);
      await expect(page.locator('input[type="month"]')).toHaveValue("2026-01");
      await page.evaluate(async user => { (window as any).harness.stop(); (window as any).harness = (await import(/* @vite-ignore */ "/tests/browserHarness.tsx")).mountScreen("plan", user); }, user);
      await expect(page.locator('input[type="date"]').first()).toHaveValue("2026-01-01");
    } finally { await context.close(); }
  }
});
