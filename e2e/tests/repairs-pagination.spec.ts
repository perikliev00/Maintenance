/**
 * Permanent Playwright coverage for Repairs keyset pagination / Load more.
 * Seeds exactly 58 open tickets for a dedicated assignee so totals are deterministic.
 */
import { expect, test, type Page } from "@playwright/test";
// Import bindings from ./helpers/auth.
import { uiLogin, USERS, DEMO_PASSWORD } from "./helpers/auth";
// Import bindings from ./helpers/nav.
import { openNav } from "./helpers/nav";
// Import bindings from ./helpers/api.
import { apiGet, apiPost } from "./helpers/api";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  createDedicatedTechnician,
  // Execute the next setup or assertion step for this scenario.
  ownerApi,
  // Execute the next setup or assertion step for this scenario.
  prepareVacantDirtyRoom,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "./helpers/fixtures";

// Shape PageBody documents the fixture/response fields this suite touches.
type PageBody = {
  // Execute the next setup or assertion step for this scenario.
  items: Array<{ id: string; title: string; status: string }>;
  // Pagination step for list/contract coverage.
  nextCursor: string | null;
  // Execute the next setup or assertion step for this scenario.
  total: number;
};

// Execute the next setup or assertion step for this scenario.
test.describe.configure({ mode: "serial" });

// techId: unique stamp so parallel runs do not collide.
let techId = "";
// stamp: unique stamp so parallel runs do not collide.
let stamp = "";

// Helper seedFiftyEightOpenTickets: arrange fixture data for the case.
async function seedFiftyEightOpenTickets(token: string, assigneeId: string) {
  // room: synchronize actors so the race window is observable.
  const room = await prepareVacantDirtyRoom(token);
  // options: HTTP response captured for status/body checks.
  const options = await apiGet(token, "/maintenance/issue-options");
  // Assert response/page reached the expected status.
  expect(options.status).toBe(200);
  // optionId: unique stamp so parallel runs do not collide.
  const optionId = (options.body as Array<{ id: string; isActive?: boolean }>).find(
    // Execute the next setup or assertion step for this scenario.
    (o) => o.isActive !== false,
  // Execute the next setup or assertion step for this scenario.
  )?.id;
  // Assert browser/UI outcome matches the scenario intent.
  expect(optionId, "active issue option").toBeTruthy();

  // runStamp: unique stamp so parallel runs do not collide.
  const runStamp = `PGN58-${Date.now()}`;
  // Repeat/poll to widen the race window or wait for lock waiters.
  for (let i = 0; i < 58; i++) {
    // Bind title for later setup or assertions in this scope.
    const title = `${runStamp}-${String(i).padStart(2, "0")}`;
    // createdRes: seeded entity required before the mutation under test.
    const createdRes = await apiPost(token, "/maintenance/tickets", {
      // Execute the next setup or assertion step for this scenario.
      locationId: room.id,
      // Execute the next setup or assertion step for this scenario.
      issueOptionId: optionId,
      // Execute the next setup or assertion step for this scenario.
      title,
      // Concurrency/isolation step for the race under test.
      blocksRoom: false,
      // Execute the next setup or assertion step for this scenario.
      priority: "normal",
      // Execute the next setup or assertion step for this scenario.
      commandId: crypto.randomUUID(),
      // Execute the next setup or assertion step for this scenario.
      allowDuplicate: true,
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      duplicateOverrideReason: "repairs pagination e2e fixture",
    });
    // Assert browser/UI outcome matches the scenario intent.
    expect(
      // Execute the next setup or assertion step for this scenario.
      createdRes.status,
      // Execute the next setup or assertion step for this scenario.
      `${title} → ${createdRes.status} ${JSON.stringify(createdRes.body)}`,
    // Execute the next setup or assertion step for this scenario.
    ).toBe(201);
    // ticketId: unique stamp so parallel runs do not collide.
    const ticketId = (createdRes.body as { id: string }).id;
    // assign: HTTP response captured for status/body checks.
    const assign = await apiPost(token, `/maintenance/tickets/${ticketId}/assign`, {
      // Execute the next setup or assertion step for this scenario.
      assigneeId,
    });
    // Assert response/page reached the expected status.
    expect(assign.status, `assign ${title}`).toBe(200);
  }

  // verify: HTTP response captured for status/body checks.
  const verify = await apiGet(
    // Execute the next setup or assertion step for this scenario.
    token,
    // Pagination step for list/contract coverage.
    `/maintenance/tickets?status=open&assigneeId=${assigneeId}&paginated=1&limit=100`,
  );
  // Assert response/page reached the expected status.
  expect(verify.status).toBe(200);
  // Assert response/page reached the expected status.
  expect((verify.body as PageBody).total).toBe(58);
  // Return the arranged value/result to the caller.
  return runStamp;
}

// Local helper selectAssignee used by cases in this file.
async function selectAssignee(page: Page, assigneeId: string) {
  // Bind assignee for later setup or assertions in this scope.
  const assignee = page.getByLabel(/Изпълнител|Assignee/);
  // Assert UI visibility/state after the user action.
  await expect(assignee).toBeVisible();
  // Await async work before asserting or releasing locks.
  await assignee.selectOption({ value: assigneeId });
}

