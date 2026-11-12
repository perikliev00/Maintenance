// Playwright test runner APIs for browser E2E scenarios.
import { expect, test } from "@playwright/test";
// Import module bindings used by this suite.
import {
  // Session/CSRF step exercising auth lifecycle.
  apiLogin,
  // Execute the next setup or assertion step for this scenario.
  findUserIdByEmail,
  // Execute the next setup or assertion step for this scenario.
  patchUserRole,
// Execute the next setup or assertion step for this scenario.
} from "./helpers/api";
// Import bindings from ./helpers/auth.
import { expectLoginScreen, uiLogin, USERS } from "./helpers/auth";

/**
 * UI: role change revokes sessions; open tab is forced back to login
 * (via people.changed → /me or the next authenticated fetch).
 */
test.describe("role change kick-out", () => {
  // Case: open tab returns to login after role change.
  test("open tab returns to login after role change", async ({ page }) => {
    // Await async work before asserting or releasing locks.
    const { token: ownerToken } = await apiLogin(USERS.owner);
    // elenaId: unique stamp so parallel runs do not collide.
    const elenaId = await findUserIdByEmail(ownerToken, USERS.elena);

    // Ensure known starting role.
    await patchUserRole(ownerToken, elenaId, "housekeeper");

    // Try path where partial failure must not leak suite state.
    try {
      // Drive the browser through the user-visible workflow step.
      await uiLogin(page, USERS.elena);
      // Assert UI visibility/state after the user action.
      await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();

      // Await async work before asserting or releasing locks.
      await patchUserRole(ownerToken, elenaId, "technician");

      // SSE people.changed should refresh /me with a dead session → wipe.
      // Fallback: navigate to force an authenticated fetch.
      await Promise.race([
        // Session/CSRF step exercising auth lifecycle.
        expectLoginScreen(page),
        // Execute the next setup or assertion step for this scenario.
        (async () => {
          // Await async work before asserting or releasing locks.
          await page.waitForTimeout(1500);
          // Drive the browser through the user-visible workflow step.
          await page.getByRole("navigation", { name: "Main" })
            // Drive the browser through the user-visible workflow step.
            .getByRole("button")
            // Continue the call chain for setup or assertion detail.
            .first()
            // Continue the call chain for setup or assertion detail.
            .click({ trial: true })
            // Handle rejection/cleanup on the preceding promise.
            .catch(() => undefined);
          // Await async work before asserting or releasing locks.
          await page.reload();
          // Await async work before asserting or releasing locks.
          await expectLoginScreen(page);
        })(),
      ]);
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Await async work before asserting or releasing locks.
      await patchUserRole(ownerToken, elenaId, "housekeeper");
    }
  });
});
