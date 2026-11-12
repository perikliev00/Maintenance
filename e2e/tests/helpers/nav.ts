// Playwright test runner APIs for browser E2E scenarios.
import { expect, type Page } from "@playwright/test";

/** Click a main-nav tab by its visible label (bg or en). */
export async function openNav(page: Page, label: string | RegExp): Promise<void> {
  // Bind nav for later setup or assertions in this scope.
  const nav = page.getByRole("navigation", { name: "Main" });
  // Bind tab for later setup or assertions in this scope.
  const tab = nav.getByRole("button", { name: label });
  // Narrow viewports park the sidebar off-canvas; open Menu before clicking.
  const box = await tab.boundingBox();
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (!box || box.x + box.width <= 0) {
    // Bind menu for later setup or assertions in this scope.
    const menu = page.getByRole("button", { name: /Open navigation|^Menu$/i });
    // Assert UI visibility/state after the user action.
    await expect(menu).toBeVisible();
    // Await async work before asserting or releasing locks.
    await menu.click();
    // Assert browser/UI outcome matches the scenario intent.
    await expect(tab).toBeInViewport();
  }
  // Await async work before asserting or releasing locks.
  await tab.click();
}

/** Assert a nav tab is present / absent. */
export async function expectNavVisible(
  // Execute the next setup or assertion step for this scenario.
  page: Page,
  // Execute the next setup or assertion step for this scenario.
  label: string | RegExp,
  // Execute the next setup or assertion step for this scenario.
  visible: boolean,
// Execute the next setup or assertion step for this scenario.
): Promise<void> {
  // Bind tab for later setup or assertions in this scope.
  const tab = page
    // Drive the browser through the user-visible workflow step.
    .getByRole("navigation", { name: "Main" })
    // Drive the browser through the user-visible workflow step.
    .getByRole("button", { name: label });
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (visible) {
    // Assert UI visibility/state after the user action.
    await expect(tab).toBeVisible();
  // Execute the next setup or assertion step for this scenario.
  } else {
    // Assert UI visibility/state after the user action.
    await expect(tab).toHaveCount(0);
  }
}
