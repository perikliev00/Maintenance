/**
 * Audit live refresh: open Одит, mutate via API, assert UI updates without reload.
 * Covers jobs.changed and settings.changed → events (path).
 */
import { expect, test } from "@playwright/test";
// Import bindings from ./helpers/api.
import { apiGet, apiLogin, apiPatch, apiPost } from "./helpers/api";
// Import bindings from ./helpers/auth.
import { uiLogin, USERS } from "./helpers/auth";
// Import bindings from ./helpers/jobRun.
import { postJobRunWhenFree } from "./helpers/jobRun";
// Import bindings from ./helpers/nav.
import { openNav } from "./helpers/nav";

// Shape JobRunRow documents the fixture/response fields this suite touches.
type JobRunRow = {
  // Execute the next setup or assertion step for this scenario.
  id: string;
  // Execute the next setup or assertion step for this scenario.
  jobKey: string;
  // Fixture field status for the seeded actor/entity.
  status: string;
  // Execute the next setup or assertion step for this scenario.
  startedAt: string;
};

// Local helper triggerJobRun used by cases in this file.
async function triggerJobRun(token: string, jobKey: string) {
  // Return the arranged value/result to the caller.
  return postJobRunWhenFree(
    {
      // Execute the next setup or assertion step for this scenario.
      post: apiPost,
      // Execute the next setup or assertion step for this scenario.
      fail: (message): never => {
        // Surface a hard failure when isolation or contract is violated.
        throw new Error(message);
      },
    },
    // Execute the next setup or assertion step for this scenario.
    token,
    // Execute the next setup or assertion step for this scenario.
    jobKey,
  );
}

