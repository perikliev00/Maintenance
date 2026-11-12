/**
 * MA-03 — editing day B preserves its other assignments when day A loads late.
 * Holds the real GET for day A, switches to B, delivers A late, edits one B row, saves.
 */
import { expect, test } from "@playwright/test";
// Import bindings from ../helpers/api.
import { apiGet, apiLogin, apiPut } from "../helpers/api";
// Import bindings from ../helpers/auth.
import { DEMO_PASSWORD, USERS, uiLogin } from "../helpers/auth";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  findHousekeeperEmployeeId,
  // Execute the next setup or assertion step for this scenario.
  hotelToday,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "../helpers/fixtures";
// Import bindings from ../helpers/nav.
import { openNav } from "../helpers/nav";

// Local helper ymdOffset used by cases in this file.
function ymdOffset(base: string, days: number): string {
  // Bind d for later setup or assertions in this scope.
  const d = new Date(`${base}T00:00:00.000Z`);
  // Execute the next setup or assertion step for this scenario.
  d.setUTCDate(d.getUTCDate() + days);
  // Return the arranged value/result to the caller.
  return d.toISOString().slice(0, 10);
}

// Suite: MA-03 shift roster stale load.
test.describe("MA-03 shift roster stale load", () => {
  // Case: editing day B preserves untouched assignments when day A loads late.
  test("editing day B preserves untouched assignments when day A loads late", async ({
    // Execute the next setup or assertion step for this scenario.
    page,
  // Execute the next setup or assertion step for this scenario.
  }) => {
    // Await async work before asserting or releasing locks.
    const { token } = await apiLogin(USERS.manager, DEMO_PASSWORD);
    // shiftsRes: HTTP response captured for status/body checks.
    const shiftsRes = await apiGet(token, "/shifts");
    // Assert response/page reached the expected status.
    expect(shiftsRes.status).toBe(200);
    // Bind shifts for later setup or assertions in this scope.
    const shifts = (
      // Execute the next setup or assertion step for this scenario.
      shiftsRes.body as Array<{ id: string; isActive?: boolean }>
    // Execute the next setup or assertion step for this scenario.
    ).filter((s) => s.isActive !== false);
    // Assert browser/UI outcome matches the scenario intent.
    expect(shifts.length).toBeGreaterThanOrEqual(2);
    // Bind shiftA for later setup or assertions in this scope.
    const shiftA = shifts[0]!.id;
    // Bind shiftB for later setup or assertions in this scope.
    const shiftB = shifts[1]!.id;

    // peopleRes: HTTP response captured for status/body checks.
    const peopleRes = await apiGet(token, "/people");
    // Assert response/page reached the expected status.
    expect(peopleRes.status).toBe(200);
    // Bind people for later setup or assertions in this scope.
    const people = peopleRes.body as Array<{
      // Execute the next setup or assertion step for this scenario.
      employeeId?: string;
      // Execute the next setup or assertion step for this scenario.
      role?: string;
      // Execute the next setup or assertion step for this scenario.
      email?: string;
    // Execute the next setup or assertion step for this scenario.
    }>;
    // Bind housekeepers for later setup or assertions in this scope.
    const housekeepers = people.filter(
      // Execute the next setup or assertion step for this scenario.
      (p) => p.role === "housekeeper" && p.employeeId,
    );
    // Assert browser/UI outcome matches the scenario intent.
    expect(housekeepers.length).toBeGreaterThanOrEqual(2);
    // Bind empEdit for later setup or assertions in this scope.
    const empEdit = housekeepers[0]!.employeeId!;
    // Bind empKeep for later setup or assertions in this scope.
    const empKeep =
      // Execute the next setup or assertion step for this scenario.
      housekeepers.find((p) => p.employeeId !== empEdit)?.employeeId ??
      // Await async work before asserting or releasing locks.
      (await findHousekeeperEmployeeId(token));
    // Assert browser/UI outcome matches the scenario intent.
    expect(empKeep).toBeTruthy();
    // Assert browser/UI outcome matches the scenario intent.
    expect(empEdit).not.toBe(empKeep);

    // today: synchronize actors so the race window is observable.
    const today = await hotelToday(token);
    // Bind dayA for later setup or assertions in this scope.
    const dayA = ymdOffset(today, 14);
    // Bind dayB for later setup or assertions in this scope.
    const dayB = ymdOffset(today, 15);

    // Assert browser/UI outcome matches the scenario intent.
    expect(
      (
        // Await async work before asserting or releasing locks.
        await apiPut(token, "/shifts/roster", {
          // Execute the next setup or assertion step for this scenario.
          hotelDate: dayA,
          // Execute the next setup or assertion step for this scenario.
          entries: [
            // Execute the next setup or assertion step for this scenario.
            { employeeId: empEdit, shiftId: shiftA },
            // Execute the next setup or assertion step for this scenario.
            { employeeId: empKeep, shiftId: shiftA },
          ],
        })
      // Execute the next setup or assertion step for this scenario.
      ).status,
    // Execute the next setup or assertion step for this scenario.
    ).toBe(200);
    // Assert browser/UI outcome matches the scenario intent.
    expect(
      (
        // Await async work before asserting or releasing locks.
        await apiPut(token, "/shifts/roster", {
          // Execute the next setup or assertion step for this scenario.
          hotelDate: dayB,
          // Execute the next setup or assertion step for this scenario.
          entries: [
            // Execute the next setup or assertion step for this scenario.
            { employeeId: empEdit, shiftId: shiftA },
            // Execute the next setup or assertion step for this scenario.
            { employeeId: empKeep, shiftId: shiftB },
          ],
        })
      // Execute the next setup or assertion step for this scenario.
      ).status,
    // Execute the next setup or assertion step for this scenario.
    ).toBe(200);

    // Execute the next setup or assertion step for this scenario.
    let releaseA!: () => void;
    // Bind gateA for later setup or assertions in this scope.
    const gateA = new Promise<void>((resolve) => {
      // Execute the next setup or assertion step for this scenario.
      releaseA = resolve;
    });
    // Bind sawDayB for later setup or assertions in this scope.
    let sawDayB = false;

    // Await async work before asserting or releasing locks.
    await page.route("**/api/shifts/roster**", async (route) => {
      // Bind url for later setup or assertions in this scope.
      const url = new URL(route.request().url());
      // Bind hotelDate for later setup or assertions in this scope.
      const hotelDate = url.searchParams.get("hotelDate");
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (route.request().method() !== "GET") {
        // Return the arranged value/result to the caller.
        return route.continue();
      }
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (hotelDate === dayA) {
        // response: HTTP response captured for status/body checks.
        const response = await route.fetch();
        // Await async work before asserting or releasing locks.
        await gateA;
        // Return the arranged value/result to the caller.
        return route.fulfill({ response });
      }
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (hotelDate === dayB) {
        // Execute the next setup or assertion step for this scenario.
        sawDayB = true;
      }
      // Return the arranged value/result to the caller.
      return route.continue();
    });

    // Drive the browser through the user-visible workflow step.
    await uiLogin(page, USERS.manager, DEMO_PASSWORD);
    // Await async work before asserting or releasing locks.
    await openNav(page, /Почистване|Housekeeping/);
    // Drive the browser through the user-visible workflow step.
    await page.getByRole("tab", { name: /Смени|Shifts/i }).click();

    // Bind dateInput for later setup or assertions in this scope.
    const dateInput = page.locator(".roster-block input[type='date']");
    // Assert UI visibility/state after the user action.
    await expect(dateInput).toBeVisible({ timeout: 20_000 });
    // Await async work before asserting or releasing locks.
    await dateInput.fill(dayA);
    // Await async work before asserting or releasing locks.
    await dateInput.fill(dayB);

    // Await async work before asserting or releasing locks.
    await expect.poll(() => sawDayB, { timeout: 15_000 }).toBe(true);
    // Await async work before asserting or releasing locks.
    await expect
      // Continue the call chain for setup or assertion detail.
      .poll(async () => {
        // values: synchronize actors so the race window is observable.
        const values = await page
          // Continue the call chain for setup or assertion detail.
          .locator(".roster-block tbody select")
          // Continue the call chain for setup or assertion detail.
          .evaluateAll((nodes) =>
            // Execute the next setup or assertion step for this scenario.
            nodes.map((n) => (n as HTMLSelectElement).value),
          );
        // Return the arranged value/result to the caller.
        return values.includes(shiftB);
      // Runner option controlling stability or isolation of the suite.
      }, { timeout: 15_000 })
      // Chained expectation refining the UI/API assertion.
      .toBe(true);

    // Late day-A response must not clobber day-B draft.
    releaseA();
    // Await async work before asserting or releasing locks.
    await page.waitForTimeout(400);

    // Bind selects for later setup or assertions in this scope.
    const selects = page.locator(".roster-block tbody select");
    // count: synchronize actors so the race window is observable.
    const count = await selects.count();
    // Assert browser/UI outcome matches the scenario intent.
    expect(count).toBeGreaterThanOrEqual(2);

    // Bind edited for later setup or assertions in this scope.
    let edited = false;
    // Repeat/poll to widen the race window or wait for lock waiters.
    for (let i = 0; i < count; i++) {
      // Bind select for later setup or assertions in this scope.
      const select = selects.nth(i);
      // Conditional path for setup, cleanup, or alternate outcomes.
      if ((await select.inputValue()) === shiftA) {
        // Await async work before asserting or releasing locks.
        await select.selectOption(shiftB);
        // Execute the next setup or assertion step for this scenario.
        edited = true;
        // Execute the next setup or assertion step for this scenario.
        break;
      }
    }
    // Assert browser/UI outcome matches the scenario intent.
    expect(edited).toBe(true);

    // Await async work before asserting or releasing locks.
    await page
      // Drive the browser through the user-visible workflow step.
      .getByRole("button", { name: /Запази ростер|Save roster/i })
      // Continue the call chain for setup or assertion detail.
      .click();
    // Await async work before asserting or releasing locks.
    await expect(
      // Execute the next setup or assertion step for this scenario.
      page.getByText(
        // Execute the next setup or assertion step for this scenario.
        new RegExp(`Ростерът за ${dayB}|Roster for ${dayB}`, "i"),
      ),
    // Runner option controlling stability or isolation of the suite.
    ).toBeVisible({ timeout: 15_000 });

    // saved: HTTP response captured for status/body checks.
    const saved = await apiGet(token, `/shifts/roster?hotelDate=${dayB}`);
    // Assert response/page reached the expected status.
    expect(saved.status).toBe(200);
    // Bind entries for later setup or assertions in this scope.
    const entries = (
      // Execute the next setup or assertion step for this scenario.
      saved.body as {
        // Execute the next setup or assertion step for this scenario.
        entries: Array<{ employee: { id: string }; shift: { id: string } }>;
      }
    // Execute the next setup or assertion step for this scenario.
    ).entries;
    // Bind byEmp for later setup or assertions in this scope.
    const byEmp = new Map(entries.map((e) => [e.employee.id, e.shift.id]));
    // Assert browser/UI outcome matches the scenario intent.
    expect(byEmp.get(empEdit)).toBe(shiftB);
    // Assert browser/UI outcome matches the scenario intent.
    expect(byEmp.get(empKeep)).toBe(shiftB);
  });
});
