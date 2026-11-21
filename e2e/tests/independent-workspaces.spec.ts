import { expect, test } from "@playwright/test";
import { PANEL_NAMES } from "../../web/src/app/workspaces";
import type { Panel } from "../../web/src/api/capabilities";
import { openAccount, uiLogin, USERS } from "./helpers/auth";
import { openNav } from "./helpers/nav";

const panelModule: Partial<Record<Panel, string>> = {
  rooms: "rooms", common: "common", team: "team", live: "live", plan: "daily_plan",
  attendance: "attendance", cards: "access_cards", results: "analytics", analytics: "analytics",
  cleaning: "cleaning", audit: "audit", control: "control",
};

function enabledPanels(panels: Panel[], modules: Record<string, boolean>) {
  return panels.filter(panel => {
    if (panel === "repairs") return modules.repairs !== false && modules.maintenance !== false;
    if (panel === "mywork") return modules.my_work !== false && (modules.maintenance !== false || modules.cleaning !== false);
    if (panel === "home") return modules.maintenance !== false || modules.cleaning !== false;
    const module = panelModule[panel];
    return !module || modules[module] !== false;
  });
}

test("owner can reach every granted workspace through the replacement navigation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await uiLogin(page, USERS.owner);
  const settings = await (await page.request.get("/api/settings/public")).json();
  const locale: "en" | "bg" = settings.interface.locale;
  const me = await (await page.request.get("/api/auth/me")).json();
  const user = me.user ?? me;
  for (const panel of enabledPanels(user.panels as Panel[], settings.modules)) {
    await openNav(page, PANEL_NAMES[panel][locale]);
    await expect(page.locator("#workspace-content")).toHaveAttribute("data-current-panel", panel);
    await expect(page.locator("#workspace-content main")).toBeVisible();
    await expect(page.locator("#workspace-content").getByRole("heading").first()).toBeVisible();
  }
  expect(errors).toEqual([]);
});

for (const role of ["owner", "admin", "manager", "supervisor", "reception", "technician", "housekeeper"] as const) {
  test(`${role}: workspace finder exposes exactly the server-granted enabled destinations`, async ({ page }) => {
    await uiLogin(page, USERS[role]);
    const [me, settings] = await Promise.all([
      page.request.get("/api/auth/me").then(response => response.json()),
      page.request.get("/api/settings/public").then(response => response.json()),
    ]);
    const user = me.user ?? me;
    const locale: "en" | "bg" = settings.interface.locale;
    const expected = enabledPanels(user.panels as Panel[], settings.modules).map(panel => PANEL_NAMES[panel][locale]).sort();
    const trigger = page.getByRole("button", { name: /^(Find a workspace|Намерете раздел)$/ });
    await trigger.focus();
    await page.keyboard.press("Control+k");
    const finder = page.getByRole("dialog");
    await expect(finder).toBeVisible();
    await expect(finder.getByRole("textbox")).toBeFocused();
    const actual = await finder.locator(".ui-finder-results button > span").allTextContents();
    expect(actual.sort()).toEqual(expected);
    if (role === "owner") {
      const first = finder.getByRole("button", { name: "Close", exact: true });
      const last = finder.locator(".ui-finder-results button").last();
      await first.focus();
      await page.keyboard.press("Shift+Tab");
      await expect(last).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(first).toBeFocused();
    }
    await page.keyboard.press("Escape");
    await expect(finder).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}

for (const width of [390, 1280]) {
  test(`${width}px: workspace navigation, keyboard access and theme remain usable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await uiLogin(page, USERS.owner);
    await page.keyboard.press("Control+k");
    const finder = page.getByRole("dialog");
    await finder.getByRole("textbox").fill("rooms");
    await expect(finder.locator(".ui-finder-results button")).toHaveCount(1);
    await finder.locator(".ui-finder-results button").click();
    await expect(page.locator("#workspace-content")).toHaveAttribute("data-current-panel", "rooms");
    await expect(page.locator("#workspace-content")).toBeFocused();
    await expect(page.locator("#workspace-content main")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

    await openAccount(page);
    const html = page.locator("html");
    const previous = await html.getAttribute("data-theme");
    await page.getByRole("button", { name: /^(Light|Dark)$/ }).click();
    await expect(html).not.toHaveAttribute("data-theme", previous!);
    await page.keyboard.press("Escape");
    await expect(page.locator("#account-menu")).toHaveCount(0);
    const skip = page.locator('a[href="#workspace-content"]');
    await skip.focus();
    await expect(skip).toBeInViewport();
    await skip.press("Enter");
    await expect(page.locator("#workspace-content")).toBeFocused();
  });
}

test("workspace finder closes independently above a location dialog", async ({ page }) => {
  await uiLogin(page, USERS.owner);
  await openNav(page, /^(Стаи|Rooms)$/);
  const location = page.locator("article[data-location-id]").first();
  const detailTrigger = location.locator(".ui-location-title");
  await detailTrigger.click();
  const locationDialog = page.getByRole("dialog").filter({ has: page.locator("#location-detail-title") });
  await expect(locationDialog).toBeVisible();
  const parentClose = locationDialog.getByRole("button", { name: "Close", exact: true });
  await parentClose.focus();
  await page.keyboard.press("Control+k");
  const finder = page.getByRole("dialog").filter({ has: page.locator("#finder-title") });
  await expect(finder.getByRole("textbox")).toBeFocused();
  await expect(page.getByRole("dialog")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(finder).toHaveCount(0);
  await expect(locationDialog).toBeVisible();
  await expect(parentClose).toBeFocused();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await page.keyboard.press("Escape");
  await expect(locationDialog).toHaveCount(0);
  await expect(detailTrigger).toBeFocused();
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
});
