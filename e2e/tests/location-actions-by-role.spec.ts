import { expect, test } from "@playwright/test";
import { uiLogin, USERS } from "./helpers/auth";
import { openNav } from "./helpers/nav";

/**
 * Location board action gates: housekeeper does not see Mark dirty;
 * supervisor does (when a clean room without active task exists).
 */
test.describe("location actions by role", () => {
  test("housekeeper has no Mark dirty; supervisor does", async ({ page }) => {
    await uiLogin(page, USERS.housekeeper);
    await openNav(page, /Стаи|Rooms/);
    // Board may take a moment to load room rows.
    await expect(
      page.getByText(/MAIN|ANNEX|ROYAL|ста|room/i).first(),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByRole("button", { name: /Маркирай като мръсна|Mark dirty/ }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

    await uiLogin(page, USERS.supervisor);
    await openNav(page, /Стаи|Rooms/);
    await expect(
      page.getByRole("button", { name: /Маркирай като мръсна|Mark dirty/ }).first(),
    ).toBeVisible({
      timeout: 20_000,
    });
  });
});
