// Playwright test runner APIs for browser E2E scenarios.
import { expect, type Page } from "@playwright/test";

// Export DEMO_PASSWORD for shared test/setup consumers.
export const DEMO_PASSWORD = "demo1234";

// Export USERS for shared test/setup consumers.
export const USERS = {
  // Execute the next setup or assertion step for this scenario.
  owner: "owner@meridian.local",
  // Execute the next setup or assertion step for this scenario.
  manager: "manager@meridian.local",
  // Execute the next setup or assertion step for this scenario.
  supervisor: "supervisor@meridian.local",
  // Execute the next setup or assertion step for this scenario.
  housekeeper: "housekeeper@meridian.local",
  // Execute the next setup or assertion step for this scenario.
  elena: "elena@meridian.local",
  // Execute the next setup or assertion step for this scenario.
  technician: "technician@meridian.local",
// Execute the next setup or assertion step for this scenario.
} as const;

/** Cookie login through the real LoginPage UI. */
export async function uiLogin(
  // Execute the next setup or assertion step for this scenario.
  page: Page,
  // Fixture field email for the seeded actor/entity.
  email: string,
  // Execute the next setup or assertion step for this scenario.
  password = DEMO_PASSWORD,
// Execute the next setup or assertion step for this scenario.
): Promise<void> {
  // Drive the browser through the user-visible workflow step.
  await page.goto("/");
  // Assert UI visibility/state after the user action.
  await expect(page.getByRole("heading", { name: "Meridian" })).toBeVisible();
  // Await async work before asserting or releasing locks.
  await page.getByLabel("Email").fill(email);
  // Await async work before asserting or releasing locks.
  await page.getByLabel("Password").fill(password);
  // Drive the browser through the user-visible workflow step.
  await page.getByRole("button", { name: "Sign in" }).click();
  // Assert UI visibility/state after the user action.
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
}

/** Cached AuthUser.id from localStorage after UI login. */
export async function storedUserId(page: Page): Promise<string> {
  // id: unique stamp so parallel runs do not collide.
  const id = await page.evaluate(() => {
    // Bind raw for later setup or assertions in this scope.
    const raw = localStorage.getItem("user");
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (!raw) return null;
    // Try path where partial failure must not leak suite state.
    try {
      // Return the arranged value/result to the caller.
      return (JSON.parse(raw) as { id?: string }).id ?? null;
    // Execute the next setup or assertion step for this scenario.
    } catch {
      // Return the arranged value/result to the caller.
      return null;
    }
  });
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (!id) throw new Error("localStorage user.id missing after login");
  // Return the arranged value/result to the caller.
  return id;
}

/** Expect the unauthenticated login screen. */
export async function expectLoginScreen(page: Page): Promise<void> {
  // Assert UI visibility/state after the user action.
  await expect(page.getByRole("heading", { name: "Meridian" })).toBeVisible();
  // Assert UI visibility/state after the user action.
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
}
