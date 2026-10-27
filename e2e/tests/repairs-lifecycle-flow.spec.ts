/**
 * E2E-02 — Full repair cycle through Repairs UI (P1-37 happy + P1-47 history).
 */
import { expect, test } from "@playwright/test";
import { uiLogin, USERS, DEMO_PASSWORD } from "./helpers/auth";
import { openNav } from "./helpers/nav";
import { apiGet, apiPost } from "./helpers/api";
import {
  findTechnicianEmployeeId,
  ownerApi,
  prepareVacantDirtyRoom,
} from "./helpers/fixtures";

test.describe("E2E-02 repairs lifecycle flow", () => {
  test("report → assign → start → wait → resume → resolve → close → reopen", async ({
    page,
  }) => {
    page.on("dialog", async (dialog) => {
      await dialog.accept(dialog.type() === "prompt" ? "e2e notes" : undefined);
    });

    const { token } = await ownerApi();
    // Dedicated free room so seed tickets/tasks cannot collide with this stamp.
    const room = await prepareVacantDirtyRoom(token);
    const techId = await findTechnicianEmployeeId(token);
    const stamp = `E2E-R-${Date.now()}`;

    await uiLogin(page, USERS.owner, DEMO_PASSWORD);
    // BG nav label is "Повреди", not "Ремонти".
    await openNav(page, /Повреди|Repairs/);
    await expect(page.getByRole("heading", { name: /Докладвай|Report/i })).toBeVisible({
      timeout: 20_000,
    });

    await page.getByLabel(/Стая|Room/).selectOption({ value: room.id });
    const optionSelect = page.getByLabel(/Опция|Option/);
    const optionValues = await optionSelect.locator("option").evaluateAll((opts) =>
      opts.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
    expect(optionValues.length).toBeGreaterThan(0);
    await optionSelect.selectOption(optionValues[0]!);
    await page.getByLabel(/Заглавие|Title/).fill(stamp);
    await page.getByRole("button", { name: /Докладвай|Report/i }).click();
    await expect(page.getByText(stamp)).toBeVisible({ timeout: 15_000 });

    const list = await apiGet(token, "/maintenance/tickets?status=open&limit=50");
    expect(list.status).toBe(200);
    const tickets = list.body as Array<{ id: string; title: string; status: string }>;
    const ticket = tickets.find((t) => t.title === stamp || t.title.includes(stamp));
    expect(ticket, `ticket with title ${stamp}`).toBeTruthy();

    await apiPost(token, `/maintenance/tickets/${ticket!.id}/assign`, {
      assigneeId: techId,
    });

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await uiLogin(page, USERS.technician, DEMO_PASSWORD);
    await openNav(page, /Повреди|Repairs/);

    const ticketRow = () => page.locator("tr").filter({ hasText: stamp });
    const startBtn = /Старт|Start/;
    const waitBtn = /Изчакай|Wait/;
    const resumeBtn = /Продължи|Resume/;
    const resolveBtn = /Реши|Resolve/;
    const closeBtn = /Затвори|Close/;
    await expect(ticketRow()).toBeVisible({ timeout: 25_000 });
    await ticketRow().getByRole("button", { name: startBtn }).click();
    await expect(ticketRow().getByRole("button", { name: waitBtn })).toBeVisible({
      timeout: 15_000,
    });
    await ticketRow().getByRole("button", { name: waitBtn }).click();
    await expect(ticketRow().getByRole("button", { name: resumeBtn })).toBeVisible({
      timeout: 15_000,
    });
    await ticketRow().getByRole("button", { name: resumeBtn }).click();
    await expect(ticketRow().getByRole("button", { name: resolveBtn })).toBeVisible({
      timeout: 15_000,
    });
    await ticketRow().getByRole("button", { name: resolveBtn }).click();
    // Confirm server persistence (UI may paint an optimistic pill before POST settles).
    await expect
      .poll(
        async () => {
          const list = await apiGet(
            token,
            "/maintenance/tickets?status=resolved&limit=100",
          );
          const rows = list.body as Array<{ id: string; status: string }>;
          return rows.some((r) => r.id === ticket!.id && r.status === "resolved");
        },
        { timeout: 20_000 },
      )
      .toBe(true);

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await uiLogin(page, USERS.owner, DEMO_PASSWORD);
    await openNav(page, /Повреди|Repairs/);

    const statusFilter = page.getByLabel(/Статус|Status/);
    await expect(statusFilter).toBeVisible();
    await statusFilter.selectOption("resolved");
    await expect(ticketRow()).toBeVisible({ timeout: 20_000 });
    await expect(ticketRow().getByRole("button", { name: closeBtn })).toBeVisible({
      timeout: 20_000,
    });
    await ticketRow().getByRole("button", { name: closeBtn }).click();
    await expect
      .poll(
        async () => {
          const list = await apiGet(token, "/maintenance/tickets?status=all&limit=100");
          const rows = list.body as Array<{ id: string; status: string }>;
          return rows.find((r) => r.id === ticket!.id)?.status === "closed";
        },
        { timeout: 20_000 },
      )
      .toBe(true);

    await openNav(page, /Контрол|Control/);
    const controlCard = page.locator("li").filter({ hasText: stamp });
    await expect(controlCard).toBeVisible({ timeout: 20_000 });
    await expect(controlCard.getByRole("button", { name: "Reopen" })).toBeVisible({
      timeout: 20_000,
    });
    await controlCard.getByRole("button", { name: "Reopen" }).click();

    const events = await apiGet(token, `/maintenance/tickets/${ticket!.id}/events`);
    expect(events.status).toBe(200);
    const ev = events.body as Array<{ toStatus: string; reason?: string | null }>;
    expect(ev.some((e) => e.toStatus === "resolved")).toBeTruthy();
    expect(ev.some((e) => e.toStatus === "closed")).toBeTruthy();
    const ticketAfter = await apiGet(token, `/maintenance/tickets?status=all&limit=50`);
    const all = ticketAfter.body as Array<{
      id: string;
      status: string;
      resolutionNotes?: string | null;
    }>;
    const row = all.find((t) => t.id === ticket!.id);
    expect(row?.status).toBe("in_progress");
    expect(row?.resolutionNotes ?? null).toBeNull();
    // Prior resolve reason remains on the event timeline
    expect(ev.some((e) => e.toStatus === "resolved" && e.reason === "e2e notes")).toBeTruthy();
  });
});
