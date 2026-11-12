/**
 * My Work housekeeper shift matrix (roster / null / other shift).
 */
import { expect, test } from "@playwright/test";
// Import bindings from ./helpers/auth.
import { uiLogin, USERS, DEMO_PASSWORD } from "./helpers/auth";
// Import bindings from ./helpers/nav.
import { openNav } from "./helpers/nav";
// Import bindings from ./helpers/api.
import { apiGet, apiPost, apiPut } from "./helpers/api";
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

// Bind MY_WORK_NAV for later setup or assertions in this scope.
const MY_WORK_NAV = /^(Моите задачи|My Work)$/;

// Suite: my-work housekeeper shift.
test.describe("my-work housekeeper shift", () => {
  // Case: shows roster + null-shift tasks; hides other shift.
  test("shows roster + null-shift tasks; hides other shift", async ({ page }) => {
    // Await async work before asserting or releasing locks.
    const { token } = await ownerApi();
    // today: synchronize actors so the race window is observable.
    const today = await hotelToday(token);
    // hkId: unique stamp so parallel runs do not collide.
    const hkId = await findHousekeeperEmployeeId(token);

    // roomA: synchronize actors so the race window is observable.
    const roomA = await prepareVacantDirtyRoom(token);
    // roomB: synchronize actors so the race window is observable.
    const roomB = await prepareVacantDirtyRoom(token);
    // roomC: synchronize actors so the race window is observable.
    const roomC = await prepareVacantDirtyRoom(token);

    // shiftsRes: HTTP response captured for status/body checks.
    const shiftsRes = await apiGet(token, "/shifts");
    // Assert response/page reached the expected status.
    expect(shiftsRes.status).toBe(200);
    // Bind shifts for later setup or assertions in this scope.
    const shifts = shiftsRes.body as Array<{ id: string; code: string; isActive?: boolean }>;
    // Bind active for later setup or assertions in this scope.
    const active = shifts.filter((s) => s.isActive !== false);
    // Assert browser/UI outcome matches the scenario intent.
    expect(active.length).toBeGreaterThanOrEqual(2);
    // Bind shiftM for later setup or assertions in this scope.
    const shiftM = active[0]!;
    // Bind shiftE for later setup or assertions in this scope.
    const shiftE = active[1]!;

    // Await async work before asserting or releasing locks.
    await apiPut(token, "/shifts/roster", {
      // Execute the next setup or assertion step for this scenario.
      hotelDate: today,
      // Execute the next setup or assertion step for this scenario.
      entries: [{ employeeId: hkId, shiftId: shiftM.id }],
    });

    // createA: seeded entity required before the mutation under test.
    const createA = await apiPost(token, "/cleaning/tasks", {
      // Execute the next setup or assertion step for this scenario.
      locationId: roomA.id,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: today,
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: hkId,
      // Execute the next setup or assertion step for this scenario.
      shiftId: shiftM.id,
    });
    // Assert response/page reached the expected status.
    expect(createA.status).toBe(201);

    // createB: seeded entity required before the mutation under test.
    const createB = await apiPost(token, "/cleaning/tasks", {
      // Execute the next setup or assertion step for this scenario.
      locationId: roomB.id,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: today,
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: hkId,
      // Execute the next setup or assertion step for this scenario.
      shiftId: null,
    });
    // Assert response/page reached the expected status.
    expect(createB.status).toBe(201);

    // createC: seeded entity required before the mutation under test.
    const createC = await apiPost(token, "/cleaning/tasks", {
      // Execute the next setup or assertion step for this scenario.
      locationId: roomC.id,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: today,
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: hkId,
      // Execute the next setup or assertion step for this scenario.
      shiftId: shiftE.id,
    });
    // Assert response/page reached the expected status.
    expect(createC.status).toBe(201);

    // Drive the browser through the user-visible workflow step.
    await uiLogin(page, USERS.housekeeper, DEMO_PASSWORD);
    // Await async work before asserting or releasing locks.
    await openNav(page, MY_WORK_NAV);
    // Assert UI visibility/state after the user action.
    await expect(page.getByRole("heading", { name: MY_WORK_NAV })).toBeVisible({
      // Runner option controlling stability or isolation of the suite.
      timeout: 20_000,
    });

    // Assert UI visibility/state after the user action.
    await expect(page.getByText(roomA.number, { exact: false })).toBeVisible({
      // Runner option controlling stability or isolation of the suite.
      timeout: 20_000,
    });
    // Assert UI visibility/state after the user action.
    await expect(page.getByText(roomB.number, { exact: false })).toBeVisible();
    // Assert UI visibility/state after the user action.
    await expect(page.getByText(roomC.number, { exact: false })).toHaveCount(0);
  });
});
