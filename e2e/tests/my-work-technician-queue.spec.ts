/**
 * My Work technician: own open repairs only; no cleaning / foreign / closed.
 */
import { expect, test } from "@playwright/test";
// Import bindings from ./helpers/auth.
import { uiLogin, USERS, DEMO_PASSWORD } from "./helpers/auth";
// Import bindings from ./helpers/nav.
import { openNav } from "./helpers/nav";
// Import bindings from ./helpers/api.
import { apiPost } from "./helpers/api";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  assignAndStartTicket,
  // Concurrency/isolation step for the race under test.
  createBlockingTicket,
  // Execute the next setup or assertion step for this scenario.
  createDedicatedTechnician,
  // Execute the next setup or assertion step for this scenario.
  findHousekeeperEmployeeId,
  // Execute the next setup or assertion step for this scenario.
  findTechnicianEmployeeId,
  // Execute the next setup or assertion step for this scenario.
  hotelToday,
  // Execute the next setup or assertion step for this scenario.
  ownerApi,
  // Execute the next setup or assertion step for this scenario.
  prepareVacantDirtyRoom,
  // Execute the next setup or assertion step for this scenario.
  resolveTicket,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "./helpers/fixtures";

// Bind MY_WORK_NAV for later setup or assertions in this scope.
const MY_WORK_NAV = /^(Моите задачи|My Work)$/;

// Suite: my-work technician queue.
test.describe("my-work technician queue", () => {
  // Case: shows own open ticket; hides foreign, resolved, closed, and cleaning.
  test("shows own open ticket; hides foreign, resolved, closed, and cleaning", async ({
    // Execute the next setup or assertion step for this scenario.
    page,
  // Execute the next setup or assertion step for this scenario.
  }) => {
    // Await async work before asserting or releasing locks.
    const { token } = await ownerApi();
    // today: synchronize actors so the race window is observable.
    const today = await hotelToday(token);
    // techId: unique stamp so parallel runs do not collide.
    const techId = await findTechnicianEmployeeId(token);
    // hkId: unique stamp so parallel runs do not collide.
    const hkId = await findHousekeeperEmployeeId(token);
    // secondTech: seeded entity required before the mutation under test.
    const secondTech = await createDedicatedTechnician(token);
    // Assert browser/UI outcome matches the scenario intent.
    expect(secondTech.employeeId).toBeTruthy();

    // roomOwn: synchronize actors so the race window is observable.
    const roomOwn = await prepareVacantDirtyRoom(token);
    // roomForeign: synchronize actors so the race window is observable.
    const roomForeign = await prepareVacantDirtyRoom(token);
    // roomClean: synchronize actors so the race window is observable.
    const roomClean = await prepareVacantDirtyRoom(token);
    // roomResolved: synchronize actors so the race window is observable.
    const roomResolved = await prepareVacantDirtyRoom(token);
    // roomClosed: synchronize actors so the race window is observable.
    const roomClosed = await prepareVacantDirtyRoom(token);

    // own: seeded entity required before the mutation under test.
    const own = await createBlockingTicket(token, roomOwn.id);
    // Await async work before asserting or releasing locks.
    await apiPost(token, `/maintenance/tickets/${own.id}/assign`, {
      // Execute the next setup or assertion step for this scenario.
      assigneeId: techId,
    });

    // foreign: seeded entity required before the mutation under test.
    const foreign = await createBlockingTicket(token, roomForeign.id);
    // foreignAssign: HTTP response captured for status/body checks.
    const foreignAssign = await apiPost(
      // Execute the next setup or assertion step for this scenario.
      token,
      // Execute the next setup or assertion step for this scenario.
      `/maintenance/tickets/${foreign.id}/assign`,
      // Execute the next setup or assertion step for this scenario.
      { assigneeId: secondTech.employeeId },
    );
    // Assert response/page reached the expected status.
    expect(foreignAssign.status).toBe(200);

    // cleaning: HTTP response captured for status/body checks.
    const cleaning = await apiPost(token, "/cleaning/tasks", {
      // Execute the next setup or assertion step for this scenario.
      locationId: roomClean.id,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: today,
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: hkId,
    });
    // Assert response/page reached the expected status.
    expect(cleaning.status).toBe(201);

    // resolved: seeded entity required before the mutation under test.
    const resolved = await createBlockingTicket(token, roomResolved.id);
    // Await async work before asserting or releasing locks.
    await assignAndStartTicket(token, resolved.id, techId);
    // Await async work before asserting or releasing locks.
    await resolveTicket(token, resolved.id, "e2e-mw-68 resolve");

    // closed: seeded entity required before the mutation under test.
    const closed = await createBlockingTicket(token, roomClosed.id);
    // Await async work before asserting or releasing locks.
    await assignAndStartTicket(token, closed.id, techId);
    // Await async work before asserting or releasing locks.
    await resolveTicket(token, closed.id, "e2e-mw-68 close prep");
    // closeRes: HTTP response captured for status/body checks.
    const closeRes = await apiPost(token, `/maintenance/tickets/${closed.id}/close`, {
      // Execute the next setup or assertion step for this scenario.
      commandId: crypto.randomUUID(),
    });
    // Assert browser/UI outcome matches the scenario intent.
    expect(
      // Execute the next setup or assertion step for this scenario.
      closeRes.status,
      // Execute the next setup or assertion step for this scenario.
      `close → ${closeRes.status} ${JSON.stringify(closeRes.body)}`,
    // Execute the next setup or assertion step for this scenario.
    ).toBe(200);

    // Drive the browser through the user-visible workflow step.
    await uiLogin(page, USERS.technician, DEMO_PASSWORD);
    // Await async work before asserting or releasing locks.
    await openNav(page, MY_WORK_NAV);
    // Assert UI visibility/state after the user action.
    await expect(page.getByRole("heading", { name: MY_WORK_NAV })).toBeVisible({
      // Runner option controlling stability or isolation of the suite.
      timeout: 20_000,
    });

    // Assert UI visibility/state after the user action.
    await expect(page.getByText(roomOwn.number, { exact: false })).toBeVisible({
      // Runner option controlling stability or isolation of the suite.
      timeout: 20_000,
    });
    // Assert UI visibility/state after the user action.
    await expect(page.getByText(roomForeign.number, { exact: false })).toHaveCount(
      0,
    );
    // Assert UI visibility/state after the user action.
    await expect(page.getByText(roomClean.number, { exact: false })).toHaveCount(0);
    // Await async work before asserting or releasing locks.
    await expect(
      // Execute the next setup or assertion step for this scenario.
      page.getByText(roomResolved.number, { exact: false }),
    // Execute the next setup or assertion step for this scenario.
    ).toHaveCount(0);
    // Assert UI visibility/state after the user action.
    await expect(page.getByText(roomClosed.number, { exact: false })).toHaveCount(
      0,
    );
  });
});
