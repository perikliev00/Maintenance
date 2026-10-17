/**
 * E2E-02 — Full repair cycle through Repairs UI (P1-37 happy + P1-47 history).
 */
import { expect, test } from "@playwright/test";
import { uiLogin, USERS, DEMO_PASSWORD } from "./helpers/auth";
import { openNav } from "./helpers/nav";
import { apiGet, apiPost } from "./helpers/api";
import {
  findTechnicianEmployeeId,
  listRooms,
  ownerApi,
} from "./helpers/fixtures";

test.describe("E2E-02 repairs lifecycle flow", () => {
  test("report → assign → start → wait → resume → resolve → close → reopen", async ({
    page,
  }) => {
    page.on("dialog", async (dialog) => {
      await dialog.accept(dialog.type() === "prompt" ? "e2e notes" : undefined);
    });

    const { token } = await ownerApi();
    const rooms = await listRooms(token);
    const room = rooms[0]!;
    const techId = await findTechnicianEmployeeId(token);
    const stamp = `E2E-R-${Date.now()}`;

    await uiLogin(page, USERS.owner, DEMO_PASSWORD);
    await openNav(page, /Ремонти|Repairs/);
    await expect(page.getByRole("heading", { name: /Докладвай|Report/i })).toBeVisible({
      timeout: 20_000,
    });

    await page.getByLabel(/Стая|Room/).selectOption({ value: room.id });
    // Pick first real option (skip empty if any)
    const optionSelect = page.getByLabel(/Опция|Option/);
    const optionValues = await optionSelect.locator("option").evaluateAll((opts) =>
      opts.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
    expect(optionValues.length).toBeGreaterThan(0);
    await optionSelect.selectOption(optionValues[0]!);
    await page.getByLabel(/Заглавие|Title/).fill(stamp);
    await page.getByRole("button", { name: /Докладвай|Report/i }).click();
    await expect(page.getByText(/докладван|reported|Тикет/i).first()).toBeVisible({
      timeout: 15_000,
    });

    const list = await apiGet(token, "/maintenance/tickets?status=open&limit=50");
    expect(list.status).toBe(200);
    const tickets = list.body as Array<{ id: string; title: string; status: string }>;
    const ticket = tickets.find((t) => t.title === stamp || t.title.includes(stamp));
    expect(ticket, `ticket with title ${stamp}`).toBeTruthy();

    await apiPost(token, `/maintenance/tickets/${ticket!.id}/assign`, {
      assigneeId: techId,
    });

    await page.getByRole("button", { name: "Log out" }).click();
    await uiLogin(page, USERS.technician, DEMO_PASSWORD);
    await openNav(page, /Ремонти|Repairs/);

    // Select the ticket row if needed, then Start
    await page.getByText(stamp).first().click().catch(() => undefined);
    await expect(page.getByRole("button", { name: "Start" }).first()).toBeVisible({
      timeout: 25_000,
    });
    await page.getByRole("button", { name: "Start" }).first().click();
    await expect(page.getByRole("button", { name: "Wait" }).first()).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Wait" }).first().click();
    await expect(page.getByRole("button", { name: "Resume" }).first()).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Resume" }).first().click();
    await expect(page.getByRole("button", { name: "Resolve" }).first()).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Resolve" }).first().click();

    await page.getByRole("button", { name: "Log out" }).click();
    await uiLogin(page, USERS.owner, DEMO_PASSWORD);
    await openNav(page, /Ремонти|Repairs/);

    const statusFilter = page.getByLabel(/Статус|Status/).or(
      page.locator("select").filter({ has: page.locator("option[value=resolved]") }),
    );
    if (await statusFilter.count()) {
      await statusFilter.first().selectOption("resolved").catch(() => undefined);
    }
    await page.getByText(stamp).first().click().catch(() => undefined);
    await expect(page.getByRole("button", { name: "Close" }).first()).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("button", { name: "Close" }).first().click();

    await openNav(page, /Контрол|Control/);
    await expect(page.getByRole("button", { name: /Reopen|Отвори/i }).first()).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("button", { name: /Reopen|Отвори/i }).first().click();

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
