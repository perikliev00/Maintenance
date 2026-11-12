// Playwright test runner APIs for browser E2E scenarios.
import { expect, test } from "@playwright/test";
// Import bindings from ./helpers/api.
import { apiLogin, getRoleGrants, putRoleGrants } from "./helpers/api";
// Import bindings from ./helpers/auth.
import { uiLogin, USERS } from "./helpers/auth";
// Import bindings from ./helpers/nav.
import { openNav } from "./helpers/nav";

/**
 * UI: after revoking mark-dirty (create) from supervisor, Rooms no
 * longer shows Mark dirty once capabilities refresh.
 */
test.describe("revoke action UI", () => {
  // Case: supervisor loses Mark dirty after grant revoke + reload.
  test("supervisor loses Mark dirty after grant revoke + reload", async ({
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
      // Assert UI visibility/state after the user action.
      await expect(page.getByRole("button", { name: markDirty }).first()).toBeVisible({
        // Runner option controlling stability or isolation of the suite.
        timeout: 20_000,
      });

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
        "e2e revoke mark-dirty UI",
      );

      // Await async work before asserting or releasing locks.
      await page.reload();
      // Assert UI visibility/state after the user action.
      await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
      // Await async work before asserting or releasing locks.
      await openNav(page, /Стаи|Rooms/);
      // Assert UI visibility/state after the user action.
      await expect(page.getByRole("button", { name: markDirty })).toHaveCount(
        0,
      );
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Await async work before asserting or releasing locks.
      await putRoleGrants(ownerToken, "supervisor", original, "e2e restore grants");
    }
  });
});
