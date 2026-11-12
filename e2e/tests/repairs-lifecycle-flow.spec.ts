/**
 * Full repair cycle through Repairs UI (happy + history).
 */
import { expect, test } from "@playwright/test";
// Import bindings from ./helpers/auth.
import { uiLogin, USERS, DEMO_PASSWORD } from "./helpers/auth";
// Import bindings from ./helpers/nav.
import { openNav } from "./helpers/nav";
// Import bindings from ./helpers/api.
import { apiGet, apiPost } from "./helpers/api";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  findTechnicianEmployeeId,
  // Execute the next setup or assertion step for this scenario.
  ownerApi,
  // Execute the next setup or assertion step for this scenario.
  prepareVacantDirtyRoom,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "./helpers/fixtures";

// Suite: repairs lifecycle flow.
test.describe("repairs lifecycle flow", () => {
  // Case: report → assign → start → wait → resume → resolve → close → reopen.
  test("report → assign → start → wait → resume → resolve → close → reopen", async ({
    // Execute the next setup or assertion step for this scenario.
    page,
  // Execute the next setup or assertion step for this scenario.
  }) => {
    // Execute the next setup or assertion step for this scenario.
    page.on("dialog", async (dialog) => {
      // Await async work before asserting or releasing locks.
      await dialog.accept(dialog.type() === "prompt" ? "e2e notes" : undefined);
    });

    // Await async work before asserting or releasing locks.
    const { token } = await ownerApi();
    // Dedicated free room so seed tickets/tasks cannot collide with this stamp.
    const room = await prepareVacantDirtyRoom(token);
    // techId: unique stamp so parallel runs do not collide.
    const techId = await findTechnicianEmployeeId(token);
    // stamp: unique stamp so parallel runs do not collide.
    const stamp = `E2E-R-${Date.now()}`;

    // Drive the browser through the user-visible workflow step.
    await uiLogin(page, USERS.owner, DEMO_PASSWORD);
    // BG nav label is "Повреди", not "Ремонти".
    await openNav(page, /Повреди|Repairs/);
    // Assert UI visibility/state after the user action.
    await expect(page.getByRole("heading", { name: /Докладвай|Report/i })).toBeVisible({
      // Runner option controlling stability or isolation of the suite.
      timeout: 20_000,
    });

    // Await async work before asserting or releasing locks.
    await page.getByLabel(/Стая|Room/).selectOption({ value: room.id });
    // Bind optionSelect for later setup or assertions in this scope.
    const optionSelect = page.getByLabel(/Опция|Option/);
    // optionValues: synchronize actors so the race window is observable.
    const optionValues = await optionSelect.locator("option").evaluateAll((opts) =>
      // Execute the next setup or assertion step for this scenario.
      opts.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
    // Assert browser/UI outcome matches the scenario intent.
    expect(optionValues.length).toBeGreaterThan(0);
    // Await async work before asserting or releasing locks.
    await optionSelect.selectOption(optionValues[0]!);
    // Title is catalog-driven; stamp goes in the optional clarification field.
    await page.getByLabel(/Уточнение|Clarification/i).fill(stamp);
    // Drive the browser through the user-visible workflow step.
    await page.getByRole("button", { name: /Докладвай|Report/i }).click();

    // List shows catalog title, not clarification — confirm create via API.
    type TicketRow = {
      // Execute the next setup or assertion step for this scenario.
      id: string;
      // Execute the next setup or assertion step for this scenario.
      title: string;
      // Execute the next setup or assertion step for this scenario.
      description?: string | null;
      // Fixture field status for the seeded actor/entity.
      status: string;
    };
    // Execute the next setup or assertion step for this scenario.
    let ticket: TicketRow | undefined;
    // Await async work before asserting or releasing locks.
    await expect
      // Continue the call chain for setup or assertion detail.
      .poll(
        // Execute the next setup or assertion step for this scenario.
        async () => {
          // list: HTTP response captured for status/body checks.
          const list = await apiGet(
            // Execute the next setup or assertion step for this scenario.
            token,
            // Pagination step for list/contract coverage.
            `/maintenance/tickets?status=open&locationId=${room.id}&limit=50`,
          );
          // Guard optional cleanup or alternate assertion paths.
          if (list.status !== 200) return false;
          // Bind tickets for later setup or assertions in this scope.
          const tickets = list.body as TicketRow[];
          // Execute the next setup or assertion step for this scenario.
          ticket = tickets.find(
            // Execute the next setup or assertion step for this scenario.
            (t) =>
              // Execute the next setup or assertion step for this scenario.
              t.description === stamp || t.description?.includes(stamp),
          );
          // Return the arranged value/result to the caller.
          return Boolean(ticket);
        },
        // Runner option controlling stability or isolation of the suite.
        { timeout: 20_000 },
      )
      // Chained expectation refining the UI/API assertion.
      .toBe(true);
    // Assert browser/UI outcome matches the scenario intent.
    expect(ticket, `ticket with clarification ${stamp}`).toBeTruthy();

    // Await async work before asserting or releasing locks.
    await apiPost(token, `/maintenance/tickets/${ticket!.id}/assign`, {
      // Execute the next setup or assertion step for this scenario.
      assigneeId: techId,
    });

    // Drive the browser through the user-visible workflow step.
    await page.getByRole("button", { name: "Log out" }).click();
    // Assert UI visibility/state after the user action.
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    // Drive the browser through the user-visible workflow step.
    await uiLogin(page, USERS.technician, DEMO_PASSWORD);
    // Await async work before asserting or releasing locks.
    await openNav(page, /Повреди|Repairs/);

    // Catalog titles collide across leftover tickets; room number is unique per run.
    const ticketRow = () =>
      // Execute the next setup or assertion step for this scenario.
      page.locator("tr").filter({ hasText: room.number });
    // Bind startBtn for later setup or assertions in this scope.
    const startBtn = /Старт|Start/;
    // Bind waitBtn for later setup or assertions in this scope.
    const waitBtn = /Изчакай|Wait/;
    // Bind resumeBtn for later setup or assertions in this scope.
    const resumeBtn = /Продължи|Resume/;
    // Bind resolveBtn for later setup or assertions in this scope.
    const resolveBtn = /Реши|Resolve/;
    // Bind closeBtn for later setup or assertions in this scope.
    const closeBtn = /Затвори|Close/;
    // Assert UI visibility/state after the user action.
    await expect(ticketRow()).toBeVisible({ timeout: 25_000 });
    // Drive the browser through the user-visible workflow step.
    await ticketRow().getByRole("button", { name: startBtn }).click();
    // Assert UI visibility/state after the user action.
    await expect(ticketRow().getByRole("button", { name: waitBtn })).toBeVisible({
      // Runner option controlling stability or isolation of the suite.
      timeout: 15_000,
    });
    // Drive the browser through the user-visible workflow step.
    await ticketRow().getByRole("button", { name: waitBtn }).click();
    // Assert UI visibility/state after the user action.
    await expect(ticketRow().getByRole("button", { name: resumeBtn })).toBeVisible({
      // Runner option controlling stability or isolation of the suite.
      timeout: 15_000,
    });
    // Drive the browser through the user-visible workflow step.
    await ticketRow().getByRole("button", { name: resumeBtn }).click();
    // Assert UI visibility/state after the user action.
    await expect(ticketRow().getByRole("button", { name: resolveBtn })).toBeVisible({
      // Runner option controlling stability or isolation of the suite.
      timeout: 15_000,
    });
    // Drive the browser through the user-visible workflow step.
    await ticketRow().getByRole("button", { name: resolveBtn }).click();
    // Confirm server persistence (UI may paint an optimistic pill before POST settles).
    await expect
      // Continue the call chain for setup or assertion detail.
      .poll(
        // Execute the next setup or assertion step for this scenario.
        async () => {
          // list: HTTP response captured for status/body checks.
          const list = await apiGet(
            // Execute the next setup or assertion step for this scenario.
            token,
            // Pagination step for list/contract coverage.
            "/maintenance/tickets?status=resolved&limit=100",
          );
          // Bind rows for later setup or assertions in this scope.
          const rows = list.body as Array<{ id: string; status: string }>;
          // Return the arranged value/result to the caller.
          return rows.some((r) => r.id === ticket!.id && r.status === "resolved");
        },
        // Runner option controlling stability or isolation of the suite.
        { timeout: 20_000 },
      )
      // Chained expectation refining the UI/API assertion.
      .toBe(true);

    // Drive the browser through the user-visible workflow step.
    await page.getByRole("button", { name: "Log out" }).click();
    // Assert UI visibility/state after the user action.
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    // Drive the browser through the user-visible workflow step.
    await uiLogin(page, USERS.owner, DEMO_PASSWORD);
    // Await async work before asserting or releasing locks.
    await openNav(page, /Повреди|Repairs/);

    // Bind statusFilter for later setup or assertions in this scope.
    const statusFilter = page.getByLabel(/Статус|Status/);
    // Assert UI visibility/state after the user action.
    await expect(statusFilter).toBeVisible();
    // Await async work before asserting or releasing locks.
    await statusFilter.selectOption("resolved");
    // Assert UI visibility/state after the user action.
    await expect(ticketRow()).toBeVisible({ timeout: 20_000 });
    // Assert UI visibility/state after the user action.
    await expect(ticketRow().getByRole("button", { name: closeBtn })).toBeVisible({
      // Runner option controlling stability or isolation of the suite.
      timeout: 20_000,
    });
    // Drive the browser through the user-visible workflow step.
    await ticketRow().getByRole("button", { name: closeBtn }).click();
    // Await async work before asserting or releasing locks.
    await expect
      // Continue the call chain for setup or assertion detail.
      .poll(
        // Execute the next setup or assertion step for this scenario.
        async () => {
          // list: HTTP response captured for status/body checks.
          const list = await apiGet(token, "/maintenance/tickets?status=all&limit=100");
          // Bind rows for later setup or assertions in this scope.
          const rows = list.body as Array<{ id: string; status: string }>;
          // Return the arranged value/result to the caller.
          return rows.find((r) => r.id === ticket!.id)?.status === "closed";
        },
        // Runner option controlling stability or isolation of the suite.
        { timeout: 20_000 },
      )
      // Chained expectation refining the UI/API assertion.
      .toBe(true);

    // Await async work before asserting or releasing locks.
    await openNav(page, /Контрол|Control/);
    // Control cards show building+number + catalog title, not clarification stamp.
    const controlCard = page.locator("li").filter({ hasText: room.number });
    // Assert UI visibility/state after the user action.
    await expect(controlCard).toBeVisible({ timeout: 20_000 });
    // Assert UI visibility/state after the user action.
    await expect(controlCard.getByRole("button", { name: "Reopen" })).toBeVisible({
      // Runner option controlling stability or isolation of the suite.
      timeout: 20_000,
    });
    // Drive the browser through the user-visible workflow step.
    await controlCard.getByRole("button", { name: "Reopen" }).click();

    // events: HTTP response captured for status/body checks.
    const events = await apiGet(token, `/maintenance/tickets/${ticket!.id}/events`);
    // Assert response/page reached the expected status.
    expect(events.status).toBe(200);
    // Bind ev for later setup or assertions in this scope.
    const ev = events.body as Array<{ toStatus: string; reason?: string | null }>;
    // Assert browser/UI outcome matches the scenario intent.
    expect(ev.some((e) => e.toStatus === "resolved")).toBeTruthy();
    // Assert browser/UI outcome matches the scenario intent.
    expect(ev.some((e) => e.toStatus === "closed")).toBeTruthy();
    // ticketAfter: HTTP response captured for status/body checks.
    const ticketAfter = await apiGet(token, `/maintenance/tickets?status=all&limit=50`);
    // Bind all for later setup or assertions in this scope.
    const all = ticketAfter.body as Array<{
      // Execute the next setup or assertion step for this scenario.
      id: string;
      // Fixture field status for the seeded actor/entity.
      status: string;
      // Execute the next setup or assertion step for this scenario.
      resolutionNotes?: string | null;
    // Execute the next setup or assertion step for this scenario.
    }>;
    // Bind row for later setup or assertions in this scope.
    const row = all.find((t) => t.id === ticket!.id);
    // Assert response/page reached the expected status.
    expect(row?.status).toBe("in_progress");
    // Assert browser/UI outcome matches the scenario intent.
    expect(row?.resolutionNotes ?? null).toBeNull();
    // Prior resolve reason remains on the event timeline
    expect(ev.some((e) => e.toStatus === "resolved" && e.reason === "e2e notes")).toBeTruthy();
  });
});
