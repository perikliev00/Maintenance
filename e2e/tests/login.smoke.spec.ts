// Playwright test runner APIs for browser E2E scenarios.
import { expect, test } from "@playwright/test";
// Import bindings from ./helpers/auth.
import { uiLogin, USERS } from "./helpers/auth";

/**
 * Browser smoke: seed owner can sign in and reach the authenticated shell.
 * Requires migrated + seeded API DB (same demo users as local README).
 */
test.describe("login smoke", () => {
  // Case: owner signs in and sees main navigation.
  test("owner signs in and sees main navigation", async ({ page }) => {
    // Drive the browser through the user-visible workflow step.
    await uiLogin(page, USERS.owner);
    // Assert UI visibility/state after the user action.
    await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
    // Assert UI visibility/state after the user action.
    await expect(page.getByRole("heading", { name: "Meridian" })).toHaveCount(0);
  });
});
