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
import { openNav } from "./helpers/nav";

/**
 * Closes remaining Settings gaps that unit tests cannot fully prove in-browser:
 * dirty draft survives a concurrent modules PATCH / live refresh
 * editors stay locked while Save is in flight.
 */
test.describe("settings draft gaps", () => {
  // Case probes concurrency/isolation: dirty modules draft survives concurrent server change; save locks editors.
  test("dirty modules draft survives concurrent server change; save locks editors", async ({
    // Execute the next setup or assertion step for this scenario.
    page,
  // Execute the next setup or assertion step for this scenario.
  }) => {
    // Await async work before asserting or releasing locks.
    const { token } = await apiLogin(USERS.owner);
    // original: HTTP response captured for status/body checks.
    const original = await getModulesSetting(token);

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
      await openNav(page, /Настройки|Settings/);
      // Drive the browser through the user-visible workflow step.
      await page.getByRole("tab", { name: /Модули|Modules/ }).click();

      // Bind attendance for later setup or assertions in this scope.
      const attendance = page.getByRole("checkbox", {
        // Fixture field name for the seeded actor/entity.
        name: /Присъствие|Attendance/,
      });
      // Bind analytics for later setup or assertions in this scope.
      const analytics = page.getByRole("checkbox", {
        // Fixture field name for the seeded actor/entity.
        name: /Аналитика|Analytics/,
      });
      // Assert browser/UI outcome matches the scenario intent.
      await expect(attendance).toBeChecked();

      // Local dirty draft: turn analytics off without saving.
      await analytics.uncheck();
      // Assert browser/UI outcome matches the scenario intent.
      await expect(analytics).not.toBeChecked();

      // Concurrent server write on another field (attendance) while draft is dirty.
      const current = await getModulesSetting(token);
      // Await async work before asserting or releasing locks.
      await patchModulesSetting(
        // Execute the next setup or assertion step for this scenario.
        token,
        // Execute the next setup or assertion step for this scenario.
        { ...current, attendance: false },
        // Concurrency/isolation step for the race under test.
        "e2e concurrent settings.changed",
      );

      // Draft must keep the unsaved analytics=false; conflict/reload affordance may appear.
      await expect(analytics).not.toBeChecked({ timeout: 10_000 });

      // while Save is gated by a delayed PATCH, editors are disabled.
      let release!: () => void;
      // Bind gate for later setup or assertions in this scope.
      const gate = new Promise<void>((r) => {
        // Execute the next setup or assertion step for this scenario.
        release = r;
      });
      // Await async work before asserting or releasing locks.
      await page.route("**/settings/modules", async (route) => {
        // Conditional path for setup, cleanup, or alternate outcomes.
        if (route.request().method() !== "PATCH") return route.continue();
        // Await async work before asserting or releasing locks.
        await gate;
        // Await async work before asserting or releasing locks.
        await route.continue();
      });

      // Drive the browser through the user-visible workflow step.
      await page.getByRole("button", { name: /Запази|Save/ }).click();
      // Assert UI visibility/state after the user action.
      await expect(page.getByRole("button", { name: /Запис|Saving/ })).toBeDisabled();
      // Assert browser/UI outcome matches the scenario intent.
      await expect(attendance).toBeDisabled();
      // Assert browser/UI outcome matches the scenario intent.
      await expect(analytics).toBeDisabled();
      // Execute the next setup or assertion step for this scenario.
      release();

      // Assert UI visibility/state after the user action.
      await expect(page.getByText(/Запазено|Saved|Конфликт|Conflict/)).toBeVisible({
        // Runner option controlling stability or isolation of the suite.
        timeout: 15_000,
      });
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Await async work before asserting or releasing locks.
      await patchModulesSetting(token, original, "e2e restore modules");
    }
  });
});
