import { expect, test } from "@playwright/test";
import { uiLogin, USERS } from "./helpers/auth";

/**
 * Browser smoke: seed owner can sign in and reach the authenticated shell.
 * Requires migrated + seeded API DB (same demo users as local README).
 */
test.describe("login smoke", () => {
  test("owner signs in and sees main navigation", async ({ page }) => {
    await uiLogin(page, USERS.owner);
    await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Meridian" })).toHaveCount(0);
  });
});
