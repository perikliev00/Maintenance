// Playwright test runner APIs for browser E2E scenarios.
import { expect, test } from "@playwright/test";
// Import bindings from ./helpers/auth.
import { uiLogin, USERS } from "./helpers/auth";
// Import bindings from ./helpers/nav.
import { openNav } from "./helpers/nav";

/**
 * Location board action gates: housekeeper does not see Mark dirty;
 * supervisor does (when a clean room without active task exists).
 */
test.describe("location actions by role", () => {
  // Case: housekeeper has no Mark dirty; supervisor does.
  test("housekeeper has no Mark dirty; supervisor does", async ({ page }) => {
    // Drive the browser through the user-visible workflow step.
    await uiLogin(page, USERS.housekeeper);
    // Await async work before asserting or releasing locks.
    await openNav(page, /Стаи|Rooms/);
    // Board may take a moment to load room rows.
    await expect(
      // Execute the next setup or assertion step for this scenario.
      page.getByText(/MAIN|ANNEX|ROYAL|ста|room/i).first(),
    // Runner option controlling stability or isolation of the suite.
    ).toBeVisible({ timeout: 20_000 });
    // Await async work before asserting or releasing locks.
    await expect(
      // Drive the browser through the user-visible workflow step.
      page.getByRole("button", { name: /Маркирай като мръсна|Mark dirty/ }),
    // Execute the next setup or assertion step for this scenario.
    ).toHaveCount(0);

    // Drive the browser through the user-visible workflow step.
    await page.getByRole("button", { name: "Log out" }).click();
    // Assert UI visibility/state after the user action.
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

    // Drive the browser through the user-visible workflow step.
    await uiLogin(page, USERS.supervisor);
    // Await async work before asserting or releasing locks.
    await openNav(page, /Стаи|Rooms/);
    // Await async work before asserting or releasing locks.
    await expect(
      // Drive the browser through the user-visible workflow step.
      page.getByRole("button", { name: /Маркирай като мръсна|Mark dirty/ }).first(),
    // Execute the next setup or assertion step for this scenario.
    ).toBeVisible({
      // Runner option controlling stability or isolation of the suite.
      timeout: 20_000,
    });
  });
});
