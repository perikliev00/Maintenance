// Playwright test runner APIs for browser E2E scenarios.
import { expect, test } from "@playwright/test";
import { apiLogin, getRoleGrants, putRoleGrants } from "./helpers/api";
import { uiLogin, USERS } from "./helpers/auth";
import { openNav } from "./helpers/nav";

/**
 * after an admin revoke, an already-open supervisor session must drop
 * Mark dirty via SSE permissions.changed → /auth/me — without manual reload.
 */
test.describe("permissions live capability refresh", () => {
  // Case: supervisor loses Mark dirty without reload after grant revoke.
  test("supervisor loses Mark dirty without reload after grant revoke", async ({
    page,
  }) => {
    const { token: ownerToken } = await apiLogin(USERS.owner);
    const original = await getRoleGrants(ownerToken, "supervisor");

    try {
      const markDirty = /Маркирай като мръсна|Mark dirty/;
      await uiLogin(page, USERS.supervisor);
      await openNav(page, /Стаи|Rooms/);
      await expect(
        page.getByRole("button", { name: markDirty }).first(),
      // Runner option controlling stability or isolation of the suite.
      ).toBeVisible({ timeout: 20_000 });

      // Ensure SSE has a chance to connect before the revoke.
      await page.waitForTimeout(1_000);

      await putRoleGrants(
        ownerToken,
        "supervisor",
        {
          panels: original.panels,
          actions: original.actions.filter(
            (a) => a !== "rooms.mark_dirty" && a !== "cleaning.create",
          ),
        },
        "e2e live revoke mark-dirty",
      );

      // No page.reload() — capabilities must refresh from permissions.changed.
      await expect(page.getByRole("button", { name: markDirty })).toHaveCount(
        0,
        { timeout: 20_000 },
      );
    } finally {
      await putRoleGrants(
        ownerToken,
        "supervisor",
        original,
        "e2e restore grants after live refresh",
      );
    }
  });
});