// Suite: Audit page live refresh.
test.describe("Audit page live refresh", () => {
  // Case: jobs panel refreshes on jobs.changed without reload.
  test("jobs panel refreshes on jobs.changed without reload", async ({
    // Execute the next setup or assertion step for this scenario.
    page,
  // Execute the next setup or assertion step for this scenario.
  }) => {
    // Allow waiting out a concurrent scheduler cycle when reuseExistingServer
    // attaches to an API that still has the scheduler enabled.
    test.setTimeout(180_000);

    // Await async work before asserting or releasing locks.
    const { token } = await apiLogin(USERS.owner);
    // Drive the browser through the user-visible workflow step.
    await uiLogin(page, USERS.owner);
    // Await async work before asserting or releasing locks.
    await openNav(page, /Одит|Audit/);

    // Await async work before asserting or releasing locks.
    await expect(
      // Drive the browser through the user-visible workflow step.
      page.getByRole("heading", { name: /Одит лог|Audit log/ }),
    // Execute the next setup or assertion step for this scenario.
    ).toBeVisible();
    // Await async work before asserting or releasing locks.
    await expect(
      // Drive the browser through the user-visible workflow step.
      page.getByRole("heading", { name: /Фонови задачи|Background tasks/ }),
    // Runner option controlling stability or isolation of the suite.
    ).toBeVisible({ timeout: 20_000 });

    // beforeRes: HTTP response captured for status/body checks.
    const beforeRes = await apiGet(token, "/jobs/runs?limit=50");
    // Assert response/page reached the expected status.
    expect(beforeRes.status).toBe(200);
    // Bind beforeIds for later setup or assertions in this scope.
    const beforeIds = new Set(
      // Execute the next setup or assertion step for this scenario.
      (beforeRes.body as JobRunRow[]).map((row) => row.id),
    );

    // Let SSE connect before the API trigger.
    await page.waitForTimeout(1_000);

    // Await async work before asserting or releasing locks.
    await triggerJobRun(token, "lock_inactive_users");

    // Discover the NEW run id via API — not a pre-existing P1 row.
    let freshId = "";
    // Await async work before asserting or releasing locks.
    await expect
      // Continue the call chain for setup or assertion detail.
      .poll(
        // Execute the next setup or assertion step for this scenario.
        async () => {
          // after: HTTP response captured for status/body checks.
          const after = await apiGet(token, "/jobs/runs?limit=50");
          // Guard optional cleanup or alternate assertion paths.
          if (after.status !== 200) return false;
          // Bind fresh for later setup or assertions in this scope.
          const fresh = (after.body as JobRunRow[]).find(
            // Execute the next setup or assertion step for this scenario.
            (row) =>
              // Execute the next setup or assertion step for this scenario.
              !beforeIds.has(row.id) &&
              // Concurrency/isolation step for the race under test.
              row.jobKey === "lock_inactive_users" &&
              // Execute the next setup or assertion step for this scenario.
              (row.status === "ok" || row.status === "running"),
          );
          // Conditional path for setup, cleanup, or alternate outcomes.
          if (!fresh) return false;
          // Execute the next setup or assertion step for this scenario.
          freshId = fresh.id;
          // Return the arranged value/result to the caller.
          return true;
        },
        // Runner option controlling stability or isolation of the suite.
        { timeout: 30_000 },
      )
      // Chained expectation refining the UI/API assertion.
      .toBe(true);

    // No page.reload() — jobs.changed must soft-refresh this specific new row.
    await expect(
      // Execute the next setup or assertion step for this scenario.
      page.locator(`[data-job-run-id="${freshId}"]`),
    // Runner option controlling stability or isolation of the suite.
    ).toBeVisible({ timeout: 20_000 });
    // Await async work before asserting or releasing locks.
    await expect(
      // Drive the browser through the user-visible workflow step.
      page.locator(`[data-job-run-id="${freshId}"]`).getByRole("cell", {
        // Fixture field name for the seeded actor/entity.
        name: /Заключване на неактивни потребители|Lock inactive users/,
      }),
    // Execute the next setup or assertion step for this scenario.
    ).toBeVisible();
  });

  // Case: events panel refreshes on settings.changed without reload.
  test("events panel refreshes on settings.changed without reload", async ({
    // Execute the next setup or assertion step for this scenario.
    page,
  // Execute the next setup or assertion step for this scenario.
  }) => {
    // Await async work before asserting or releasing locks.
    const { token } = await apiLogin(USERS.owner);
    // Drive the browser through the user-visible workflow step.
    await uiLogin(page, USERS.owner);
    // Await async work before asserting or releasing locks.
    await openNav(page, /Одит|Audit/);

    // Await async work before asserting or releasing locks.
    await expect(
      // Drive the browser through the user-visible workflow step.
      page.getByRole("heading", { name: /Събития|Events/ }),
    // Runner option controlling stability or isolation of the suite.
    ).toBeVisible({ timeout: 20_000 });

    // Bind actionSelect for later setup or assertions in this scope.
    const actionSelect = page.getByLabel(/Действие|Action/);
    // Await async work before asserting or releasing locks.
    await actionSelect.selectOption("setting.update");
    // Await async work before asserting or releasing locks.
    await expect(
      // Drive the browser through the user-visible workflow step.
      page.getByRole("heading", { name: /Събития|Events/ }),
    // Runner option controlling stability or isolation of the suite.
    ).toBeVisible({ timeout: 20_000 });

    // Await async work before asserting or releasing locks.
    await page.waitForTimeout(1_000);

    // Bind reason for later setup or assertions in this scope.
    const reason = `e2e-audit-live-${Date.now()}`;
    // current: HTTP response captured for status/body checks.
    const current = await apiGet(token, "/settings");
    // Assert response/page reached the expected status.
    expect(current.status).toBe(200);
    // Bind ops for later setup or assertions in this scope.
    const ops = (
      // Execute the next setup or assertion step for this scenario.
      current.body as {
        // Execute the next setup or assertion step for this scenario.
        operations?: { value?: Record<string, unknown>; version?: number };
      }
    // Execute the next setup or assertion step for this scenario.
    ).operations;
    // Assert browser/UI outcome matches the scenario intent.
    expect(ops?.value, "settings.operations.value").toBeTruthy();
    // Assert browser/UI outcome matches the scenario intent.
    expect(typeof ops?.version).toBe("number");

    // patch: HTTP response captured for status/body checks.
    const patch = await apiPatch(token, "/settings/operations", {
      // Execute the next setup or assertion step for this scenario.
      value: ops!.value,
      // Execute the next setup or assertion step for this scenario.
      reason,
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: ops!.version,
    });
    // Assert browser/UI outcome matches the scenario intent.
    expect(
      // Execute the next setup or assertion step for this scenario.
      patch.status,
      // Execute the next setup or assertion step for this scenario.
      `PATCH operations → ${patch.status} ${JSON.stringify(patch.body)}`,
    // Execute the next setup or assertion step for this scenario.
    ).toBe(200);

    // No page.reload() — settings.changed must soft-refresh the events table.
    // Unique reason is the strong signal (filter <option> also says "Обновена настройка").
    const eventsPanel = page.locator("section.panel").filter({
      // Drive the browser through the user-visible workflow step.
      has: page.getByRole("heading", { name: /Събития|Events/ }),
    });
    // Assert UI visibility/state after the user action.
    await expect(eventsPanel.getByText(reason, { exact: true })).toBeVisible({
      // Runner option controlling stability or isolation of the suite.
      timeout: 20_000,
    });
  });
});
