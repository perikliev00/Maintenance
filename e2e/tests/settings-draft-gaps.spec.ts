// Playwright test runner APIs for browser E2E scenarios.
import { expect, test } from "@playwright/test";
import {
  apiLogin,
  getModulesSetting,
  patchModulesSetting,
} from "./helpers/api";
import { uiLogin, USERS } from "./helpers/auth";
import { openNav } from "./helpers/nav";

/**
 * Closes remaining Settings gaps that unit tests cannot fully prove in-browser:
 * dirty draft survives a concurrent modules PATCH / live refresh
 * editors stay locked while Save is in flight.
 */
test.describe("settings draft gaps", () => {
  // Case probes concurrency/isolation: dirty modules draft survives concurrent server change; save locks editors.
  test("dirty modules draft survives concurrent server change; save locks editors", async ({
    page,
  }) => {
    const { token } = await apiLogin(USERS.owner);
    const original = await getModulesSetting(token);

    try {
      if (original.attendance === false) {
        await patchModulesSetting(token, { ...original, attendance: true });
      }

      await uiLogin(page, USERS.owner);
      await openNav(page, /Настройки|Settings/);
      await page.getByRole("button", { name: /Модули|Modules/ }).click();

      const attendance = page.getByRole("checkbox", {
        name: /Присъствие|Attendance/,
      });
      const analytics = page.getByRole("checkbox", {
        name: /Аналитика|Analytics/,
      });
      await expect(attendance).toBeChecked();

      // Local dirty draft: turn analytics off without saving.
      await analytics.uncheck();
      await expect(analytics).not.toBeChecked();

      // Concurrent server write on another field (attendance) while draft is dirty.
      const current = await getModulesSetting(token);
      await patchModulesSetting(
        token,
        { ...current, attendance: false },
        "e2e concurrent settings.changed",
      );

      // Draft must keep the unsaved analytics=false; conflict/reload affordance may appear.
      await expect(analytics).not.toBeChecked({ timeout: 10_000 });

      // while Save is gated by a delayed PATCH, editors are disabled.
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      await page.route("**/settings/modules", async (route) => {
        if (route.request().method() !== "PATCH") return route.continue();
        await gate;
        await route.continue();
      });

      await page.getByRole("button", { name: /Запази|Save/ }).click();
      await expect(page.getByRole("button", { name: /Запис|Saving/ })).toBeDisabled();
      await expect(attendance).toBeDisabled();
      await expect(analytics).toBeDisabled();
      release();

      await expect(page.getByText(/Запазено|Saved|Конфликт|Conflict/)).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await patchModulesSetting(token, original, "e2e restore modules");
    }
  });
});
