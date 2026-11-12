/**
 * Audit page smoke — open, filter, refresh on isolated P1 DB.
 * Live SSE coverage lives in audit-page-live-refresh.spec.ts.
 */
import { expect, test } from "@playwright/test";
// Import bindings from ./helpers/auth.
import { uiLogin, USERS } from "./helpers/auth";
// Import bindings from ./helpers/nav.
import { openNav } from "./helpers/nav";

// Suite: Audit page smoke.
test.describe("Audit page smoke", () => {
  // Case: owner opens Одит, changes filter, and refreshes.
  test("owner opens Одит, changes filter, and refreshes", async ({ page }) => {
    // Drive the browser through the user-visible workflow step.
    await uiLogin(page, USERS.owner);
    // Await async work before asserting or releasing locks.
    await openNav(page, /Одит|Audit/);

    // Await async work before asserting or releasing locks.
    await expect(
      // Drive the browser through the user-visible workflow step.
      page.getByRole("heading", { name: /Одит лог|Audit log/ }),
    // Execute the next setup or assertion step for this scenario.
    ).toBeVisible();

    // Bind actionSelect for later setup or assertions in this scope.
    const actionSelect = page.getByLabel(/Действие|Action/);
    // Assert UI visibility/state after the user action.
    await expect(actionSelect).toBeVisible();
    // Await async work before asserting or releasing locks.
    await actionSelect.selectOption("ticket.sla_breach");

    // Bind refresh for later setup or assertions in this scope.
    const refresh = page.getByRole("button", { name: /Обнови|Refresh/ });
    // Assert browser/UI outcome matches the scenario intent.
    await expect(refresh).toBeEnabled();
    // Await async work before asserting or releasing locks.
    await refresh.click();

    // Await async work before asserting or releasing locks.
    await expect(
      // Drive the browser through the user-visible workflow step.
      page.getByRole("heading", { name: /Събития|Events/ }),
    // Execute the next setup or assertion step for this scenario.
    ).toBeVisible();
  });
});
