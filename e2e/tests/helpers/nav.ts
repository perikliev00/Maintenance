import { expect, type Page } from "@playwright/test";

/** Click a main-nav tab by its visible label (bg or en). */
export async function openNav(page: Page, label: string | RegExp): Promise<void> {
  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.getByRole("button", { name: label }).click();
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
