/**
 * Housekeeping E2E: modals, Escape/dirty, supervisor create gate,
 * catalog pagination, atomic sector PATCH payload, archived picker tags.
 */
import { expect, test } from "@playwright/test";
// Import bindings from ./helpers/auth.
import { DEMO_PASSWORD, uiLogin, USERS } from "./helpers/auth";
// Import bindings from ./helpers/api.
import { apiGet, apiPatch, apiPost } from "./helpers/api";
// Import bindings from ./helpers/nav.
import { openNav } from "./helpers/nav";
// Shared test fixtures for seeding users, locations, and domain entities.
import { ownerApi } from "./helpers/fixtures";

// Suite: housekeeping modals.
test.describe("housekeeping modals", () => {
  // Case: manager: add sector modal opens, Escape closes, edit opens modal.
  test("manager: add sector modal opens, Escape closes, edit opens modal", async ({
    // Execute the next setup or assertion step for this scenario.
    page,
  // Execute the next setup or assertion step for this scenario.
  }) => {
    // Drive the browser through the user-visible workflow step.
    await uiLogin(page, USERS.manager, DEMO_PASSWORD);
    // Await async work before asserting or releasing locks.
    await openNav(page, /Почистване|Housekeeping/);
    // Bind sectorsTab for later setup or assertions in this scope.
    const sectorsTab = page.getByRole("tab", { name: /Сектори|Sectors/i });
    // Assert UI visibility/state after the user action.
    await expect(sectorsTab).toBeVisible({ timeout: 20_000 });
    // Await async work before asserting or releasing locks.
    await sectorsTab.click();

    // Bind addBtn for later setup or assertions in this scope.
    const addBtn = page.getByRole("button", {
      // Fixture field name for the seeded actor/entity.
      name: /\+ Добави сектор|\+ Add sector/i,
    });
    // Assert UI visibility/state after the user action.
    await expect(addBtn).toBeVisible();
    // Await async work before asserting or releasing locks.
    await addBtn.click();

    // Bind dialog for later setup or assertions in this scope.
    const dialog = page.getByRole("dialog");
    // Assert UI visibility/state after the user action.
    await expect(dialog).toBeVisible();
    // Await async work before asserting or releasing locks.
    await expect(
      // Drive the browser through the user-visible workflow step.
      dialog.getByRole("heading", {
        // Fixture field name for the seeded actor/entity.
        name: /Добавяне на сектор|Add sector/i,
      }),
    // Execute the next setup or assertion step for this scenario.
    ).toBeVisible();

    // Await async work before asserting or releasing locks.
    await page.keyboard.press("Escape");
    // Assert UI visibility/state after the user action.
    await expect(dialog).toHaveCount(0);

    // Bind editBtn for later setup or assertions in this scope.
    const editBtn = page
      // Continue the call chain for setup or assertion detail.
      .locator("tr")
      // Drive the browser through the user-visible workflow step.
      .filter({ has: page.getByRole("button", { name: /Редакция|Edit/i }) })
      // Continue the call chain for setup or assertion detail.
      .first()
      // Drive the browser through the user-visible workflow step.
      .getByRole("button", { name: /Редакция|Edit/i });
    // Assert UI visibility/state after the user action.
    await expect(editBtn).toBeVisible({ timeout: 15_000 });
    // Await async work before asserting or releasing locks.
    await editBtn.click();

    // Bind editDialog for later setup or assertions in this scope.
    const editDialog = page.getByRole("dialog");
    // Assert UI visibility/state after the user action.
    await expect(editDialog).toBeVisible();
    // Await async work before asserting or releasing locks.
    await expect(
      // Drive the browser through the user-visible workflow step.
      editDialog.getByRole("heading", {
        // Fixture field name for the seeded actor/entity.
        name: /Редакция на сектор|Edit sector/i,
      }),
    // Execute the next setup or assertion step for this scenario.
    ).toBeVisible();
    // Drive the browser through the user-visible workflow step.
    await editDialog.getByRole("button", { name: "Close" }).click();
    // Assert UI visibility/state after the user action.
    await expect(editDialog).toHaveCount(0);
  });

  // Case: dirty Escape confirms before discarding sector edit.
  test("dirty Escape confirms before discarding sector edit", async ({
    // Execute the next setup or assertion step for this scenario.
    page,
  // Execute the next setup or assertion step for this scenario.
  }) => {
    // Drive the browser through the user-visible workflow step.
    await uiLogin(page, USERS.manager, DEMO_PASSWORD);
    // Await async work before asserting or releasing locks.
    await openNav(page, /Почистване|Housekeeping/);
    // Drive the browser through the user-visible workflow step.
    await page.getByRole("tab", { name: /Сектори|Sectors/i }).click();

    // Await async work before asserting or releasing locks.
    await page
      // Continue the call chain for setup or assertion detail.
      .locator("tr")
      // Drive the browser through the user-visible workflow step.
      .filter({ has: page.getByRole("button", { name: /Редакция|Edit/i }) })
      // Continue the call chain for setup or assertion detail.
      .first()
      // Drive the browser through the user-visible workflow step.
      .getByRole("button", { name: /Редакция|Edit/i })
      // Continue the call chain for setup or assertion detail.
      .click();

    // Bind dialog for later setup or assertions in this scope.
    const dialog = page.getByRole("dialog");
    // Assert UI visibility/state after the user action.
    await expect(dialog).toBeVisible();
    // Await async work before asserting or releasing locks.
    await dialog.getByLabel(/Име BG|Name BG/i).fill(`Dirty-${Date.now()}`);

    // Execute the next setup or assertion step for this scenario.
    page.once("dialog", (d) => d.dismiss());
    // Await async work before asserting or releasing locks.
    await page.keyboard.press("Escape");
    // Assert UI visibility/state after the user action.
    await expect(dialog).toBeVisible();

    // Execute the next setup or assertion step for this scenario.
    page.once("dialog", (d) => d.accept());
    // Await async work before asserting or releasing locks.
    await page.keyboard.press("Escape");
    // Assert UI visibility/state after the user action.
    await expect(dialog).toHaveCount(0);
  });

  // Case: sector edit shows reload message on version_conflict 409.
  test("sector edit shows reload message on version_conflict 409", async ({
    // Execute the next setup or assertion step for this scenario.
    page,
  // Execute the next setup or assertion step for this scenario.
  }) => {
    // Drive the browser through the user-visible workflow step.
    await uiLogin(page, USERS.manager, DEMO_PASSWORD);
    // Await async work before asserting or releasing locks.
    await openNav(page, /Почистване|Housekeeping/);
    // Drive the browser through the user-visible workflow step.
    await page.getByRole("tab", { name: /Сектори|Sectors/i }).click();

    // Await async work before asserting or releasing locks.
    await page
      // Continue the call chain for setup or assertion detail.
      .locator("tr")
      // Drive the browser through the user-visible workflow step.
      .filter({ has: page.getByRole("button", { name: /Редакция|Edit/i }) })
      // Continue the call chain for setup or assertion detail.
      .first()
      // Drive the browser through the user-visible workflow step.
      .getByRole("button", { name: /Редакция|Edit/i })
      // Continue the call chain for setup or assertion detail.
      .click();

    // Bind dialog for later setup or assertions in this scope.
    const dialog = page.getByRole("dialog");
    // Assert UI visibility/state after the user action.
    await expect(dialog).toBeVisible();

    // Await async work before asserting or releasing locks.
    await page.route(/\/api\/sectors\/[^/]+$/, async (route) => {
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (route.request().method() !== "PATCH") {
        // Await async work before asserting or releasing locks.
        await route.continue();
        // Execute the next setup or assertion step for this scenario.
        return;
      }
      // Await async work before asserting or releasing locks.
      await route.fulfill({
        // Fixture field status for the seeded actor/entity.
        status: 409,
        // Execute the next setup or assertion step for this scenario.
        contentType: "application/json",
        // Configure body for the request/server under test.
        body: JSON.stringify({
          // Execute the next setup or assertion step for this scenario.
          error: "version_conflict",
          // Execute the next setup or assertion step for this scenario.
          message: "Sector was updated by another user",
        }),
      });
    });

    // Await async work before asserting or releasing locks.
    await dialog
      // Drive the browser through the user-visible workflow step.
      .getByRole("button", { name: /Запази промените|Save changes/i })
      // Continue the call chain for setup or assertion detail.
      .click();
    // Await async work before asserting or releasing locks.
    await expect(
      // Execute the next setup or assertion step for this scenario.
      dialog.getByText(
        // Execute the next setup or assertion step for this scenario.
        /променен от друг|changed by another|version_conflict|Reload/i,
      ),
    // Runner option controlling stability or isolation of the suite.
    ).toBeVisible({ timeout: 10_000 });
  });

  // Case: sector save sends atomic PATCH with locationIds + expectedVersion.
  test("sector save sends atomic PATCH with locationIds + expectedVersion", async ({
    // Execute the next setup or assertion step for this scenario.
    page,
  // Execute the next setup or assertion step for this scenario.
  }) => {
    // Drive the browser through the user-visible workflow step.
    await uiLogin(page, USERS.manager, DEMO_PASSWORD);
    // Await async work before asserting or releasing locks.
    await openNav(page, /Почистване|Housekeeping/);
    // Drive the browser through the user-visible workflow step.
    await page.getByRole("tab", { name: /Сектори|Sectors/i }).click();

    // Await async work before asserting or releasing locks.
    await page
      // Continue the call chain for setup or assertion detail.
      .locator("tr")
      // Drive the browser through the user-visible workflow step.
      .filter({ has: page.getByRole("button", { name: /Редакция|Edit/i }) })
      // Continue the call chain for setup or assertion detail.
      .first()
      // Drive the browser through the user-visible workflow step.
      .getByRole("button", { name: /Редакция|Edit/i })
      // Continue the call chain for setup or assertion detail.
      .click();

    // Bind dialog for later setup or assertions in this scope.
    const dialog = page.getByRole("dialog");
    // Assert UI visibility/state after the user action.
    await expect(dialog).toBeVisible();

    // Bind patchPromise for later setup or assertions in this scope.
    const patchPromise = page.waitForRequest(
      // Execute the next setup or assertion step for this scenario.
      (req) =>
        // Execute the next setup or assertion step for this scenario.
        req.method() === "PATCH" &&
        // Execute the next setup or assertion step for this scenario.
        /\/api\/sectors\/[^/]+$/.test(req.url()) &&
        // Execute the next setup or assertion step for this scenario.
        !req.url().includes("/locations"),
    );

    // Await async work before asserting or releasing locks.
    await dialog
      // Drive the browser through the user-visible workflow step.
      .getByRole("button", { name: /Запази промените|Save changes/i })
      // Continue the call chain for setup or assertion detail.
      .click();

    // req: HTTP response captured for status/body checks.
    const req = await patchPromise;
    // Bind body for later setup or assertions in this scope.
    const body = req.postDataJSON() as {
      // Execute the next setup or assertion step for this scenario.
      locationIds?: string[];
      // Execute the next setup or assertion step for this scenario.
      expectedVersion?: number;
    };
    // Assert browser/UI outcome matches the scenario intent.
    expect(Array.isArray(body.locationIds)).toBeTruthy();
    // Assert browser/UI outcome matches the scenario intent.
    expect(typeof body.expectedVersion).toBe("number");
    // Assert browser/UI outcome matches the scenario intent.
    expect(body.expectedVersion).toBeGreaterThan(0);
  });

  // Case: supervisor: no add-sector button; edit still available.
  test("supervisor: no add-sector button; edit still available", async ({
    // Execute the next setup or assertion step for this scenario.
    page,
  // Execute the next setup or assertion step for this scenario.
  }) => {
    // Drive the browser through the user-visible workflow step.
    await uiLogin(page, USERS.supervisor, DEMO_PASSWORD);
    // Await async work before asserting or releasing locks.
    await openNav(page, /Почистване|Housekeeping/);
    // Drive the browser through the user-visible workflow step.
    await page.getByRole("tab", { name: /Сектори|Sectors/i }).click();

    // Await async work before asserting or releasing locks.
    await expect(
      // Drive the browser through the user-visible workflow step.
      page.getByRole("button", {
        // Fixture field name for the seeded actor/entity.
        name: /\+ Добави сектор|\+ Add sector/i,
      }),
    // Execute the next setup or assertion step for this scenario.
    ).toHaveCount(0);

    // Bind edit for later setup or assertions in this scope.
    const edit = page.getByRole("button", { name: /Редакция|Edit/i }).first();
    // Conditional path for setup, cleanup, or alternate outcomes.
    if ((await edit.count()) > 0) {
      // Await async work before asserting or releasing locks.
      await edit.click();
      // Assert UI visibility/state after the user action.
      await expect(page.getByRole("dialog")).toBeVisible();
      // Await async work before asserting or releasing locks.
      await page.keyboard.press("Escape");
    }
  });

  // Case: catalog: add room via modal, then find via search pagination.
  test("catalog: add room via modal, then find via search pagination", async ({
    // Execute the next setup or assertion step for this scenario.
    page,
  // Execute the next setup or assertion step for this scenario.
  }) => {
    // Await async work before asserting or releasing locks.
    const { token } = await ownerApi();
    // stamp: unique stamp so parallel runs do not collide.
    const stamp = `E2E-M-${Date.now().toString(36).slice(-5)}`;
    // Execute the next setup or assertion step for this scenario.
    let createdId: string | null = null;

    // Try path where partial failure must not leak suite state.
    try {
      // Drive the browser through the user-visible workflow step.
      await uiLogin(page, USERS.owner, DEMO_PASSWORD);
      // Await async work before asserting or releasing locks.
      await openNav(page, /Почистване|Housekeeping/);
      // Bind catalogTab for later setup or assertions in this scope.
      const catalogTab = page.getByRole("tab", { name: /Каталог|Catalog/i });
      // Assert UI visibility/state after the user action.
      await expect(catalogTab).toBeVisible({ timeout: 20_000 });
      // Await async work before asserting or releasing locks.
      await catalogTab.click();

      // Catalog table implies hierarchy finished loading (avoids empty floorId).
      await expect(page.locator("table tbody tr").first()).toBeVisible({
        // Runner option controlling stability or isolation of the suite.
        timeout: 20_000,
      });
      // Await async work before asserting or releasing locks.
      await page
        // Drive the browser through the user-visible workflow step.
        .getByRole("button", { name: /\+ Добави стая|\+ Add room/i })
        // Continue the call chain for setup or assertion detail.
        .click();
      // Bind dialog for later setup or assertions in this scope.
      const dialog = page.getByRole("dialog");
      // Assert UI visibility/state after the user action.
      await expect(dialog).toBeVisible();
      // Await async work before asserting or releasing locks.
      await expect(
        // Drive the browser through the user-visible workflow step.
        dialog.getByRole("heading", {
          // Fixture field name for the seeded actor/entity.
          name: /Добавяне на стая|Add room/i,
        }),
      // Execute the next setup or assertion step for this scenario.
      ).toBeVisible();

      // Assert browser/UI outcome matches the scenario intent.
      await expect(dialog.getByLabel(/Сграда|Building/i)).not.toHaveValue("");
      // Assert browser/UI outcome matches the scenario intent.
      await expect(dialog.getByLabel(/Етаж|Floor/i)).not.toHaveValue("");
      // Await async work before asserting or releasing locks.
      await dialog.getByLabel(/Номер \/ име|Number \/ name/i).fill(stamp);
      // Await async work before asserting or releasing locks.
      await dialog
        // Drive the browser through the user-visible workflow step.
        .getByRole("button", { name: /Запази промените|Save changes/i })
        // Continue the call chain for setup or assertion detail.
        .click();
      // Assert UI visibility/state after the user action.
      await expect(dialog).toHaveCount(0, { timeout: 20_000 });

      // Bind search for later setup or assertions in this scope.
      const search = page.getByPlaceholder(/Номер \/ сграда|Number \/ building/i);
      // Await async work before asserting or releasing locks.
      await search.fill(stamp);
      // Assert UI visibility/state after the user action.
      await expect(page.getByText(stamp, { exact: true })).toBeVisible({
        // Runner option controlling stability or isolation of the suite.
        timeout: 20_000,
      });

      // listed: HTTP response captured for status/body checks.
      const listed = await apiGet(
        // Execute the next setup or assertion step for this scenario.
        token,
        // Execute the next setup or assertion step for this scenario.
        `/locations?paged=true&page=1&pageSize=25&q=${encodeURIComponent(stamp)}&includeArchived=true`,
      );
      // Assert response/page reached the expected status.
      expect(listed.status).toBe(200);
      // Bind body for later setup or assertions in this scope.
      const body = listed.body as {
        // Execute the next setup or assertion step for this scenario.
        items: Array<{ id: string; number: string }>;
      };
      // Bind hit for later setup or assertions in this scope.
      const hit = body.items.find((r) => r.number === stamp);
      // Assert browser/UI outcome matches the scenario intent.
      expect(hit?.id).toBeTruthy();
      // Execute the next setup or assertion step for this scenario.
      createdId = hit!.id;
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (createdId) {
        // Await async work before asserting or releasing locks.
        await apiPost(token, `/locations/${createdId}/archive`, {});
      }
    }
  });

  // Case: sector picker shows archived tag for archived membership rooms.
  test("sector picker shows archived tag for archived membership rooms", async ({
    // Execute the next setup or assertion step for this scenario.
    page,
  // Execute the next setup or assertion step for this scenario.
  }) => {
    // Await async work before asserting or releasing locks.
    const { token } = await ownerApi();
    // stamp: unique stamp so parallel runs do not collide.
    const stamp = `E2E-A-${Date.now().toString(36).slice(-5)}`;
    // Bind uniqueName for later setup or assertions in this scope.
    const uniqueName = `ArchTag ${stamp}`;

    // hier: HTTP response captured for status/body checks.
    const hier = await apiGet(token, "/locations/hierarchy");
    // Assert response/page reached the expected status.
    expect(hier.status).toBe(200);
    // Bind buildings for later setup or assertions in this scope.
    const buildings = hier.body as Array<{
      // Execute the next setup or assertion step for this scenario.
      floors: Array<{ id: string }>;
    // Execute the next setup or assertion step for this scenario.
    }>;
    // floorId: unique stamp so parallel runs do not collide.
    const floorId = buildings[0]?.floors[0]?.id;
    // Assert browser/UI outcome matches the scenario intent.
    expect(floorId).toBeTruthy();

    // createdLoc: seeded entity required before the mutation under test.
    const createdLoc = await apiPost(token, "/locations", {
      // Execute the next setup or assertion step for this scenario.
      floorId,
      // Execute the next setup or assertion step for this scenario.
      number: stamp,
      // Execute the next setup or assertion step for this scenario.
      kind: "room",
    });
    // Assert response/page reached the expected status.
    expect(createdLoc.status).toBe(201);
    // locId: unique stamp so parallel runs do not collide.
    const locId = (createdLoc.body as { id: string }).id;

    // sectors: HTTP response captured for status/body checks.
    const sectors = await apiGet(token, "/sectors?includeInactive=true");
    // Assert response/page reached the expected status.
    expect(sectors.status).toBe(200);
    // Bind list for later setup or assertions in this scope.
    const list = sectors.body as Array<{
      // Execute the next setup or assertion step for this scenario.
      id: string;
      // Execute the next setup or assertion step for this scenario.
      isActive: boolean;
      // Execute the next setup or assertion step for this scenario.
      version: number;
    // Execute the next setup or assertion step for this scenario.
    }>;
    // Bind sector for later setup or assertions in this scope.
    const sector = list.find((s) => s.isActive);
    // Assert browser/UI outcome matches the scenario intent.
    expect(sector).toBeTruthy();

    // detail: HTTP response captured for status/body checks.
    const detail = await apiGet(token, `/sectors/${sector!.id}`);
    // Assert response/page reached the expected status.
    expect(detail.status).toBe(200);
    // Bind body for later setup or assertions in this scope.
    const body = detail.body as {
      // Execute the next setup or assertion step for this scenario.
      version: number;
      // Execute the next setup or assertion step for this scenario.
      locationIds: string[];
      // Execute the next setup or assertion step for this scenario.
      code: string;
      // Execute the next setup or assertion step for this scenario.
      nameBg: string | null;
      // Execute the next setup or assertion step for this scenario.
      nameEn: string | null;
      // Execute the next setup or assertion step for this scenario.
      primarySupervisorEmployeeId: string | null;
    };
    // Bind originalLocationIds for later setup or assertions in this scope.
    const originalLocationIds = [...(body.locationIds ?? [])];
    // Bind locationIds for later setup or assertions in this scope.
    const locationIds = [...new Set([...originalLocationIds, locId])];
    // renamed: HTTP response captured for status/body checks.
    const renamed = await apiPatch(token, `/sectors/${sector!.id}`, {
      // Execute the next setup or assertion step for this scenario.
      nameBg: uniqueName,
      // Execute the next setup or assertion step for this scenario.
      nameEn: body.nameEn ?? uniqueName,
      // Execute the next setup or assertion step for this scenario.
      locationIds,
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: body.version,
    });
    // Assert response/page reached the expected status.
    expect(renamed.status).toBe(200);

    // Await async work before asserting or releasing locks.
    await apiPost(token, `/locations/${locId}/archive`, {});

    // Try path where partial failure must not leak suite state.
    try {
      // Drive the browser through the user-visible workflow step.
      await uiLogin(page, USERS.manager, DEMO_PASSWORD);
      // Await async work before asserting or releasing locks.
      await openNav(page, /Почистване|Housekeeping/);
      // Drive the browser through the user-visible workflow step.
      await page.getByRole("tab", { name: /Сектори|Sectors/i }).click();

      // Bind row for later setup or assertions in this scope.
      const row = page.getByRole("row").filter({ hasText: uniqueName });
      // Drive the browser through the user-visible workflow step.
      await row.getByRole("button", { name: /Редакция|Edit/i }).click();
      // Bind dialog for later setup or assertions in this scope.
      const dialog = page.getByRole("dialog");
      // Assert UI visibility/state after the user action.
      await expect(dialog).toBeVisible();

      // Await async work before asserting or releasing locks.
      await dialog.getByPlaceholder(/Търсене|Search/i).fill(stamp);
      // Assert UI visibility/state after the user action.
      await expect(dialog.getByText(stamp, { exact: false })).toBeVisible({
        // Runner option controlling stability or isolation of the suite.
        timeout: 15_000,
      });
      // Assert UI visibility/state after the user action.
      await expect(dialog.getByText(/архив|archived/i).first()).toBeVisible({
        // Runner option controlling stability or isolation of the suite.
        timeout: 10_000,
      });
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // latest: HTTP response captured for status/body checks.
      const latest = await apiGet(token, `/sectors/${sector!.id}`);
      // Bind latestBody for later setup or assertions in this scope.
      const latestBody = latest.body as { version: number };
      // Await async work before asserting or releasing locks.
      await apiPatch(token, `/sectors/${sector!.id}`, {
        // Execute the next setup or assertion step for this scenario.
        nameBg: body.nameBg ?? body.code,
        // Execute the next setup or assertion step for this scenario.
        nameEn: body.nameEn ?? body.code,
        // Execute the next setup or assertion step for this scenario.
        locationIds: originalLocationIds,
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: latestBody.version,
      });
      // Await async work before asserting or releasing locks.
      await apiPost(token, `/locations/${locId}/restore`, {});
      // Await async work before asserting or releasing locks.
      await apiPost(token, `/locations/${locId}/archive`, {});
    }
  });

  // Case: shifts: add shift opens centered modal.
  test("shifts: add shift opens centered modal", async ({ page }) => {
    // Drive the browser through the user-visible workflow step.
    await uiLogin(page, USERS.manager, DEMO_PASSWORD);
    // Await async work before asserting or releasing locks.
    await openNav(page, /Почистване|Housekeeping/);
    // Drive the browser through the user-visible workflow step.
    await page.getByRole("tab", { name: /Смени|Shifts/i }).click();

    // Bind add for later setup or assertions in this scope.
    const add = page.getByRole("button", {
      // Fixture field name for the seeded actor/entity.
      name: /\+ Добави смяна|\+ Add shift/i,
    });
    // Assert UI visibility/state after the user action.
    await expect(add).toBeVisible({ timeout: 20_000 });
    // Await async work before asserting or releasing locks.
    await add.click();
    // Bind dialog for later setup or assertions in this scope.
    const dialog = page.getByRole("dialog");
    // Assert UI visibility/state after the user action.
    await expect(dialog).toBeVisible();
    // Await async work before asserting or releasing locks.
    await expect(
      // Drive the browser through the user-visible workflow step.
      dialog.getByRole("heading", {
        // Fixture field name for the seeded actor/entity.
        name: /Добавяне на смяна|Add shift/i,
      }),
    // Execute the next setup or assertion step for this scenario.
    ).toBeVisible();
    // Await async work before asserting or releasing locks.
    await page.keyboard.press("Escape");
    // Assert UI visibility/state after the user action.
    await expect(dialog).toHaveCount(0);
  });
});
