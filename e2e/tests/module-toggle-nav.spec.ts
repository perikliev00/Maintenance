// Playwright test runner APIs for browser E2E scenarios.
import { expect, test } from "@playwright/test";
import {
  apiLogin,
  getModulesSetting,
  patchModulesSetting,
} from "./helpers/api";
import { uiLogin, USERS } from "./helpers/auth";
import { expectNavVisible, openNav } from "./helpers/nav";

/**
 * Module toggle → attendance panel disappears from the real shell nav.
 */
test.describe("module toggle nav", () => {
  // Case: disabling attendance hides Присъствие / Attendance tab.
  test("disabling attendance hides Присъствие / Attendance tab", async ({
    page,
  }) => {
    const { token } = await apiLogin(USERS.owner);
    const original = await getModulesSetting(token);

    try {
      // Ensure attendance starts enabled for a stable baseline.
      if (original.attendance === false) {
        await patchModulesSetting(token, { ...original, attendance: true });
      }

      await uiLogin(page, USERS.owner);
      await expectNavVisible(page, /Присъствие|Attendance/, true);

      await openNav(page, /Настройки|Settings/);
      await expect(page.getByRole("heading", { name: /Настройки|Settings/ })).toBeVisible();
      await page.getByRole("tab", { name: /Модули|Modules/ }).click();

      const attendanceBox = page.getByRole("checkbox", {
        name: /Присъствие|Attendance/,
      });
      await expect(attendanceBox).toBeChecked();
      await attendanceBox.uncheck();
      await page.getByRole("button", { name: /Запази|Save/ }).click();
      await expect(page.getByText(/Запазено|Saved/)).toBeVisible();

      await expectNavVisible(page, /Присъствие|Attendance/, false);
    } finally {
      await patchModulesSetting(token, original, "e2e restore modules");
    }
  });
});
