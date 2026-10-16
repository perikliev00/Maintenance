import { expect, test } from "@playwright/test";
import { apiLogin, getRoleGrants, putRoleGrants } from "./helpers/api";
import { uiLogin, USERS } from "./helpers/auth";
import { openNav } from "./helpers/nav";

/**
 * P1-05 UI: after revoking mark-dirty (+ create) from supervisor, Rooms no
 * longer shows Mark dirty once capabilities refresh.
 */
test.describe("revoke action UI", () => {
  test("supervisor loses Mark dirty after grant revoke + reload", async ({
    page,
  }) => {
    const { token: ownerToken } = await apiLogin(USERS.owner);
    const original = await getRoleGrants(ownerToken, "supervisor");

    try {
      await uiLogin(page, USERS.supervisor);
      await openNav(page, /Стаи|Rooms/);
      await expect(page.getByRole("button", { name: "Mark dirty" }).first()).toBeVisible({
        timeout: 20_000,
      });

      await putRoleGrants(
        ownerToken,
        "supervisor",
        {
          panels: original.panels,
          actions: original.actions.filter(
            (a) => a !== "rooms.mark_dirty" && a !== "cleaning.create",
          ),
        },
        "e2e revoke mark-dirty UI",
      );

      await page.reload();
      await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
      await openNav(page, /Стаи|Rooms/);
      await expect(page.getByRole("button", { name: "Mark dirty" })).toHaveCount(
        0,
      );
    } finally {
      await putRoleGrants(ownerToken, "supervisor", original, "e2e restore grants");
    }
  });
});
