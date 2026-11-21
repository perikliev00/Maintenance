// Playwright test runner APIs for browser E2E scenarios.
import { expect, test } from "@playwright/test";
import {
  apiLogin,
  findUserIdByEmail,
  patchUserRole,
} from "./helpers/api";
import { openAccount, expectLoginScreen, uiLogin, USERS } from "./helpers/auth";

/**
 * UI: role change revokes sessions; open tab is forced back to login
 * (via people.changed → /me or the next authenticated fetch).
 */
test.describe("role change kick-out", () => {
  // Case: open tab returns to login after role change.
  test("open tab returns to login after role change", async ({ page }) => {
    const { token: ownerToken } = await apiLogin(USERS.owner);
    const elenaId = await findUserIdByEmail(ownerToken, USERS.elena);

    // Ensure known starting role.
    await patchUserRole(ownerToken, elenaId, "housekeeper");

    try {
      await uiLogin(page, USERS.elena);
      await openAccount(page);
    await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();

      await patchUserRole(ownerToken, elenaId, "technician");

      // SSE people.changed should refresh /me with a dead session → wipe.
      // Fallback: navigate to force an authenticated fetch.
      await Promise.race([
        expectLoginScreen(page),
        (async () => {
          await page.waitForTimeout(1500);
          await page.getByRole("navigation", { name: "Main" })
            .getByRole("button")
            .first()
            .click({ trial: true })
            // Handle rejection/cleanup on the preceding promise.
            .catch(() => undefined);
          await page.reload();
          await expectLoginScreen(page);
        })(),
      ]);
    } finally {
      await patchUserRole(ownerToken, elenaId, "housekeeper");
    }
  });
});
