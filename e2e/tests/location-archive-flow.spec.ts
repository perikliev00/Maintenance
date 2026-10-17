/**
 * E2E-03 — Archive location: drops from ops boards; history remains (P1-35).
 */
import { expect, test } from "@playwright/test";
import { uiLogin, USERS, DEMO_PASSWORD } from "./helpers/auth";
import { openNav } from "./helpers/nav";
import { apiGet, apiPost } from "./helpers/api";
import {
  createBlockingTicket,
  findActiveIssueOption,
  ownerApi,
  prepareVacantDirtyRoom,
} from "./helpers/fixtures";

test.describe("E2E-03 location archive flow", () => {
  test("archive removes room from Rooms; history remains; catalog can show archived", async ({
    page,
  }) => {
    const { token } = await ownerApi();
    const room = await prepareVacantDirtyRoom(token);
    const ticket = await createBlockingTicket(token, room.id);
    const opt = await findActiveIssueOption(token);
    expect(opt.id).toBeTruthy();

    await uiLogin(page, USERS.owner, DEMO_PASSWORD);
    await openNav(page, /Почистване|Housekeeping/);
    // Catalog tab
    const catalogTab = page.getByRole("button", { name: /Каталог|Catalog/i });
    await expect(catalogTab).toBeVisible({ timeout: 20_000 });
    await catalogTab.click();

    await expect(page.getByText(room.number, { exact: true }).first()).toBeVisible({
      timeout: 20_000,
    });

    // Archive the room row
    const row = page.locator("tr").filter({ hasText: room.number }).first();
    await row.getByRole("button", { name: /Архивирай|Archive/i }).click();
    await expect(
      row.getByText(/архивирана|archived/i).or(
        page.getByRole("button", { name: /Възстанови|Restore/i }),
      ),
    ).toBeVisible({ timeout: 15_000 });

    // Rooms board no longer lists it
    await openNav(page, /Стаи|Rooms/);
    await expect(page.getByText(/MAIN|ANNEX|ROYAL|ста|room/i).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(room.number, { exact: true })).toHaveCount(0);

    // Ticket history still readable via API / Repairs
    const events = await apiGet(token, `/maintenance/tickets/${ticket.id}/events`);
    expect(events.status).toBe(200);
    const ev = events.body as unknown[];
    expect(ev.length).toBeGreaterThan(0);

    const ticketGet = await apiGet(
      token,
      `/maintenance/tickets?status=all&locationId=${room.id}&limit=20`,
    );
    expect(ticketGet.status).toBe(200);

    // Catalog with show archived still sees the room
    await openNav(page, /Почистване|Housekeeping/);
    await catalogTab.click();
    const showArchived = page.getByLabel(/Показвай архивирани|Show archived/i);
    if (!(await showArchived.isChecked())) {
      await showArchived.check();
    }
    await expect(page.getByText(room.number, { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });

    // New cleaning task rejected
    const today = new Date().toISOString().slice(0, 10);
    const people = await apiGet(token, "/people");
    const hk = (people.body as Array<{ email?: string; employeeId?: string }>).find(
      (p) => (p.email ?? "").includes("housekeeper"),
    );
    const createTask = await apiPost(token, "/cleaning/tasks", {
      locationId: room.id,
      hotelDate: today,
      assignedEmployeeId: hk?.employeeId,
    });
    expect(createTask.status).toBe(400);

    // Restore so later e2e/smoke are not polluted
    await apiPost(token, `/locations/${room.id}/restore`, {});
  });
});
