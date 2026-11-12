/**
 * Permanent Playwright coverage for Repairs keyset pagination / Load more.
 * Seeds exactly 58 open tickets for a dedicated assignee so totals are deterministic.
 */
import { expect, test, type Page } from "@playwright/test";
import { uiLogin, USERS, DEMO_PASSWORD } from "./helpers/auth";
import { openNav } from "./helpers/nav";
import { apiGet, apiPost } from "./helpers/api";
import {
  createDedicatedTechnician,
  ownerApi,
  prepareVacantDirtyRoom,
} from "./helpers/fixtures";

// Shape PageBody documents the fixture/response fields this suite touches.
type PageBody = {
  items: Array<{ id: string; title: string; status: string }>;
  nextCursor: string | null;
  total: number;
};

test.describe.configure({ mode: "serial" });

let techId = "";
let stamp = "";

// Helper seedFiftyEightOpenTickets: arrange fixture data for the case.
async function seedFiftyEightOpenTickets(token: string, assigneeId: string) {
  const room = await prepareVacantDirtyRoom(token);
  const options = await apiGet(token, "/maintenance/issue-options");
  expect(options.status).toBe(200);
  const optionId = (options.body as Array<{ id: string; isActive?: boolean }>).find(
    (o) => o.isActive !== false,
  )?.id;
  expect(optionId, "active issue option").toBeTruthy();

  const runStamp = `PGN58-${Date.now()}`;
  // Repeat/poll to widen the race window or wait for lock waiters.
  for (let i = 0; i < 58; i++) {
    const title = `${runStamp}-${String(i).padStart(2, "0")}`;
    // createdRes: seeded entity required before the mutation under test.
    const createdRes = await apiPost(token, "/maintenance/tickets", {
      locationId: room.id,
      issueOptionId: optionId,
      title,
      blocksRoom: false,
      priority: "normal",
      commandId: crypto.randomUUID(),
      allowDuplicate: true,
      duplicateOverrideReason: "repairs pagination e2e fixture",
    });
    expect(
      createdRes.status,
      `${title} → ${createdRes.status} ${JSON.stringify(createdRes.body)}`,
    ).toBe(201);
    const ticketId = (createdRes.body as { id: string }).id;
    const assign = await apiPost(token, `/maintenance/tickets/${ticketId}/assign`, {
      assigneeId,
    });
    expect(assign.status, `assign ${title}`).toBe(200);
  }

  const verify = await apiGet(
    token,
    `/maintenance/tickets?status=open&assigneeId=${assigneeId}&paginated=1&limit=100`,
  );
  expect(verify.status).toBe(200);
  expect((verify.body as PageBody).total).toBe(58);
  return runStamp;
}

// Local helper selectAssignee used by cases in this file.
async function selectAssignee(page: Page, assigneeId: string) {
  const assignee = page.getByLabel(/Изпълнител|Assignee/);
  await expect(assignee).toBeVisible();
  await assignee.selectOption({ value: assigneeId });
}

// Local helper openRepairsFiltered used by cases in this file.
async function openRepairsFiltered(page: Page) {
  await uiLogin(page, USERS.owner, DEMO_PASSWORD);
  await openNav(page, /Повреди|Repairs/);
  await expect(page.getByRole("heading", { name: /Повреди|Repairs/i })).toBeVisible();
  await page.getByLabel(/Статус|Status/).selectOption("open");
  await selectAssignee(page, techId);
}

