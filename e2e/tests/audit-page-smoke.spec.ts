/**
 * Audit page smoke — open, filter, refresh on isolated P1 DB.
 * Live SSE coverage lives in audit-page-live-refresh.spec.ts.
 */
import { expect, test } from "@playwright/test";
import { uiLogin, USERS } from "./helpers/auth";
import { openNav } from "./helpers/nav";

test.describe("Audit page smoke", () => {
  test("owner opens Одит, changes filter, and refreshes", async ({ page }) => {
    await uiLogin(page, USERS.owner);
    await openNav(page, /Одит|Audit/);

    await expect(
      page.getByRole("heading", { name: /Одит лог|Audit log/ }),
    ).toBeVisible();

    const actionSelect = page.getByLabel(/Действие|Action/);
    await expect(actionSelect).toBeVisible();
    await actionSelect.selectOption("ticket.sla_breach");

    const refresh = page.getByRole("button", { name: /Обнови|Refresh/ });
    await expect(refresh).toBeEnabled();
    await refresh.click();

    await expect(
      page.getByRole("heading", { name: /Събития|Events/ }),
    ).toBeVisible();
  });
});
