/**
 * Room-specific reassignment modal: supervisor reassigns Maria → Elena.
 * Uses isolated fixtures; does not assume MAIN 102 exists.
 */
import { expect, test } from "@playwright/test";
// Import bindings from ./helpers/auth.
import { uiLogin, USERS } from "./helpers/auth";
// Import bindings from ./helpers/api.
import { apiGet, apiLogin, apiPost, apiPut } from "./helpers/api";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  findHousekeeperEmployeeId,
  // Execute the next setup or assertion step for this scenario.
  hotelToday,
  // Execute the next setup or assertion step for this scenario.
  ownerApi,
  // Execute the next setup or assertion step for this scenario.
  prepareVacantDirtyRoom,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "./helpers/fixtures";
// Import bindings from ./helpers/nav.
import { openNav } from "./helpers/nav";

// Local helper findElenaEmployeeId used by cases in this file.
async function findElenaEmployeeId(token: string): Promise<string> {
  // res: HTTP response captured for status/body checks.
  const res = await apiGet(token, "/people");
  // Assert response/page reached the expected status.
  expect(res.status).toBe(200);
  // Bind people for later setup or assertions in this scope.
  const people = res.body as Array<{ employeeId?: string; email?: string }>;
  // Bind elena for later setup or assertions in this scope.
  const elena = people.find(
    // Execute the next setup or assertion step for this scenario.
    (p) => (p.email ?? "").toLowerCase() === USERS.elena.toLowerCase(),
  );
  // Assert browser/UI outcome matches the scenario intent.
  expect(elena?.employeeId, "elena employeeId").toBeTruthy();
  // Return the arranged value/result to the caller.
  return elena!.employeeId!;
}

/** Best-effort: put housekeepers on a full-day roster so availability = available. */
async function ensureOnRoster(
  // Execute the next setup or assertion step for this scenario.
  token: string,
  // Execute the next setup or assertion step for this scenario.
  employeeIds: string[],
  // Execute the next setup or assertion step for this scenario.
  hotelDate: string,
// Execute the next setup or assertion step for this scenario.
): Promise<void> {
  // shifts: HTTP response captured for status/body checks.
  const shifts = await apiGet(token, "/shifts");
  // Guard optional cleanup or alternate assertion paths.
  if (shifts.status !== 200) return;
  // Bind list for later setup or assertions in this scope.
  const list = shifts.body as Array<{
    // Execute the next setup or assertion step for this scenario.
    id: string;
    // Execute the next setup or assertion step for this scenario.
    isActive?: boolean;
    // Execute the next setup or assertion step for this scenario.
    startTime?: string;
    // Execute the next setup or assertion step for this scenario.
    endTime?: string;
  // Execute the next setup or assertion step for this scenario.
  }>;
  // Bind shift for later setup or assertions in this scope.
  let shift =
    // Execute the next setup or assertion step for this scenario.
    list.find((s) => s.isActive !== false && s.startTime === "00:00" && s.endTime === "00:00") ??
    // Execute the next setup or assertion step for this scenario.
    list.find((s) => s.isActive !== false);
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (!shift) {
    // created: seeded entity required before the mutation under test.
    const created = await apiPost(token, "/shifts", {
      // Execute the next setup or assertion step for this scenario.
      code: `E2E-AV-${Date.now().toString(36).slice(-4)}`,
      // Execute the next setup or assertion step for this scenario.
      nameBg: "E2E Availability",
      // Execute the next setup or assertion step for this scenario.
      nameEn: "E2E Availability",
      // Execute the next setup or assertion step for this scenario.
      startTime: "00:00",
      // Execute the next setup or assertion step for this scenario.
      endTime: "00:00",
      // Execute the next setup or assertion step for this scenario.
      sortOrder: 99,
    });
    // Guard optional cleanup or alternate assertion paths.
    if (created.status !== 201 && created.status !== 200) return;
    // Execute the next setup or assertion step for this scenario.
    shift = created.body as { id: string };
  }
  // Iterate to cover variants or wait until a condition holds.
  for (const employeeId of employeeIds) {
    // Await async work before asserting or releasing locks.
    await apiPut(token, `/shifts/roster`, {
      // Execute the next setup or assertion step for this scenario.
      hotelDate,
      // Execute the next setup or assertion step for this scenario.
      employeeId,
      // Execute the next setup or assertion step for this scenario.
      shiftId: shift.id,
    });
  }
}