// Suite: Repairs pagination.
test.describe("Repairs pagination", () => {
  // Define an individual test case.
  test.beforeAll(async () => {
    const { token } = await ownerApi();
    // tech: seeded entity required before the mutation under test.
    const tech = await createDedicatedTechnician(token);
    techId = tech.employeeId;
    stamp = await seedFiftyEightOpenTickets(token, techId);
  });

  // Case: loads all 58 open tickets for an assignee via Load more.
  test("loads all 58 open tickets for an assignee via Load more", async ({
    page,
  }) => {
    await openRepairsFiltered(page);

    await expect(page.locator(".repairs-count")).toContainText(/50.*58|50 of 58/, {
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: /Зареди още|Load more/i })).toBeVisible();

    await page.getByRole("button", { name: /Зареди още|Load more/i }).click();
    await expect(page.locator(".repairs-count")).toContainText(/58.*58|58 of 58/, {
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: /Зареди още|Load more/i })).toHaveCount(0);

    const titles = await page
      .locator("table.repairs-table tbody tr td:nth-child(2)")
      .allTextContents();
    const matched = titles.filter((t) => t.includes(stamp));
    expect(new Set(matched).size).toBe(58);
    expect(matched).toHaveLength(58);
  });

  // Case: filter change resets loaded pages.
  test("filter change resets loaded pages", async ({ page }) => {
    await openRepairsFiltered(page);
    await expect(page.locator(".repairs-count")).toContainText(/50.*58/, {
      timeout: 20_000,
    });
    await page.getByRole("button", { name: /Зареди още|Load more/i }).click();
    await expect(page.locator(".repairs-count")).toContainText(/58.*58/, {
      timeout: 20_000,
    });

    await page.getByLabel(/Статус|Status/).selectOption("resolved");
    await expect
      // Runner option controlling stability or isolation of the suite.
      .poll(async () => page.locator(".repairs-count").innerText(), { timeout: 20_000 })
      .not.toMatch(/58\s*(?:от|of)\s*58/i);
  });

  // Case: assignee filter updates totals.
  test("assignee filter updates totals", async ({ page }) => {
    await openRepairsFiltered(page);
    await expect(page.locator(".repairs-count")).toContainText(/58/, { timeout: 20_000 });

    await page.getByLabel(/Изпълнител|Assignee/).selectOption("all");
    await expect(page.locator(".repairs-count")).toBeVisible({ timeout: 20_000 });
    const text = await page.locator(".repairs-count").innerText();
    const totalMatch = text.match(/(\d+)\s*(?:от|of)\s*(\d+)/i);
    expect(totalMatch).toBeTruthy();
    expect(Number(totalMatch![2])).toBeGreaterThanOrEqual(58);
  });

  // Case: load-more network failure keeps current rows and allows retry.
  test("load-more network failure keeps current rows and allows retry", async ({
    page,
  }) => {
    await openRepairsFiltered(page);
    await expect(page.locator(".repairs-count")).toContainText(/50.*58/, {
      timeout: 20_000,
    });

    let blocked = true;
    await page.route("**/api/maintenance/tickets?*", async (route) => {
      const url = route.request().url();
      if (blocked && url.includes("cursor=")) {
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    await page.getByRole("button", { name: /Зареди още|Load more/i }).click();
    await expect(page.locator(".banner.error")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".repairs-count")).toContainText(/50.*58/);
    expect(await page.locator("table.repairs-table tbody tr").count()).toBe(50);

    blocked = false;
    await page.getByRole("button", { name: /Зареди още|Load more/i }).click();
    await expect(page.locator(".repairs-count")).toContainText(/58.*58/, {
      timeout: 20_000,
    });
    const titles = await page
      .locator("table.repairs-table tbody tr td:nth-child(2)")
      .allTextContents();
    const matched = titles.filter((t) => t.includes(stamp));
    expect(matched).toHaveLength(58);
    expect(new Set(matched).size).toBe(58);
  });

  // Case: pagination controls remain usable on a mobile viewport.
  test("pagination controls remain usable on a mobile viewport", async ({
    page,
  }) => {
    // Reach Repairs at desktop width, then shrink — exercises mobile layout of
    // the page itself; openNav also covers Menu → sidebar on narrow viewports.
    await openRepairsFiltered(page);
    await expect(page.locator(".repairs-count")).toContainText(/50.*58/, {
      timeout: 20_000,
    });
    await page.setViewportSize({ width: 390, height: 844 });

    const status = page.getByLabel(/Статус|Status/);
    await expect(status).toBeVisible();
    await status.selectOption("open");

    const loadMore = page.getByRole("button", { name: /Зареди още|Load more/i });
    await expect(loadMore).toBeVisible();
    await loadMore.scrollIntoViewIfNeeded();
    await loadMore.focus();
    await expect(loadMore).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator(".repairs-count")).toContainText(/58.*58/, {
      timeout: 20_000,
    });

    // Table may scroll inside .table-wrap; the document itself must not.
    const pageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 2,
    );
    expect(pageOverflow).toBe(false);
  });
});
