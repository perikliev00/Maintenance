// Playwright test runner APIs for browser E2E scenarios.
import { expect, test } from "@playwright/test";
// Import bindings from ../helpers/auth.
import { uiLogin } from "../helpers/auth";
// Import bindings from ../helpers/nav.
import { openNav } from "../helpers/nav";
// Import bindings from ../helpers/api.
import { apiPost } from "../helpers/api";
// Shared test fixtures for seeding users, locations, and domain entities.
import { createDedicatedTechnician, findActiveIssueOption, ownerApi, prepareVacantDirtyRoom } from "../helpers/fixtures";

// Case: real My Work loads repairs beyond the first 50 without duplicate cards.
test("real My Work loads repairs beyond the first 50 without duplicate cards", async ({ page }) => {
  // Await async work before asserting or releasing locks.
  const { token } = await ownerApi();
  // tech: seeded entity required before the mutation under test.
  const tech = await createDedicatedTechnician(token);
  // room: synchronize actors so the race window is observable.
  const room = await prepareVacantDirtyRoom(token);
  // option: synchronize actors so the race window is observable.
  const option = await findActiveIssueOption(token);
  // prefix: unique stamp so parallel runs do not collide.
  const prefix = `PAGE-${crypto.randomUUID()}`;
  // Cleanup must run even when setup fails mid-loop (duplicate prevention / assign).
  try {
    // Repeat/poll to widen the race window or wait for lock waiters.
    for (let i = 0; i < 55; i++) {
      // Same room+option is exact duplicate identity; allowDuplicate keeps prevention
      // armed for non-override creates while this fixture seeds a paging volume.
      const created = await apiPost(token, "/maintenance/tickets", {
        // Execute the next setup or assertion step for this scenario.
        locationId: room.id,
        // Execute the next setup or assertion step for this scenario.
        issueOptionId: option.id,
        // Concurrency/isolation step for the race under test.
        blocksRoom: false,
        // Execute the next setup or assertion step for this scenario.
        title: `${prefix}-${i}`,
        // Execute the next setup or assertion step for this scenario.
        commandId: crypto.randomUUID(),
        // Execute the next setup or assertion step for this scenario.
        allowDuplicate: true,
        // Seed prerequisite rows so the mutation under test has a realistic baseline.
        duplicateOverrideReason: "e2e my-work pagination fixture",
      });
      // Assert browser/UI outcome matches the scenario intent.
      expect(
        // Execute the next setup or assertion step for this scenario.
        created.status,
        // Execute the next setup or assertion step for this scenario.
        `${prefix}-${i} → ${created.status} ${JSON.stringify(created.body)}`,
      // Execute the next setup or assertion step for this scenario.
      ).toBe(201);
      // id: unique stamp so parallel runs do not collide.
      const id = (created.body as { id: string }).id;
      // Assert response/page reached the expected status.
      expect((await apiPost(token, `/maintenance/tickets/${id}/assign`, { assigneeId: tech.employeeId })).status).toBe(200);
    }
    // Drive the browser through the user-visible workflow step.
    await uiLogin(page, tech.email);
    // Await async work before asserting or releasing locks.
    await openNav(page, /^(Моите задачи|My Work)$/);
    // Bind cards for later setup or assertions in this scope.
    const cards = page.locator("article.mywork-card").filter({ hasText: prefix });
    // Assert UI visibility/state after the user action.
    await expect(cards).toHaveCount(50);
    // Assert UI visibility/state after the user action.
    await expect(page.getByText(`${prefix}-0`, { exact: true })).toHaveCount(0);
    // Bind next for later setup or assertions in this scope.
    const next = page.getByRole("button", { name: /Още ремонти|Load more repairs/ });
    // Await async work before asserting or releasing locks.
    await next.click();
    // Assert UI visibility/state after the user action.
    await expect(cards).toHaveCount(55);
    // Assert UI visibility/state after the user action.
    await expect(next).toHaveCount(0);
    // Repeat/poll to widen the race window or wait for lock waiters.
    for (let i = 0; i < 55; i++) {
      // Assert UI visibility/state after the user action.
      await expect(page.getByText(`${prefix}-${i}`, { exact: true })).toHaveCount(1);
    }
    // Assert browser/UI outcome matches the scenario intent.
    expect(await page.evaluate(async () => {
      // offline: synchronize actors so the race window is observable.
      const offline = await import(/* @vite-ignore */ "/src/offline/index.ts");
      // Return the arranged value/result to the caller.
      return (await offline.loadMyWorkCache())?.tickets.length;
    // Execute the next setup or assertion step for this scenario.
    })).toBe(55);
  // Execute the next setup or assertion step for this scenario.
  } finally {
    // Assert response/page reached the expected status.
    expect((await apiPost(token, `/locations/${room.id}/archive`, {})).status).toBe(200);
  }
});
