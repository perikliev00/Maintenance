import { expect, type Page } from "@playwright/test";

/** Click a main-nav tab by its visible label (bg or en). */
export async function openNav(page: Page, label: string | RegExp): Promise<void> {
  const nav = page.getByRole("navigation", { name: "Main" });
  const tab = nav.getByRole("button", { name: label });
  // Narrow viewports park the sidebar off-canvas; open Menu before clicking.
  const box = await tab.boundingBox();
  if (!box || box.x + box.width <= 0) {
    const menu = page.getByRole("button", { name: /Open navigation|^Menu$/i });
    await expect(menu).toBeVisible();
    await menu.click();
    await expect(tab).toBeInViewport();
  }
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
    await expect(tab).toBeVisible();
  } else {
    await expect(tab).toHaveCount(0);
  }
}
