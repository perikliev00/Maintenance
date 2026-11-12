// Playwright test runner APIs for browser E2E scenarios.
import { expect, test } from "@playwright/test";
// Import module bindings used by this suite.
import {
  // Session/CSRF step exercising auth lifecycle.
  apiLogin,
  // Delivery/replay step for async notification paths.
  getModulesSetting,
  // Delivery/replay step for async notification paths.
  patchModulesSetting,
// Execute the next setup or assertion step for this scenario.
} from "./helpers/api";
// Import bindings from ./helpers/auth.
import { uiLogin, USERS } from "./helpers/auth";
// Import bindings from ./helpers/nav.
import { expectNavVisible, openNav } from "./helpers/nav";

/**
 * Cookie session + CSRF: a real UI mutation (settings save) succeeds without
 * Bearer Authorization, proving double-submit CSRF wiring in the browser.
 */
test.describe("cookie CSRF mutate", () => {
  // Case: settings save via cookie session updates nav.
  test("settings save via cookie session updates nav", async ({ page }) => {
    // Await async work before asserting or releasing locks.
    const { token } = await apiLogin(USERS.owner);
    // original: HTTP response captured for status/body checks.
    const original = await getModulesSetting(token);

    // Session/CSRF step exercising auth lifecycle.
    const mutateRequests: Array<{ hasAuth: boolean; hasCsrf: boolean }> = [];
    // Await async work before asserting or releasing locks.
    await page.route("**/settings/modules", async (route) => {
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (route.request().method() === "PATCH") {
        // Bind headers for later setup or assertions in this scope.
        const headers = route.request().headers();
        // Execute the next setup or assertion step for this scenario.
        mutateRequests.push({
          // Execute the next setup or assertion step for this scenario.
          hasAuth: Boolean(headers.authorization),
          // Session/CSRF step exercising auth lifecycle.
          hasCsrf: Boolean(headers["x-csrf-token"]),
        });
      }
      // Await async work before asserting or releasing locks.
      await route.continue();
    });

    // Try path where partial failure must not leak suite state.
    try {
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (original.attendance === false) {
        // Await async work before asserting or releasing locks.
        await patchModulesSetting(token, { ...original, attendance: true });
      }

      // Drive the browser through the user-visible workflow step.
      await uiLogin(page, USERS.owner);
      // Await async work before asserting or releasing locks.
      await expectNavVisible(page, /Присъствие|Attendance/, true);

      // Await async work before asserting or releasing locks.
      await openNav(page, /Настройки|Settings/);
      // Assert UI visibility/state after the user action.
      await expect(page.getByRole("heading", { name: /Настройки|Settings/ })).toBeVisible();
      // Drive the browser through the user-visible workflow step.
      await page.getByRole("tab", { name: /Модули|Modules/ }).click();
      // Drive the browser through the user-visible workflow step.
      await page.getByRole("checkbox", { name: /Присъствие|Attendance/ }).uncheck();
      // Drive the browser through the user-visible workflow step.
      await page.getByRole("button", { name: /Запази|Save/ }).click();
      // Assert UI visibility/state after the user action.
      await expect(page.getByText(/Запазено|Saved/)).toBeVisible();

      // Assert browser/UI outcome matches the scenario intent.
      expect(mutateRequests.length).toBeGreaterThan(0);
      // Browser cookie path should send CSRF and typically no Bearer header.
      expect(mutateRequests.some((r) => r.hasCsrf)).toBe(true);
      // Assert browser/UI outcome matches the scenario intent.
      expect(mutateRequests.every((r) => !r.hasAuth)).toBe(true);

      // Await async work before asserting or releasing locks.
      await expectNavVisible(page, /Присъствие|Attendance/, false);
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Await async work before asserting or releasing locks.
      await patchModulesSetting(token, original, "e2e restore modules");
    }
  });
});
