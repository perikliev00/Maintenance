/**
 * My Work housekeeper shift matrix (roster / null / other shift).
 */
import { expect, test } from "@playwright/test";
import { uiLogin, USERS, DEMO_PASSWORD } from "./helpers/auth";
import { openNav } from "./helpers/nav";
import { apiGet, apiPost, apiPut } from "./helpers/api";
import {
  findHousekeeperEmployeeId,
  hotelToday,
  ownerApi,
  prepareVacantDirtyRoom,
} from "./helpers/fixtures";

const MY_WORK_NAV = /^(Моите задачи|My Work)$/;

test.describe("my-work housekeeper shift", () => {
  test("shows roster + null-shift tasks; hides other shift", async ({ page }) => {
    const { token } = await ownerApi();
    const today = await hotelToday(token);
    const hkId = await findHousekeeperEmployeeId(token);

    const roomA = await prepareVacantDirtyRoom(token);
    const roomB = await prepareVacantDirtyRoom(token);
    const roomC = await prepareVacantDirtyRoom(token);

    const shiftsRes = await apiGet(token, "/shifts");
    expect(shiftsRes.status).toBe(200);
    const shifts = shiftsRes.body as Array<{ id: string; code: string; isActive?: boolean }>;
    const active = shifts.filter((s) => s.isActive !== false);
    expect(active.length).toBeGreaterThanOrEqual(2);
    const shiftM = active[0]!;
    const shiftE = active[1]!;

    await apiPut(token, "/shifts/roster", {
      hotelDate: today,
      entries: [{ employeeId: hkId, shiftId: shiftM.id }],
    });

    const createA = await apiPost(token, "/cleaning/tasks", {
      locationId: roomA.id,
      hotelDate: today,
      assignedEmployeeId: hkId,
      shiftId: shiftM.id,
    });
    expect(createA.status).toBe(201);

    const createB = await apiPost(token, "/cleaning/tasks", {
      locationId: roomB.id,
      hotelDate: today,
      assignedEmployeeId: hkId,
      shiftId: null,
    });
    expect(createB.status).toBe(201);

    const createC = await apiPost(token, "/cleaning/tasks", {
      locationId: roomC.id,
      hotelDate: today,
      assignedEmployeeId: hkId,
      shiftId: shiftE.id,
    });
    expect(createC.status).toBe(201);

    await uiLogin(page, USERS.housekeeper, DEMO_PASSWORD);
    await openNav(page, MY_WORK_NAV);
    await expect(page.getByRole("heading", { name: MY_WORK_NAV })).toBeVisible({
      timeout: 20_000,
    });

    await expect(page.getByText(roomA.number, { exact: false })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(roomB.number, { exact: false })).toBeVisible();
    await expect(page.getByText(roomC.number, { exact: false })).toHaveCount(0);
  });
});
