import { expect, type Page } from "@playwright/test";

export const DEMO_PASSWORD = "demo1234";

export const USERS = {
  owner: "owner@meridian.local",
  manager: "manager@meridian.local",
  supervisor: "supervisor@meridian.local",
  housekeeper: "housekeeper@meridian.local",
  elena: "elena@meridian.local",
  technician: "technician@meridian.local",
} as const;

/** Cookie login through the real LoginPage UI. */
export async function uiLogin(
  page: Page,
  email: string,
  password = DEMO_PASSWORD,
): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Meridian" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
}

/** Cached AuthUser.id from localStorage after UI login. */
export async function storedUserId(page: Page): Promise<string> {
  const id = await page.evaluate(() => {
    const raw = localStorage.getItem("user");
    if (!raw) return null;
    try {
      return (JSON.parse(raw) as { id?: string }).id ?? null;
    } catch {
      return null;
    }
  });
  if (!id) throw new Error("localStorage user.id missing after login");
  return id;
}

/** Expect the unauthenticated login screen. */
export async function expectLoginScreen(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Meridian" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
}
