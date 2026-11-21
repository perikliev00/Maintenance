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
 * Cookie session + CSRF: a real UI mutation (settings save) succeeds without
 * Bearer Authorization, proving double-submit CSRF wiring in the browser.
 */
test.describe("cookie CSRF mutate", () => {
  // Case: settings save via cookie session updates nav.
  test("settings save via cookie session updates nav", async ({ page }) => {
    const { token } = await apiLogin(USERS.owner);
    const original = await getModulesSetting(token);

    const mutateRequests: Array<{ hasAuth: boolean; hasCsrf: boolean }> = [];
    await page.route("**/settings/modules", async (route) => {
      if (route.request().method() === "PATCH") {
        const headers = route.request().headers();
        mutateRequests.push({
          hasAuth: Boolean(headers.authorization),
          hasCsrf: Boolean(headers["x-csrf-token"]),
        });
      }
      await route.continue();
    });

    try {
      if (original.attendance === false) {
        await patchModulesSetting(token, { ...original, attendance: true });
      }

      await uiLogin(page, USERS.owner);
      await expectNavVisible(page, /Присъствие|Attendance/, true);

      await openNav(page, /Настройки|Settings/);
      await expect(page.getByRole("heading", { name: /Настройки|Settings/ })).toBeVisible();
      await page.getByRole("button", { name: /Модули|Modules/ }).click();
      await page.getByRole("checkbox", { name: /Присъствие|Attendance/ }).uncheck();
      await page.getByRole("button", { name: /Запази|Save/ }).click();
      await expect(page.getByText(/Запазено|Saved/)).toBeVisible();

      expect(mutateRequests.length).toBeGreaterThan(0);
      // Browser cookie path should send CSRF and typically no Bearer header.
      expect(mutateRequests.some((r) => r.hasCsrf)).toBe(true);
      expect(mutateRequests.every((r) => !r.hasAuth)).toBe(true);

      await expectNavVisible(page, /Присъствие|Attendance/, false);
    } finally {
      await patchModulesSetting(token, original, "e2e restore modules");
    }
  });
});