// Local helper openRepairsFiltered used by cases in this file.
async function openRepairsFiltered(page: Page) {
  // Drive the browser through the user-visible workflow step.
  await uiLogin(page, USERS.owner, DEMO_PASSWORD);
  // Await async work before asserting or releasing locks.
  await openNav(page, /Повреди|Repairs/);
  // Assert UI visibility/state after the user action.
  await expect(page.getByRole("heading", { name: /Повреди|Repairs/i })).toBeVisible();
  // Await async work before asserting or releasing locks.
  await page.getByLabel(/Статус|Status/).selectOption("open");
  // Await async work before asserting or releasing locks.
  await selectAssignee(page, techId);
}

// Suite: Repairs pagination.
test.describe("Repairs pagination", () => {
  // Define an individual test case.
  test.beforeAll(async () => {
    // Await async work before asserting or releasing locks.
    const { token } = await ownerApi();
    // tech: seeded entity required before the mutation under test.
    const tech = await createDedicatedTechnician(token);
    // Execute the next setup or assertion step for this scenario.
    techId = tech.employeeId;
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    stamp = await seedFiftyEightOpenTickets(token, techId);
  });

  // Case: loads all 58 open tickets for an assignee via Load more.
  test("loads all 58 open tickets for an assignee via Load more", async ({
    // Execute the next setup or assertion step for this scenario.
    page,
  // Execute the next setup or assertion step for this scenario.
  }) => {
    // Await async work before asserting or releasing locks.
    await openRepairsFiltered(page);

    // Assert browser/UI outcome matches the scenario intent.
    await expect(page.locator(".repairs-count")).toContainText(/50.*58|50 of 58/, {
      // Runner option controlling stability or isolation of the suite.
      timeout: 20_000,
    });
    // Assert UI visibility/state after the user action.
    await expect(page.getByRole("button", { name: /Зареди още|Load more/i })).toBeVisible();

    // Drive the browser through the user-visible workflow step.
    await page.getByRole("button", { name: /Зареди още|Load more/i }).click();
    // Assert browser/UI outcome matches the scenario intent.
    await expect(page.locator(".repairs-count")).toContainText(/58.*58|58 of 58/, {
      // Runner option controlling stability or isolation of the suite.
      timeout: 20_000,
    });
    // Assert UI visibility/state after the user action.
    await expect(page.getByRole("button", { name: /Зареди още|Load more/i })).toHaveCount(0);

    // titles: synchronize actors so the race window is observable.
    const titles = await page
      // Continue the call chain for setup or assertion detail.
      .locator("table.repairs-table tbody tr td:nth-child(2)")
      // Continue the call chain for setup or assertion detail.
      .allTextContents();
    // Bind matched for later setup or assertions in this scope.
    const matched = titles.filter((t) => t.includes(stamp));
    // Assert response/page reached the expected status.
    expect(new Set(matched).size).toBe(58);
    // Assert browser/UI outcome matches the scenario intent.
    expect(matched).toHaveLength(58);
  });

  // Case: filter change resets loaded pages.
  test("filter change resets loaded pages", async ({ page }) => {
    // Await async work before asserting or releasing locks.
    await openRepairsFiltered(page);
    // Assert browser/UI outcome matches the scenario intent.
    await expect(page.locator(".repairs-count")).toContainText(/50.*58/, {
      // Runner option controlling stability or isolation of the suite.
      timeout: 20_000,
    });
    // Drive the browser through the user-visible workflow step.
    await page.getByRole("button", { name: /Зареди още|Load more/i }).click();
    // Assert browser/UI outcome matches the scenario intent.
    await expect(page.locator(".repairs-count")).toContainText(/58.*58/, {
      // Runner option controlling stability or isolation of the suite.
      timeout: 20_000,
    });

    // Await async work before asserting or releasing locks.
    await page.getByLabel(/Статус|Status/).selectOption("resolved");
    // Await async work before asserting or releasing locks.
    await expect
      // Runner option controlling stability or isolation of the suite.
      .poll(async () => page.locator(".repairs-count").innerText(), { timeout: 20_000 })
      // Continue the call chain for setup or assertion detail.
      .not.toMatch(/58\s*(?:от|of)\s*58/i);
  });

  // Case: assignee filter updates totals.
  test("assignee filter updates totals", async ({ page }) => {
    // Await async work before asserting or releasing locks.
    await openRepairsFiltered(page);
    // Assert browser/UI outcome matches the scenario intent.
    await expect(page.locator(".repairs-count")).toContainText(/58/, { timeout: 20_000 });

    // Await async work before asserting or releasing locks.
    await page.getByLabel(/Изпълнител|Assignee/).selectOption("all");
    // Assert UI visibility/state after the user action.
    await expect(page.locator(".repairs-count")).toBeVisible({ timeout: 20_000 });
    // text: synchronize actors so the race window is observable.
    const text = await page.locator(".repairs-count").innerText();
    // Bind totalMatch for later setup or assertions in this scope.
    const totalMatch = text.match(/(\d+)\s*(?:от|of)\s*(\d+)/i);
    // Assert browser/UI outcome matches the scenario intent.
    expect(totalMatch).toBeTruthy();
    // Assert browser/UI outcome matches the scenario intent.
    expect(Number(totalMatch![2])).toBeGreaterThanOrEqual(58);
  });

  // Case: load-more network failure keeps current rows and allows retry.
  test("load-more network failure keeps current rows and allows retry", async ({
    // Execute the next setup or assertion step for this scenario.
    page,
  // Execute the next setup or assertion step for this scenario.
  }) => {
    // Await async work before asserting or releasing locks.
    await openRepairsFiltered(page);
    // Assert browser/UI outcome matches the scenario intent.
    await expect(page.locator(".repairs-count")).toContainText(/50.*58/, {
      // Runner option controlling stability or isolation of the suite.
      timeout: 20_000,
    });

    // Bind blocked for later setup or assertions in this scope.
    let blocked = true;
    // Await async work before asserting or releasing locks.
    await page.route("**/api/maintenance/tickets?*", async (route) => {
      // Bind url for later setup or assertions in this scope.
      const url = route.request().url();
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (blocked && url.includes("cursor=")) {
        // Await async work before asserting or releasing locks.
        await route.abort("failed");
        // Execute the next setup or assertion step for this scenario.
        return;
      }
      // Await async work before asserting or releasing locks.
      await route.continue();
    });

    // Drive the browser through the user-visible workflow step.
    await page.getByRole("button", { name: /Зареди още|Load more/i }).click();
    // Assert UI visibility/state after the user action.
    await expect(page.locator(".banner.error")).toBeVisible({ timeout: 15_000 });
    // Assert browser/UI outcome matches the scenario intent.
    await expect(page.locator(".repairs-count")).toContainText(/50.*58/);
    // Assert response/page reached the expected status.
    expect(await page.locator("table.repairs-table tbody tr").count()).toBe(50);

    // Concurrency/isolation step for the race under test.
    blocked = false;
    // Drive the browser through the user-visible workflow step.
    await page.getByRole("button", { name: /Зареди още|Load more/i }).click();
    // Assert browser/UI outcome matches the scenario intent.
    await expect(page.locator(".repairs-count")).toContainText(/58.*58/, {
      // Runner option controlling stability or isolation of the suite.
      timeout: 20_000,
    });
    // titles: synchronize actors so the race window is observable.
    const titles = await page
      // Continue the call chain for setup or assertion detail.
      .locator("table.repairs-table tbody tr td:nth-child(2)")
      // Continue the call chain for setup or assertion detail.
      .allTextContents();
    // Bind matched for later setup or assertions in this scope.
    const matched = titles.filter((t) => t.includes(stamp));
    // Assert browser/UI outcome matches the scenario intent.
    expect(matched).toHaveLength(58);
    // Assert response/page reached the expected status.
    expect(new Set(matched).size).toBe(58);
  });

  // Case: pagination controls remain usable on a mobile viewport.
  test("pagination controls remain usable on a mobile viewport", async ({
    // Execute the next setup or assertion step for this scenario.
    page,
  // Execute the next setup or assertion step for this scenario.
  }) => {
    // Reach Repairs at desktop width, then shrink — exercises mobile layout of
    // the page itself; openNav also covers Menu → sidebar on narrow viewports.
    await openRepairsFiltered(page);
    // Assert browser/UI outcome matches the scenario intent.
    await expect(page.locator(".repairs-count")).toContainText(/50.*58/, {
      // Runner option controlling stability or isolation of the suite.
      timeout: 20_000,
    });
    // Await async work before asserting or releasing locks.
    await page.setViewportSize({ width: 390, height: 844 });

    // Bind status for later setup or assertions in this scope.
    const status = page.getByLabel(/Статус|Status/);
    // Assert UI visibility/state after the user action.
    await expect(status).toBeVisible();
    // Await async work before asserting or releasing locks.
    await status.selectOption("open");

    // Bind loadMore for later setup or assertions in this scope.
    const loadMore = page.getByRole("button", { name: /Зареди още|Load more/i });
    // Assert UI visibility/state after the user action.
    await expect(loadMore).toBeVisible();
    // Await async work before asserting or releasing locks.
    await loadMore.scrollIntoViewIfNeeded();
    // Await async work before asserting or releasing locks.
    await loadMore.focus();
    // Assert browser/UI outcome matches the scenario intent.
    await expect(loadMore).toBeFocused();
    // Await async work before asserting or releasing locks.
    await page.keyboard.press("Enter");
    // Assert browser/UI outcome matches the scenario intent.
    await expect(page.locator(".repairs-count")).toContainText(/58.*58/, {
      // Runner option controlling stability or isolation of the suite.
      timeout: 20_000,
    });

    // Table may scroll inside .table-wrap; the document itself must not.
    const pageOverflow = await page.evaluate(
      // Execute the next setup or assertion step for this scenario.
      () => document.documentElement.scrollWidth > window.innerWidth + 2,
    );
    // Assert browser/UI outcome matches the scenario intent.
    expect(pageOverflow).toBe(false);
  });
});
