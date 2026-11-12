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
 * Module toggle → attendance panel disappears from the real shell nav.
 */
test.describe("module toggle nav", () => {
  // Case: disabling attendance hides Присъствие / Attendance tab.
  test("disabling attendance hides Присъствие / Attendance tab", async ({
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
      // Ensure attendance starts enabled for a stable baseline.
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

      // Bind attendanceBox for later setup or assertions in this scope.
      const attendanceBox = page.getByRole("checkbox", {
        // Fixture field name for the seeded actor/entity.
        name: /Присъствие|Attendance/,
      });
      // Assert browser/UI outcome matches the scenario intent.
      await expect(attendanceBox).toBeChecked();
      // Await async work before asserting or releasing locks.
      await attendanceBox.uncheck();
      // Drive the browser through the user-visible workflow step.
      await page.getByRole("button", { name: /Запази|Save/ }).click();
      // Assert UI visibility/state after the user action.
      await expect(page.getByText(/Запазено|Saved/)).toBeVisible();

      // Await async work before asserting or releasing locks.
      await expectNavVisible(page, /Присъствие|Attendance/, false);
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Await async work before asserting or releasing locks.
      await patchModulesSetting(token, original, "e2e restore modules");
    }
  });
});
