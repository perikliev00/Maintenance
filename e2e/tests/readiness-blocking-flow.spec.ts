/**
 * E2E-01 — Cleaning, inspection, readiness with blocking repair (P1-31/33/34).
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

test.describe("E2E-01 readiness blocking flow", () => {
  test("approve clean with blocker → not_ready; resolve → ready; reopen → not_ready", async ({
    page,
  }) => {
    const { token } = await ownerApi();
    const room = await prepareVacantDirtyRoom(token);
    const hkId = await findHousekeeperEmployeeId(token);
    const techId = await findTechnicianEmployeeId(token);

    const ticket = await createBlockingTicket(token, room.id);
    await assignAndStartTicket(token, ticket.id, techId);
    await createAndStartCleaningTask(token, room.id, hkId);

    // Housekeeper completes via UI
    await uiLogin(page, USERS.housekeeper, DEMO_PASSWORD);
    await openNav(page, /Стаи|Rooms/);
    await expect(page.getByText(room.number, { exact: true }).first()).toBeVisible({
      timeout: 20_000,
    });
    const completeBtn = page.getByRole("button", { name: "Complete" }).first();
    await expect(completeBtn).toBeVisible({ timeout: 20_000 });
    await completeBtn.click();
    await expect(page.getByText(/awaiting_inspection|Approved|Complete/i).first()).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

    // Supervisor approves inspection
    await uiLogin(page, USERS.supervisor, DEMO_PASSWORD);
    await openNav(page, /Стаи|Rooms/);
    await expect(page.getByText(room.number, { exact: true }).first()).toBeVisible({
      timeout: 20_000,
    });
    const approveBtn = page.getByRole("button", { name: "Approve" }).first();
    await expect(approveBtn).toBeVisible({ timeout: 20_000 });
    await approveBtn.click();

    // Assert readiness via API (source of truth) and room row pill when visible
    const afterApprove = await getRoom(token, room.id);
    expect(afterApprove.readiness).toBe("not_ready");
    expect(afterApprove.readinessReasons ?? []).toContain("blocking_issue");
    expect(afterApprove.cleaningStatus).toBe("verified_clean");
    const occ = afterApprove.occupancy;
    const clean = afterApprove.cleaningStatus;
    const roomRow = page.locator("tr, .location-row, article, li").filter({
      hasText: room.number,
    });
    await expect(roomRow.locator(".pill.ready-not_ready").first()).toBeVisible({
      timeout: 20_000,
    });

    // Resolve last blocker (API); assert UI + API
    await resolveTicket(token, ticket.id, "e2e last blocker");
    await page.reload();
    await openNav(page, /Стаи|Rooms/);
    const afterResolve = await getRoom(token, room.id);
    expect(afterResolve.readiness).toBe("ready");
    await expect(
      page
        .locator("tr, .location-row, article, li")
        .filter({ hasText: room.number })
        .locator(".pill.ready-ready")
        .first(),
    ).toBeVisible({ timeout: 20_000 });

    await reopenTicket(token, ticket.id, "e2e reopen blocker");
    await page.reload();
    await openNav(page, /Стаи|Rooms/);
    const afterReopen = await getRoom(token, room.id);
    expect(afterReopen.readiness).toBe("not_ready");
    expect(afterReopen.occupancy).toBe(occ);
    expect(afterReopen.cleaningStatus).toBe(clean);
    await expect(
      page
        .locator("tr, .location-row, article, li")
        .filter({ hasText: room.number })
        .locator(".pill.ready-not_ready")
        .first(),
    ).toBeVisible({ timeout: 20_000 });
  });
});
