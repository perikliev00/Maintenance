/**
 * Room-specific reassignment modal: supervisor reassigns Maria → Elena.
 * Uses isolated fixtures; does not assume MAIN 102 exists.
 */
import { expect, test } from "@playwright/test";
import { uiLogin, USERS } from "./helpers/auth";
import { apiGet, apiLogin, apiPost, apiPut } from "./helpers/api";
import {
  findHousekeeperEmployeeId,
  hotelToday,
  ownerApi,
  prepareVacantDirtyRoom,
} from "./helpers/fixtures";
import { openNav } from "./helpers/nav";

// Local helper findElenaEmployeeId used by cases in this file.
async function findElenaEmployeeId(token: string): Promise<string> {
  const res = await apiGet(token, "/people");
  expect(res.status).toBe(200);
  const people = res.body as Array<{ employeeId?: string; email?: string }>;
  const elena = people.find(
    (p) => (p.email ?? "").toLowerCase() === USERS.elena.toLowerCase(),
  );
  expect(elena?.employeeId, "elena employeeId").toBeTruthy();
  return elena!.employeeId!;
}

/** Best-effort: put housekeepers on a full-day roster so availability = available. */
async function ensureOnRoster(
  token: string,
  employeeIds: string[],
  hotelDate: string,
): Promise<void> {
  const shifts = await apiGet(token, "/shifts");
  if (shifts.status !== 200) return;
  const list = shifts.body as Array<{
    id: string;
    isActive?: boolean;
    startTime?: string;
    endTime?: string;
  }>;
  let shift =
    list.find((s) => s.isActive !== false && s.startTime === "00:00" && s.endTime === "00:00") ??
    list.find((s) => s.isActive !== false);
  if (!shift) {
    // created: seeded entity required before the mutation under test.
    const created = await apiPost(token, "/shifts", {
      code: `E2E-AV-${Date.now().toString(36).slice(-4)}`,
      nameBg: "E2E Availability",
      nameEn: "E2E Availability",
      startTime: "00:00",
      endTime: "00:00",
      sortOrder: 99,
    });
    if (created.status !== 201 && created.status !== 200) return;
    shift = created.body as { id: string };
  }
  for (const employeeId of employeeIds) {
    await apiPut(token, `/shifts/roster`, {
      hotelDate,
      employeeId,
      shiftId: shift.id,
    });
  }
}

// Suite: rooms reassign modal.
test.describe("rooms reassign modal", () => {
  // Case: supervisor reassigns isolated room from Maria to Elena.
  test("supervisor reassigns isolated room from Maria to Elena", async ({
    page,
  }) => {
    const { token } = await ownerApi();
    const today = await hotelToday(token);
    const room = await prepareVacantDirtyRoom(token);
    const mariaId = await findHousekeeperEmployeeId(token);
    const elenaId = await findElenaEmployeeId(token);

    await ensureOnRoster(token, [mariaId, elenaId], today);

    const taskRes = await apiPost(token, "/cleaning/tasks", {
      locationId: room.id,
      hotelDate: today,
      priority: "normal",
      assignedEmployeeId: mariaId,
    });
    expect(
      taskRes.status,
      `create task → ${taskRes.status} ${JSON.stringify(taskRes.body)}`,
    ).toBe(201);

    await uiLogin(page, USERS.supervisor);
    await openNav(page, /Стаи|Rooms/);
    await expect(page.getByText(room.number).first()).toBeVisible({
      timeout: 20_000,
    });

    const row = page.locator("article[data-location-id]", { hasText: room.number }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: /Преназначи|Reassign/ }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: /Преназначаване|Reassign room/i }),
    ).toBeVisible();

    // Prefer Elena by employee label text from modal list.
    const elenaOption = dialog.locator("label.reassign-hk-option", {
      hasText: /Elena|Петрова|Petrova/i,
    });
    await expect(elenaOption.first()).toBeVisible({ timeout: 15_000 });
    await elenaOption.first().locator('input[type="radio"]').check();
    await expect(elenaOption.first().locator('input[type="radio"]')).toBeChecked();

    await dialog.locator("textarea").fill("E2E reassign Maria to Elena");

    // Off-shift / unavailable selections reveal force-override after React
    // updates. Wait until submit is enabled (check override when it appears).
    const override = dialog.locator(".reassign-override input[type='checkbox']");
    const submit = dialog.getByRole("button", { name: /Преназначи|Reassign/ });
    await expect
      .poll(async () => {
        if (await override.isVisible()) await override.check();
        return submit.isEnabled();
      }, { timeout: 8_000 })
      .toBeTruthy();
    await submit.click();

    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(row.getByText(/Elena Petrova/i).first()).toBeVisible({
      timeout: 15_000,
    });
    // Reason prefix is localized (`преназначаване` / `reassign`).
    await expect(
      row.getByText(
        /(преназначаване|reassign):\s*E2E reassign Maria to Elena/i,
      ),
    ).toBeVisible();

    // Elena owns the task via cleaning tasks API (mine=1).
    const { token: elenaToken } = await apiLogin(USERS.elena);
    const mine = await apiGet(
      elenaToken,
      `/cleaning/tasks?mine=1&hotelDate=${encodeURIComponent(today)}`,
    );
    expect(mine.status).toBe(200);
    const tasks = mine.body as Array<{
      location?: { number?: string };
      locationId?: string;
      assignedEmployeeId?: string;
    }>;
    const owned = tasks.some((t) => t.locationId === room.id);
    expect(
      owned,
      `Elena should own reassigned task; got ${JSON.stringify(tasks).slice(0, 400)}`,
    ).toBeTruthy();
  });
});
