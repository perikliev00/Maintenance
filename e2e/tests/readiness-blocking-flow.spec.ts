/**
 * Cleaning, inspection, readiness with blocking repair .
 */
import { expect, test } from "@playwright/test";
// Import bindings from ./helpers/auth.
import { uiLogin, USERS, DEMO_PASSWORD } from "./helpers/auth";
// Import bindings from ./helpers/nav.
import { openNav } from "./helpers/nav";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  assignAndStartTicket,
  // Execute the next setup or assertion step for this scenario.
  createAndStartCleaningTask,
  // Concurrency/isolation step for the race under test.
  createBlockingTicket,
  // Execute the next setup or assertion step for this scenario.
  findHousekeeperEmployeeId,
  // Execute the next setup or assertion step for this scenario.
  findTechnicianEmployeeId,
  // Execute the next setup or assertion step for this scenario.
  getRoom,
  // Execute the next setup or assertion step for this scenario.
  ownerApi,
  // Execute the next setup or assertion step for this scenario.
  prepareVacantDirtyRoom,
  // Execute the next setup or assertion step for this scenario.
  reopenTicket,
  // Execute the next setup or assertion step for this scenario.
  resolveTicket,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "./helpers/fixtures";

// Suite: readiness blocking flow.
test.describe("readiness blocking flow", () => {
  // Case probes concurrency/isolation: approve clean with blocker → not_ready; resolve → ready; reopen → not_ready.
  test("approve clean with blocker → not_ready; resolve → ready; reopen → not_ready", async ({
    // Execute the next setup or assertion step for this scenario.
    page,
  // Execute the next setup or assertion step for this scenario.
  }) => {
    // Execute the next setup or assertion step for this scenario.
    page.on("dialog", async (dialog) => {
      // Await async work before asserting or releasing locks.
      await dialog.accept(dialog.type() === "prompt" ? "e2e notes" : undefined);
    });

    // Await async work before asserting or releasing locks.
    const { token } = await ownerApi();
    // room: synchronize actors so the race window is observable.
    const room = await prepareVacantDirtyRoom(token);
    // hkId: unique stamp so parallel runs do not collide.
    const hkId = await findHousekeeperEmployeeId(token);
    // techId: unique stamp so parallel runs do not collide.
    const techId = await findTechnicianEmployeeId(token);

    // ticket: seeded entity required before the mutation under test.
    const ticket = await createBlockingTicket(token, room.id);
    // Await async work before asserting or releasing locks.
    await assignAndStartTicket(token, ticket.id, techId);
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    await createAndStartCleaningTask(token, room.id, hkId);

    // Board labels are "{buildingCode} {number}" (e.g. "ANNEX E2E…"), so match
    // the unique room number as a substring — not exact text of the cell.
    const roomRow = () =>
      // Execute the next setup or assertion step for this scenario.
      page.locator("tr.location-row-clickable, tr").filter({
        // Execute the next setup or assertion step for this scenario.
        hasText: room.number,
      });

    // Housekeeper completes via UI
    await uiLogin(page, USERS.housekeeper, DEMO_PASSWORD);
    // Await async work before asserting or releasing locks.
    await openNav(page, /Стаи|Rooms/);
    // Await async work before asserting or releasing locks.
    await page.getByLabel(/Търсене|Search/).fill(room.number);
    // Assert UI visibility/state after the user action.
    await expect(roomRow()).toBeVisible({ timeout: 20_000 });
    // Board uses publicSettings.interface.locale (typically bg) via boardT.
    const completeBtn = roomRow().getByRole("button", {
      // Fixture field name for the seeded actor/entity.
      name: /Завърши|Complete/,
    });
    // Assert UI visibility/state after the user action.
    await expect(completeBtn).toBeVisible({ timeout: 20_000 });
    // Await async work before asserting or releasing locks.
    await completeBtn.click();
    // Cleaning status pill (localized label; avoid matching readiness reasons).
    await expect(
      // Execute the next setup or assertion step for this scenario.
      roomRow().locator(".pill.cleaning-pending_inspection"),
    // Runner option controlling stability or isolation of the suite.
    ).toBeVisible({ timeout: 15_000 });

    // Drive the browser through the user-visible workflow step.
    await page.getByRole("button", { name: "Log out" }).click();
    // Assert UI visibility/state after the user action.
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

    // Supervisor approves inspection
    await uiLogin(page, USERS.supervisor, DEMO_PASSWORD);
    // Await async work before asserting or releasing locks.
    await openNav(page, /Стаи|Rooms/);
    // Await async work before asserting or releasing locks.
    await page.getByLabel(/Търсене|Search/).fill(room.number);
    // Assert UI visibility/state after the user action.
    await expect(roomRow()).toBeVisible({ timeout: 20_000 });
    // approveBtn: in-process HTTP server handle for this suite.
    const approveBtn = roomRow().getByRole("button", {
      // Fixture field name for the seeded actor/entity.
      name: /Одобри|Approve/,
    });
    // Assert UI visibility/state after the user action.
    await expect(approveBtn).toBeVisible({ timeout: 20_000 });
    // Await async work before asserting or releasing locks.
    await approveBtn.click();
    // Await async work before asserting or releasing locks.
    await expect(
      // Execute the next setup or assertion step for this scenario.
      page.getByText(new RegExp(`(Одобрена|Approved).*${room.number}`, "i")),
    // Execute the next setup or assertion step for this scenario.
    ).toBeVisible({
      // Runner option controlling stability or isolation of the suite.
      timeout: 15_000,
    });
    // Assert UI visibility/state after the user action.
    await expect(roomRow().locator(".pill.cleaning-verified_clean")).toBeVisible({
      // Runner option controlling stability or isolation of the suite.
      timeout: 20_000,
    });

    // Assert readiness via API (source of truth) and room row pill when visible
    const afterApprove = await getRoom(token, room.id);
    // Assert browser/UI outcome matches the scenario intent.
    expect(afterApprove.readiness).toBe("not_ready");
    // Assert browser/UI outcome matches the scenario intent.
    expect(afterApprove.readinessReasons ?? []).toContain("blocking_issue");
    // Assert browser/UI outcome matches the scenario intent.
    expect(afterApprove.cleaningStatus).toBe("verified_clean");
    // Bind occ for later setup or assertions in this scope.
    const occ = afterApprove.occupancy;
    // Bind clean for later setup or assertions in this scope.
    const clean = afterApprove.cleaningStatus;
    // Assert UI visibility/state after the user action.
    await expect(roomRow().locator(".pill.ready-not_ready")).toBeVisible({
      // Runner option controlling stability or isolation of the suite.
      timeout: 20_000,
    });

    // Resolve last blocker (API); assert UI + API
    await resolveTicket(token, ticket.id, "e2e last blocker");
    // Await async work before asserting or releasing locks.
    await page.reload();
    // Await async work before asserting or releasing locks.
    await openNav(page, /Стаи|Rooms/);
    // Await async work before asserting or releasing locks.
    await page.getByLabel(/Търсене|Search/).fill(room.number);
    // afterResolve: HTTP response captured for status/body checks.
    const afterResolve = await getRoom(token, room.id);
    // Assert browser/UI outcome matches the scenario intent.
    expect(afterResolve.readiness).toBe("ready");
    // Assert UI visibility/state after the user action.
    await expect(roomRow().locator(".pill.ready-ready")).toBeVisible({
      // Runner option controlling stability or isolation of the suite.
      timeout: 20_000,
    });

    // Await async work before asserting or releasing locks.
    await reopenTicket(token, ticket.id, "e2e reopen blocker");
    // Await async work before asserting or releasing locks.
    await page.reload();
    // Await async work before asserting or releasing locks.
    await openNav(page, /Стаи|Rooms/);
    // Await async work before asserting or releasing locks.
    await page.getByLabel(/Търсене|Search/).fill(room.number);
    // afterReopen: HTTP response captured for status/body checks.
    const afterReopen = await getRoom(token, room.id);
    // Assert browser/UI outcome matches the scenario intent.
    expect(afterReopen.readiness).toBe("not_ready");
    // Assert browser/UI outcome matches the scenario intent.
    expect(afterReopen.occupancy).toBe(occ);
    // Assert browser/UI outcome matches the scenario intent.
    expect(afterReopen.cleaningStatus).toBe(clean);
    // Assert UI visibility/state after the user action.
    await expect(roomRow().locator(".pill.ready-not_ready")).toBeVisible({
      // Runner option controlling stability or isolation of the suite.
      timeout: 20_000,
    });
  });
});
