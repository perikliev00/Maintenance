// Playwright test runner APIs for browser E2E scenarios.
import { expect, test } from "@playwright/test";
// Import bindings from ./helpers/api.
import { apiLogin, getRoleGrants, putRoleGrants } from "./helpers/api";
// Import bindings from ./helpers/auth.
import { uiLogin, USERS } from "./helpers/auth";
// Import bindings from ./helpers/nav.
import { openNav } from "./helpers/nav";

/**
 * after an admin revoke, an already-open supervisor session must drop
 * Mark dirty via SSE permissions.changed → /auth/me — without manual reload.
 */
test.describe("permissions live capability refresh", () => {
  // Case: supervisor loses Mark dirty without reload after grant revoke.
  test("supervisor loses Mark dirty without reload after grant revoke", async ({
    // Execute the next setup or assertion step for this scenario.
    page,
  // Execute the next setup or assertion step for this scenario.
  }) => {
    // Await async work before asserting or releasing locks.
    const { token: ownerToken } = await apiLogin(USERS.owner);
    // original: HTTP response captured for status/body checks.
    const original = await getRoleGrants(ownerToken, "supervisor");

    // Try path where partial failure must not leak suite state.
    try {
      // Bind markDirty for later setup or assertions in this scope.
      const markDirty = /Маркирай като мръсна|Mark dirty/;
      // Drive the browser through the user-visible workflow step.
      await uiLogin(page, USERS.supervisor);
      // Await async work before asserting or releasing locks.
      await openNav(page, /Стаи|Rooms/);
      // Await async work before asserting or releasing locks.
      await expect(
        // Drive the browser through the user-visible workflow step.
        page.getByRole("button", { name: markDirty }).first(),
      // Runner option controlling stability or isolation of the suite.
      ).toBeVisible({ timeout: 20_000 });

      // Ensure SSE has a chance to connect before the revoke.
      await page.waitForTimeout(1_000);

      // Await async work before asserting or releasing locks.
      await putRoleGrants(
        // Execute the next setup or assertion step for this scenario.
        ownerToken,
        // Execute the next setup or assertion step for this scenario.
        "supervisor",
        {
          // Execute the next setup or assertion step for this scenario.
          panels: original.panels,
          // Execute the next setup or assertion step for this scenario.
          actions: original.actions.filter(
            // Execute the next setup or assertion step for this scenario.
            (a) => a !== "rooms.mark_dirty" && a !== "cleaning.create",
          ),
        },
        // Execute the next setup or assertion step for this scenario.
        "e2e live revoke mark-dirty",
      );

      // No page.reload() — capabilities must refresh from permissions.changed.
      await expect(page.getByRole("button", { name: markDirty })).toHaveCount(
        0,
        // Runner option controlling stability or isolation of the suite.
        { timeout: 20_000 },
      );
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Await async work before asserting or releasing locks.
      await putRoleGrants(
        // Execute the next setup or assertion step for this scenario.
        ownerToken,
        // Execute the next setup or assertion step for this scenario.
        "supervisor",
        // Execute the next setup or assertion step for this scenario.
        original,
        // Session/CSRF step exercising auth lifecycle.
        "e2e restore grants after live refresh",
      );
    }
  });
});
