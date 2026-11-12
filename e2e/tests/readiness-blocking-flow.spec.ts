/**
 * Cleaning, inspection, readiness with blocking repair .
 */
import { expect, test } from "@playwright/test";
import { uiLogin, USERS, DEMO_PASSWORD } from "./helpers/auth";
import { openNav } from "./helpers/nav";
import {
  assignAndStartTicket,
  createAndStartCleaningTask,
  createBlockingTicket,
  findHousekeeperEmployeeId,
  findTechnicianEmployeeId,
  getRoom,
  ownerApi,
  prepareVacantDirtyRoom,
  reopenTicket,
  resolveTicket,
} from "./helpers/fixtures";

// Suite: readiness blocking flow.
test.describe("readiness blocking flow", () => {
  // Case probes concurrency/isolation: approve clean with blocker → not_ready; resolve → ready; reopen → not_ready.
  test("approve clean with blocker → not_ready; resolve → ready; reopen → not_ready", async ({
    page,
  }) => {
    page.on("dialog", async (dialog) => {
      await dialog.accept(dialog.type() === "prompt" ? "e2e notes" : undefined);
    });

    const { token } = await ownerApi();
    const room = await prepareVacantDirtyRoom(token);
    const hkId = await findHousekeeperEmployeeId(token);
    const techId = await findTechnicianEmployeeId(token);

    // ticket: seeded entity required before the mutation under test.
    const ticket = await createBlockingTicket(token, room.id);
    await assignAndStartTicket(token, ticket.id, techId);
    await createAndStartCleaningTask(token, room.id, hkId);

    // Board labels are "{buildingCode} {number}" (e.g. "ANNEX E2E…"), so match
    // the unique room number as a substring — not exact text of the cell.
    const roomRow = () =>
      page.locator("tr.location-row-clickable, tr").filter({
        hasText: room.number,
      });

    // Housekeeper completes via UI
    await uiLogin(page, USERS.housekeeper, DEMO_PASSWORD);
    await openNav(page, /Стаи|Rooms/);
    await page.getByLabel(/Търсене|Search/).fill(room.number);
    await expect(roomRow()).toBeVisible({ timeout: 20_000 });
    // Board uses publicSettings.interface.locale (typically bg) via boardT.
    const completeBtn = roomRow().getByRole("button", {
      name: /Завърши|Complete/,
    });
    await expect(completeBtn).toBeVisible({ timeout: 20_000 });
    await completeBtn.click();
    // Cleaning status pill (localized label; avoid matching readiness reasons).
    await expect(
      roomRow().locator(".pill.cleaning-pending_inspection"),
    // Runner option controlling stability or isolation of the suite.
    ).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

    // Supervisor approves inspection
    await uiLogin(page, USERS.supervisor, DEMO_PASSWORD);
    await openNav(page, /Стаи|Rooms/);
    await page.getByLabel(/Търсене|Search/).fill(room.number);
    await expect(roomRow()).toBeVisible({ timeout: 20_000 });
    // approveBtn: in-process HTTP server handle for this suite.
    const approveBtn = roomRow().getByRole("button", {
      name: /Одобри|Approve/,
    });
    await expect(approveBtn).toBeVisible({ timeout: 20_000 });
    await approveBtn.click();
    await expect(
      page.getByText(new RegExp(`(Одобрена|Approved).*${room.number}`, "i")),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(roomRow().locator(".pill.cleaning-verified_clean")).toBeVisible({
      timeout: 20_000,
    });

    // Assert readiness via API (source of truth) and room row pill when visible
    const afterApprove = await getRoom(token, room.id);
    expect(afterApprove.readiness).toBe("not_ready");
    expect(afterApprove.readinessReasons ?? []).toContain("blocking_issue");
    expect(afterApprove.cleaningStatus).toBe("verified_clean");
    const occ = afterApprove.occupancy;
    const clean = afterApprove.cleaningStatus;
    await expect(roomRow().locator(".pill.ready-not_ready")).toBeVisible({
      timeout: 20_000,
    });

    // Resolve last blocker (API); assert UI + API
    await resolveTicket(token, ticket.id, "e2e last blocker");
    await page.reload();
    await openNav(page, /Стаи|Rooms/);
    await page.getByLabel(/Търсене|Search/).fill(room.number);
    const afterResolve = await getRoom(token, room.id);
    expect(afterResolve.readiness).toBe("ready");
    await expect(roomRow().locator(".pill.ready-ready")).toBeVisible({
      timeout: 20_000,
    });

    await reopenTicket(token, ticket.id, "e2e reopen blocker");
    await page.reload();
    await openNav(page, /Стаи|Rooms/);
    await page.getByLabel(/Търсене|Search/).fill(room.number);
    const afterReopen = await getRoom(token, room.id);
    expect(afterReopen.readiness).toBe("not_ready");
    expect(afterReopen.occupancy).toBe(occ);
    expect(afterReopen.cleaningStatus).toBe(clean);
    await expect(roomRow().locator(".pill.ready-not_ready")).toBeVisible({
      timeout: 20_000,
    });
  });
});
