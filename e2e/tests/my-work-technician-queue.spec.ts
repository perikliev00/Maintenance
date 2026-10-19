/**
 * E2E-MW-68 — My Work technician: own open repairs only; no cleaning / foreign / closed.
 */
import { expect, test } from "@playwright/test";
import { uiLogin, USERS, DEMO_PASSWORD } from "./helpers/auth";
import { openNav } from "./helpers/nav";
import { apiPost } from "./helpers/api";
import {
  assignAndStartTicket,
  createBlockingTicket,
  createDedicatedTechnician,
  findHousekeeperEmployeeId,
  findTechnicianEmployeeId,
  hotelToday,
  ownerApi,
  prepareVacantDirtyRoom,
  resolveTicket,
} from "./helpers/fixtures";

const MY_WORK_NAV = /^(Моите задачи|My Work)$/;

test.describe("E2E-MW-68 my-work technician queue", () => {
  test("shows own open ticket; hides foreign, resolved, closed, and cleaning", async ({
    page,
  }) => {
    const { token } = await ownerApi();
    const today = await hotelToday(token);
    const techId = await findTechnicianEmployeeId(token);
    const hkId = await findHousekeeperEmployeeId(token);
    const secondTech = await createDedicatedTechnician(token);
    expect(secondTech.employeeId).toBeTruthy();

    const roomOwn = await prepareVacantDirtyRoom(token);
    const roomForeign = await prepareVacantDirtyRoom(token);
    const roomClean = await prepareVacantDirtyRoom(token);
    const roomResolved = await prepareVacantDirtyRoom(token);
    const roomClosed = await prepareVacantDirtyRoom(token);

    const own = await createBlockingTicket(token, roomOwn.id);
    await apiPost(token, `/maintenance/tickets/${own.id}/assign`, {
      assigneeId: techId,
    });

    const foreign = await createBlockingTicket(token, roomForeign.id);
    const foreignAssign = await apiPost(
      token,
      `/maintenance/tickets/${foreign.id}/assign`,
      { assigneeId: secondTech.employeeId },
    );
    expect(foreignAssign.status).toBe(200);

    const cleaning = await apiPost(token, "/cleaning/tasks", {
      locationId: roomClean.id,
      hotelDate: today,
      assignedEmployeeId: hkId,
    });
    expect(cleaning.status).toBe(201);

    const resolved = await createBlockingTicket(token, roomResolved.id);
    await assignAndStartTicket(token, resolved.id, techId);
    await resolveTicket(token, resolved.id, "e2e-mw-68 resolve");

    const closed = await createBlockingTicket(token, roomClosed.id);
    await assignAndStartTicket(token, closed.id, techId);
    await resolveTicket(token, closed.id, "e2e-mw-68 close prep");
    const closeRes = await apiPost(token, `/maintenance/tickets/${closed.id}/close`, {
      commandId: crypto.randomUUID(),
    });
    expect(
      closeRes.status,
      `close → ${closeRes.status} ${JSON.stringify(closeRes.body)}`,
    ).toBe(200);

    await uiLogin(page, USERS.technician, DEMO_PASSWORD);
    await openNav(page, MY_WORK_NAV);
    await expect(page.getByRole("heading", { name: MY_WORK_NAV })).toBeVisible({
      timeout: 20_000,
    });

    await expect(page.getByText(roomOwn.number, { exact: false })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(roomForeign.number, { exact: false })).toHaveCount(
      0,
    );
    await expect(page.getByText(roomClean.number, { exact: false })).toHaveCount(0);
    await expect(
      page.getByText(roomResolved.number, { exact: false }),
    ).toHaveCount(0);
    await expect(page.getByText(roomClosed.number, { exact: false })).toHaveCount(
      0,
    );
  });
});
