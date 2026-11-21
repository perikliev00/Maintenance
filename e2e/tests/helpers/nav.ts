// Playwright test runner APIs for browser E2E scenarios.
import { expect, type Page } from "@playwright/test";

/** Reveal a destination through the workspace navigation (bg or en). */
async function revealNav(page: Page, label: string | RegExp) {
  const nav = page.getByRole("navigation", { name: "Main" });
  // After reload / soft bootstrap the shell mounts before Main exists.
  await expect(nav).toBeVisible({ timeout: 20_000 });
  const tab = nav.getByRole("button", { name: label });
  if (await tab.isVisible()) {
    await tab.scrollIntoViewIfNeeded();
    return tab;
  }
  const menu = page.getByRole("button", { name: /Open navigation|^Menu$/i });
  if (await menu.isVisible()) await menu.click();
  if (await tab.isVisible()) return tab;

  // Workspace triggers expose the authorised destinations for that area.
  // Use their semantic test contract rather than depending on CSS layout.
  const workspaces = page.locator("[data-workspace]");
  await expect(workspaces.first()).toBeVisible({ timeout: 20_000 });
  for (let index = 0; index < await workspaces.count(); index++) {
    const workspace = workspaces.nth(index);
    if (!(await workspace.isVisible())) continue;
    await workspace.click();
    if (await tab.isVisible()) {
      await tab.scrollIntoViewIfNeeded();
      return tab;
    }
  }
  await expect(tab).toBeVisible();
  return tab;
}

/** Click a main-nav destination without assuming a sidebar composition. */
export async function openNav(page: Page, label: string | RegExp): Promise<void> {
  const tab = await revealNav(page, label);
  await tab.click();
}

/** Assert a nav tab is present / absent. */
export async function expectNavVisible(
  page: Page,
  label: string | RegExp,
  visible: boolean,
): Promise<void> {
  const tab = page
    .getByRole("navigation", { name: "Main" })
    .getByRole("button", { name: label });
  if (visible) {
    await expect(await revealNav(page, label)).toBeVisible();
  } else {
    await expect(tab).toHaveCount(0);
    const workspaces = page.locator("[data-workspace]");
    for (let index = 0; index < await workspaces.count(); index++) {
      const workspace = workspaces.nth(index);
      if (!(await workspace.isVisible())) continue;
      await workspace.click();
      await expect(tab).toHaveCount(0);
    }
  }
}
