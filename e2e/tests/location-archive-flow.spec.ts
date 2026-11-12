/**
 * Archive location: drops from ops boards; history remains .
 */
import { expect, test } from "@playwright/test";
// Import bindings from ./helpers/auth.
import { uiLogin, USERS, DEMO_PASSWORD } from "./helpers/auth";
// Import bindings from ./helpers/nav.
import { openNav } from "./helpers/nav";
// Import bindings from ./helpers/api.
import { apiGet, apiPost } from "./helpers/api";
// Import module bindings used by this suite.
import {
  // Concurrency/isolation step for the race under test.
  createBlockingTicket,
  // Execute the next setup or assertion step for this scenario.
  findActiveIssueOption,
  // Execute the next setup or assertion step for this scenario.
  ownerApi,
  // Execute the next setup or assertion step for this scenario.
  prepareVacantDirtyRoom,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "./helpers/fixtures";

// Suite: location archive flow.
test.describe("location archive flow", () => {
  // Case: archive removes room from Rooms; history remains; catalog can show archived.
  test("archive removes room from Rooms; history remains; catalog can show archived", async ({
    // Execute the next setup or assertion step for this scenario.
    page,
  // Execute the next setup or assertion step for this scenario.
  }) => {
    // Await async work before asserting or releasing locks.
    const { token } = await ownerApi();
    // room: synchronize actors so the race window is observable.
    const room = await prepareVacantDirtyRoom(token);
    // ticket: seeded entity required before the mutation under test.
    const ticket = await createBlockingTicket(token, room.id);
    // opt: synchronize actors so the race window is observable.
    const opt = await findActiveIssueOption(token);
    // Assert browser/UI outcome matches the scenario intent.
    expect(opt.id).toBeTruthy();

    // Try path where partial failure must not leak suite state.
    try {
      // Drive the browser through the user-visible workflow step.
      await uiLogin(page, USERS.owner, DEMO_PASSWORD);
      // Await async work before asserting or releasing locks.
      await openNav(page, /Почистване|Housekeeping/);
      // Catalog is a settings-style tab (role=tab), not a plain button.
      const catalogTab = page.getByRole("tab", { name: /Каталог|Catalog/i });
      // Assert UI visibility/state after the user action.
      await expect(catalogTab).toBeVisible({ timeout: 20_000 });
      // Await async work before asserting or releasing locks.
      await catalogTab.click();

      // Server pagination: search so the fixture room is on the current page.
      const search = page.getByPlaceholder(/Номер \/ сграда|Number \/ building/i);
      // Await async work before asserting or releasing locks.
      await search.fill(room.number);
      // Bind roomCell for later setup or assertions in this scope.
      const roomCell = page.getByText(room.number, { exact: true });
      // Assert UI visibility/state after the user action.
      await expect(roomCell).toBeVisible({ timeout: 20_000 });

      // Bind row for later setup or assertions in this scope.
      const row = page.locator("tr").filter({ hasText: room.number });
      // Drive the browser through the user-visible workflow step.
      await row.getByRole("button", { name: /Архивирай|Archive/i }).click();
      // Await async work before asserting or releasing locks.
      await expect(
        // Drive the browser through the user-visible workflow step.
        row.getByRole("button", { name: /Възстанови|Restore/i }),
      // Runner option controlling stability or isolation of the suite.
      ).toBeVisible({ timeout: 15_000 });
      // Assert UI visibility/state after the user action.
      await expect(row.getByText(/архивирана|archived/i)).toBeVisible();

      // Rooms board no longer lists it
      await openNav(page, /Стаи|Rooms/);
      // Assert UI visibility/state after the user action.
      await expect(page.getByText(/MAIN|ANNEX|ROYAL|ста|room/i).first()).toBeVisible({
        // Runner option controlling stability or isolation of the suite.
        timeout: 20_000,
      });
      // Assert UI visibility/state after the user action.
      await expect(page.getByText(room.number, { exact: true })).toHaveCount(0);

      // Ticket history still readable via API
      const events = await apiGet(token, `/maintenance/tickets/${ticket.id}/events`);
      // Assert response/page reached the expected status.
      expect(events.status).toBe(200);
      // Bind ev for later setup or assertions in this scope.
      const ev = events.body as unknown[];
      // Assert browser/UI outcome matches the scenario intent.
      expect(ev.length).toBeGreaterThan(0);

      // ticketGet: HTTP response captured for status/body checks.
      const ticketGet = await apiGet(
        // Execute the next setup or assertion step for this scenario.
        token,
        // Pagination step for list/contract coverage.
        `/maintenance/tickets?status=all&locationId=${room.id}&limit=20`,
      );
      // Assert response/page reached the expected status.
      expect(ticketGet.status).toBe(200);

      // Catalog with show archived still sees the room
      await openNav(page, /Почистване|Housekeeping/);
      // Await async work before asserting or releasing locks.
      await catalogTab.click();
      // Bind showArchived for later setup or assertions in this scope.
      const showArchived = page.getByLabel(/Показвай архивирани|Show archived/i);
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (!(await showArchived.isChecked())) {
        // Await async work before asserting or releasing locks.
        await showArchived.check();
      }
      // Await async work before asserting or releasing locks.
      await page
        // Continue the call chain for setup or assertion detail.
        .getByPlaceholder(/Номер \/ сграда|Number \/ building/i)
        // Continue the call chain for setup or assertion detail.
        .fill(room.number);
      // Assert UI visibility/state after the user action.
      await expect(page.getByText(room.number, { exact: true })).toBeVisible({
        // Runner option controlling stability or isolation of the suite.
        timeout: 15_000,
      });

      // New cleaning task rejected on archived room
      const today = new Date().toISOString().slice(0, 10);
      // people: HTTP response captured for status/body checks.
      const people = await apiGet(token, "/people");
      // Bind hk for later setup or assertions in this scope.
      const hk = (people.body as Array<{ email?: string; employeeId?: string }>).find(
        // Execute the next setup or assertion step for this scenario.
        (p) => (p.email ?? "").includes("housekeeper"),
      );
      // createTask: seeded entity required before the mutation under test.
      const createTask = await apiPost(token, "/cleaning/tasks", {
        // Execute the next setup or assertion step for this scenario.
        locationId: room.id,
        // Execute the next setup or assertion step for this scenario.
        hotelDate: today,
        // Execute the next setup or assertion step for this scenario.
        assignedEmployeeId: hk?.employeeId,
      });
      // Assert response/page reached the expected status.
      expect(createTask.status).toBe(400);
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Restore so later e2e/smoke are not polluted
      await apiPost(token, `/locations/${room.id}/restore`, {});
    }
  });
});
