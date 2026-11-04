import { expect, test } from "@playwright/test";
import { uiLogin } from "../helpers/auth";
import { openNav } from "../helpers/nav";
import { apiPost } from "../helpers/api";
import { createDedicatedTechnician, findActiveIssueOption, ownerApi, prepareVacantDirtyRoom } from "../helpers/fixtures";

test("real My Work loads repairs beyond the first 50 without duplicate cards", async ({ page }) => {
  const { token } = await ownerApi();
  const tech = await createDedicatedTechnician(token);
  const room = await prepareVacantDirtyRoom(token);
  const option = await findActiveIssueOption(token);
  const prefix = `PAGE-${crypto.randomUUID()}`;
  // Cleanup must run even when setup fails mid-loop (duplicate prevention / assign).
  try {
    for (let i = 0; i < 55; i++) {
      // Same room+option is exact duplicate identity; allowDuplicate keeps prevention
      // armed for non-override creates while this fixture seeds a paging volume.
      const created = await apiPost(token, "/maintenance/tickets", {
        locationId: room.id,
        issueOptionId: option.id,
        blocksRoom: false,
        title: `${prefix}-${i}`,
        commandId: crypto.randomUUID(),
        allowDuplicate: true,
        duplicateOverrideReason: "e2e my-work pagination fixture",
      });
      expect(
        created.status,
        `${prefix}-${i} → ${created.status} ${JSON.stringify(created.body)}`,
      ).toBe(201);
      const id = (created.body as { id: string }).id;
      expect((await apiPost(token, `/maintenance/tickets/${id}/assign`, { assigneeId: tech.employeeId })).status).toBe(200);
    }
    await uiLogin(page, tech.email);
    await openNav(page, /^(Моите задачи|My Work)$/);
    const cards = page.locator("article.mywork-card").filter({ hasText: prefix });
    await expect(cards).toHaveCount(50);
    await expect(page.getByText(`${prefix}-0`, { exact: true })).toHaveCount(0);
    const next = page.getByRole("button", { name: /Още ремонти|Load more repairs/ });
    await next.click();
    await expect(cards).toHaveCount(55);
    await expect(next).toHaveCount(0);
    for (let i = 0; i < 55; i++) {
      await expect(page.getByText(`${prefix}-${i}`, { exact: true })).toHaveCount(1);
    }
    expect(await page.evaluate(async () => {
      const offline = await import(/* @vite-ignore */ "/src/offline/index.ts");
      return (await offline.loadMyWorkCache())?.tickets.length;
    })).toBe(55);
  } finally {
    expect((await apiPost(token, `/locations/${room.id}/archive`, {})).status).toBe(200);
  }
});
