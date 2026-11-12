/**
 * Audit live refresh: open Одит, mutate via API, assert UI updates without reload.
 * Covers jobs.changed and settings.changed → events (path).
 */
import { expect, test } from "@playwright/test";
import { apiGet, apiLogin, apiPatch, apiPost } from "./helpers/api";
import { uiLogin, USERS } from "./helpers/auth";
import { postJobRunWhenFree } from "./helpers/jobRun";
import { openNav } from "./helpers/nav";

// Shape JobRunRow documents the fixture/response fields this suite touches.
type JobRunRow = {
  id: string;
  jobKey: string;
  status: string;
  startedAt: string;
};

// Local helper triggerJobRun used by cases in this file.
async function triggerJobRun(token: string, jobKey: string) {
  return postJobRunWhenFree(
    {
      post: apiPost,
      fail: (message): never => {
        // Surface a hard failure when isolation or contract is violated.
        throw new Error(message);
      },
    },
    token,
    jobKey,
  );
}

// Suite: Audit page live refresh.
test.describe("Audit page live refresh", () => {
  // Case: jobs panel refreshes on jobs.changed without reload.
  test("jobs panel refreshes on jobs.changed without reload", async ({
    page,
  }) => {
    // Allow waiting out a concurrent scheduler cycle when reuseExistingServer
    // attaches to an API that still has the scheduler enabled.
    test.setTimeout(180_000);

    const { token } = await apiLogin(USERS.owner);
    await uiLogin(page, USERS.owner);
    await openNav(page, /Одит|Audit/);

    await expect(
      page.getByRole("heading", { name: /Одит лог|Audit log/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Фонови задачи|Background tasks/ }),
    // Runner option controlling stability or isolation of the suite.
    ).toBeVisible({ timeout: 20_000 });

    const beforeRes = await apiGet(token, "/jobs/runs?limit=50");
    expect(beforeRes.status).toBe(200);
    const beforeIds = new Set(
      (beforeRes.body as JobRunRow[]).map((row) => row.id),
    );

    // Let SSE connect before the API trigger.
    await page.waitForTimeout(1_000);

    await triggerJobRun(token, "lock_inactive_users");

    // Discover the NEW run id via API — not a pre-existing P1 row.
    let freshId = "";
    await expect
      .poll(
        async () => {
          const after = await apiGet(token, "/jobs/runs?limit=50");
          if (after.status !== 200) return false;
          const fresh = (after.body as JobRunRow[]).find(
            (row) =>
              !beforeIds.has(row.id) &&
              row.jobKey === "lock_inactive_users" &&
              (row.status === "ok" || row.status === "running"),
          );
          if (!fresh) return false;
          freshId = fresh.id;
          return true;
        },
        { timeout: 30_000 },
      )
      // Chained expectation refining the UI/API assertion.
      .toBe(true);

    // No page.reload() — jobs.changed must soft-refresh this specific new row.
    await expect(
      page.locator(`[data-job-run-id="${freshId}"]`),
    // Runner option controlling stability or isolation of the suite.
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.locator(`[data-job-run-id="${freshId}"]`).getByRole("cell", {
        name: /Заключване на неактивни потребители|Lock inactive users/,
      }),
    ).toBeVisible();
  });

  // Case: events panel refreshes on settings.changed without reload.
  test("events panel refreshes on settings.changed without reload", async ({
    page,
  }) => {
    const { token } = await apiLogin(USERS.owner);
    await uiLogin(page, USERS.owner);
    await openNav(page, /Одит|Audit/);

    await expect(
      page.getByRole("heading", { name: /Събития|Events/ }),
    // Runner option controlling stability or isolation of the suite.
    ).toBeVisible({ timeout: 20_000 });

    const actionSelect = page.getByLabel(/Действие|Action/);
    await actionSelect.selectOption("setting.update");
    await expect(
      page.getByRole("heading", { name: /Събития|Events/ }),
    // Runner option controlling stability or isolation of the suite.
    ).toBeVisible({ timeout: 20_000 });

    await page.waitForTimeout(1_000);

    const reason = `e2e-audit-live-${Date.now()}`;
    const current = await apiGet(token, "/settings");
    expect(current.status).toBe(200);
    const ops = (
      current.body as {
        operations?: { value?: Record<string, unknown>; version?: number };
      }
    ).operations;
    expect(ops?.value, "settings.operations.value").toBeTruthy();
    expect(typeof ops?.version).toBe("number");

    const patch = await apiPatch(token, "/settings/operations", {
      value: ops!.value,
      reason,
      expectedVersion: ops!.version,
    });
    expect(
      patch.status,
      `PATCH operations → ${patch.status} ${JSON.stringify(patch.body)}`,
    ).toBe(200);

    // No page.reload() — settings.changed must soft-refresh the events table.
    // Unique reason is the strong signal (filter <option> also says "Обновена настройка").
    const eventsPanel = page.locator("section.panel").filter({
      has: page.getByRole("heading", { name: /Събития|Events/ }),
    });
    await expect(eventsPanel.getByText(reason, { exact: true })).toBeVisible({
      timeout: 20_000,
    });
  });
});