// Suite: rooms reassign modal.
test.describe("rooms reassign modal", () => {
  // Case: supervisor reassigns isolated room from Maria to Elena.
  test("supervisor reassigns isolated room from Maria to Elena", async ({
    // Execute the next setup or assertion step for this scenario.
    page,
  // Execute the next setup or assertion step for this scenario.
  }) => {
    // Await async work before asserting or releasing locks.
    const { token } = await ownerApi();
    // today: synchronize actors so the race window is observable.
    const today = await hotelToday(token);
    // room: synchronize actors so the race window is observable.
    const room = await prepareVacantDirtyRoom(token);
    // mariaId: unique stamp so parallel runs do not collide.
    const mariaId = await findHousekeeperEmployeeId(token);
    // elenaId: unique stamp so parallel runs do not collide.
    const elenaId = await findElenaEmployeeId(token);

    // Await async work before asserting or releasing locks.
    await ensureOnRoster(token, [mariaId, elenaId], today);

    // taskRes: HTTP response captured for status/body checks.
    const taskRes = await apiPost(token, "/cleaning/tasks", {
      // Execute the next setup or assertion step for this scenario.
      locationId: room.id,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: today,
      // Execute the next setup or assertion step for this scenario.
      priority: "normal",
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: mariaId,
    });
    // Assert browser/UI outcome matches the scenario intent.
    expect(
      // Execute the next setup or assertion step for this scenario.
      taskRes.status,
      // Execute the next setup or assertion step for this scenario.
      `create task → ${taskRes.status} ${JSON.stringify(taskRes.body)}`,
    // Execute the next setup or assertion step for this scenario.
    ).toBe(201);

    // Drive the browser through the user-visible workflow step.
    await uiLogin(page, USERS.supervisor);
    // Await async work before asserting or releasing locks.
    await openNav(page, /Стаи|Rooms/);
    // Assert UI visibility/state after the user action.
    await expect(page.getByText(room.number).first()).toBeVisible({
      // Runner option controlling stability or isolation of the suite.
      timeout: 20_000,
    });

    // Bind row for later setup or assertions in this scope.
    const row = page.locator("tr", { hasText: room.number }).first();
    // Assert UI visibility/state after the user action.
    await expect(row).toBeVisible();
    // Drive the browser through the user-visible workflow step.
    await row.getByRole("button", { name: /Преназначи|Reassign/ }).click();

    // Bind dialog for later setup or assertions in this scope.
    const dialog = page.getByRole("dialog");
    // Assert UI visibility/state after the user action.
    await expect(dialog).toBeVisible();
    // Await async work before asserting or releasing locks.
    await expect(
      // Drive the browser through the user-visible workflow step.
      dialog.getByRole("heading", { name: /Преназначаване|Reassign room/i }),
    // Execute the next setup or assertion step for this scenario.
    ).toBeVisible();

    // Prefer Elena by employee label text from modal list.
    const elenaOption = dialog.locator("label.reassign-hk-option", {
      // Execute the next setup or assertion step for this scenario.
      hasText: /Elena|Петрова|Petrova/i,
    });
    // Assert UI visibility/state after the user action.
    await expect(elenaOption.first()).toBeVisible({ timeout: 15_000 });
    // Await async work before asserting or releasing locks.
    await elenaOption.first().locator('input[type="radio"]').check();

    // Bind override for later setup or assertions in this scope.
    const override = dialog.locator(".reassign-override input[type='checkbox']");
    // Conditional path for setup, cleanup, or alternate outcomes.
    if ((await override.count()) > 0) {
      // Await async work before asserting or releasing locks.
      await override.first().check();
    }

    // Await async work before asserting or releasing locks.
    await dialog.locator("textarea").fill("E2E reassign Maria to Elena");
    // Drive the browser through the user-visible workflow step.
    await dialog.getByRole("button", { name: /Преназначи|Reassign/ }).click();

    // Assert UI visibility/state after the user action.
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    // Assert UI visibility/state after the user action.
    await expect(row.getByText(/Elena Petrova/i).first()).toBeVisible({
      // Runner option controlling stability or isolation of the suite.
      timeout: 15_000,
    });
    // Reason prefix is localized (`преназначаване` / `reassign`).
    await expect(
      // Execute the next setup or assertion step for this scenario.
      row.getByText(
        // Execute the next setup or assertion step for this scenario.
        /(преназначаване|reassign):\s*E2E reassign Maria to Elena/i,
      ),
    // Execute the next setup or assertion step for this scenario.
    ).toBeVisible();

    // Elena owns the task via cleaning tasks API (mine=1).
    const { token: elenaToken } = await apiLogin(USERS.elena);
    // mine: HTTP response captured for status/body checks.
    const mine = await apiGet(
      // Execute the next setup or assertion step for this scenario.
      elenaToken,
      // Execute the next setup or assertion step for this scenario.
      `/cleaning/tasks?mine=1&hotelDate=${encodeURIComponent(today)}`,
    );
    // Assert response/page reached the expected status.
    expect(mine.status).toBe(200);
    // Bind tasks for later setup or assertions in this scope.
    const tasks = mine.body as Array<{
      // Execute the next setup or assertion step for this scenario.
      location?: { number?: string };
      // Execute the next setup or assertion step for this scenario.
      locationId?: string;
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId?: string;
    // Execute the next setup or assertion step for this scenario.
    }>;
    // Bind owned for later setup or assertions in this scope.
    const owned = tasks.some((t) => t.locationId === room.id);
    // Assert browser/UI outcome matches the scenario intent.
    expect(
      // Execute the next setup or assertion step for this scenario.
      owned,
      // Execute the next setup or assertion step for this scenario.
      `Elena should own reassigned task; got ${JSON.stringify(tasks).slice(0, 400)}`,
    // Execute the next setup or assertion step for this scenario.
    ).toBeTruthy();
  });
});
