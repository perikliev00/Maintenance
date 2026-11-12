/**
 * MA-03 — editing day B preserves its other assignments when day A loads late.
 * Holds the real GET for day A, switches to B, delivers A late, edits one B row, saves.
 */
import { expect, test } from "@playwright/test";
import { apiGet, apiLogin, apiPut } from "../helpers/api";
import { DEMO_PASSWORD, USERS, uiLogin } from "../helpers/auth";
import {
  findHousekeeperEmployeeId,
  hotelToday,
} from "../helpers/fixtures";
import { openNav } from "../helpers/nav";

// Local helper ymdOffset used by cases in this file.
function ymdOffset(base: string, days: number): string {
  const d = new Date(`${base}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Suite: MA-03 shift roster stale load.
test.describe("MA-03 shift roster stale load", () => {
  // Case: editing day B preserves untouched assignments when day A loads late.
  test("editing day B preserves untouched assignments when day A loads late", async ({
    page,
  }) => {
    const { token } = await apiLogin(USERS.manager, DEMO_PASSWORD);
    const shiftsRes = await apiGet(token, "/shifts");
    expect(shiftsRes.status).toBe(200);
    const shifts = (
      shiftsRes.body as Array<{ id: string; isActive?: boolean }>
    ).filter((s) => s.isActive !== false);
    expect(shifts.length).toBeGreaterThanOrEqual(2);
    const shiftA = shifts[0]!.id;
    const shiftB = shifts[1]!.id;

    const peopleRes = await apiGet(token, "/people");
    expect(peopleRes.status).toBe(200);
    const people = peopleRes.body as Array<{
      employeeId?: string;
      role?: string;
      email?: string;
    }>;
    const housekeepers = people.filter(
      (p) => p.role === "housekeeper" && p.employeeId,
    );
    expect(housekeepers.length).toBeGreaterThanOrEqual(2);
    const empEdit = housekeepers[0]!.employeeId!;
    const empKeep =
      housekeepers.find((p) => p.employeeId !== empEdit)?.employeeId ??
      (await findHousekeeperEmployeeId(token));
    expect(empKeep).toBeTruthy();
    expect(empEdit).not.toBe(empKeep);

    const today = await hotelToday(token);
    const dayA = ymdOffset(today, 14);
    const dayB = ymdOffset(today, 15);

    expect(
      (
        await apiPut(token, "/shifts/roster", {
          hotelDate: dayA,
          entries: [
            { employeeId: empEdit, shiftId: shiftA },
            { employeeId: empKeep, shiftId: shiftA },
          ],
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await apiPut(token, "/shifts/roster", {
          hotelDate: dayB,
          entries: [
            { employeeId: empEdit, shiftId: shiftA },
            { employeeId: empKeep, shiftId: shiftB },
          ],
        })
      ).status,
    ).toBe(200);

    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    let sawDayB = false;

    await page.route("**/api/shifts/roster**", async (route) => {
      const url = new URL(route.request().url());
      const hotelDate = url.searchParams.get("hotelDate");
      if (route.request().method() !== "GET") {
        return route.continue();
      }
      if (hotelDate === dayA) {
        const response = await route.fetch();
        await gateA;
        return route.fulfill({ response });
      }
      if (hotelDate === dayB) {
        sawDayB = true;
      }
      return route.continue();
    });

    await uiLogin(page, USERS.manager, DEMO_PASSWORD);
    await openNav(page, /Почистване|Housekeeping/);
    await page.getByRole("tab", { name: /Смени|Shifts/i }).click();

    const dateInput = page.locator(".roster-block input[type='date']");
    await expect(dateInput).toBeVisible({ timeout: 20_000 });
    await dateInput.fill(dayA);
    await dateInput.fill(dayB);

    await expect.poll(() => sawDayB, { timeout: 15_000 }).toBe(true);
    await expect
      .poll(async () => {
        const values = await page
          .locator(".roster-block tbody select")
          .evaluateAll((nodes) =>
            nodes.map((n) => (n as HTMLSelectElement).value),
          );
        return values.includes(shiftB);
      // Runner option controlling stability or isolation of the suite.
      }, { timeout: 15_000 })
      // Chained expectation refining the UI/API assertion.
      .toBe(true);

    // Late day-A response must not clobber day-B draft.
    releaseA();
    await page.waitForTimeout(400);

    const selects = page.locator(".roster-block tbody select");
    const count = await selects.count();
    expect(count).toBeGreaterThanOrEqual(2);

    let edited = false;
    // Repeat/poll to widen the race window or wait for lock waiters.
    for (let i = 0; i < count; i++) {
      const select = selects.nth(i);
      if ((await select.inputValue()) === shiftA) {
        await select.selectOption(shiftB);
        edited = true;
        break;
      }
    }
    expect(edited).toBe(true);

    await page
      // Drive the browser through the user-visible workflow step.
      .getByRole("button", { name: /Запази ростер|Save roster/i })
      .click();
    await expect(
      page.getByText(
        new RegExp(`Ростерът за ${dayB}|Roster for ${dayB}`, "i"),
      ),
    // Runner option controlling stability or isolation of the suite.
    ).toBeVisible({ timeout: 15_000 });

    const saved = await apiGet(token, `/shifts/roster?hotelDate=${dayB}`);
    expect(saved.status).toBe(200);
    const entries = (
      saved.body as {
        entries: Array<{ employee: { id: string }; shift: { id: string } }>;
      }
    ).entries;
    const byEmp = new Map(entries.map((e) => [e.employee.id, e.shift.id]));
    expect(byEmp.get(empEdit)).toBe(shiftB);
    expect(byEmp.get(empKeep)).toBe(shiftB);
  });
});
