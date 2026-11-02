/**
 * Archive location: drops from ops boards; history remains .
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

test.describe("location archive flow", () => {
  test("archive removes room from Rooms; history remains; catalog can show archived", async ({
    page,
  }) => {
    const { token } = await ownerApi();
    const room = await prepareVacantDirtyRoom(token);
    const ticket = await createBlockingTicket(token, room.id);
    const opt = await findActiveIssueOption(token);
    expect(opt.id).toBeTruthy();

    try {
      await uiLogin(page, USERS.owner, DEMO_PASSWORD);
      await openNav(page, /Почистване|Housekeeping/);
      // Catalog is a settings-style tab (role=tab), not a plain button.
      const catalogTab = page.getByRole("tab", { name: /Каталог|Catalog/i });
      await expect(catalogTab).toBeVisible({ timeout: 20_000 });
      await catalogTab.click();

      // Server pagination: search so the fixture room is on the current page.
      const search = page.getByPlaceholder(/Номер \/ сграда|Number \/ building/i);
      await search.fill(room.number);
      const roomCell = page.getByText(room.number, { exact: true });
      await expect(roomCell).toBeVisible({ timeout: 20_000 });

      const row = page.locator("tr").filter({ hasText: room.number });
      await row.getByRole("button", { name: /Архивирай|Archive/i }).click();
      await expect(
        row.getByRole("button", { name: /Възстанови|Restore/i }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(row.getByText(/архивирана|archived/i)).toBeVisible();

      // Rooms board no longer lists it
      await openNav(page, /Стаи|Rooms/);
      await expect(page.getByText(/MAIN|ANNEX|ROYAL|ста|room/i).first()).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByText(room.number, { exact: true })).toHaveCount(0);

      // Ticket history still readable via API
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
      await page
        .getByPlaceholder(/Номер \/ сграда|Number \/ building/i)
        .fill(room.number);
      await expect(page.getByText(room.number, { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      // New cleaning task rejected on archived room
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
    } finally {
      // Restore so later e2e/smoke are not polluted
      await apiPost(token, `/locations/${room.id}/restore`, {});
    }
  });
});
