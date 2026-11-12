/**
 * Housekeeping E2E: modals, Escape/dirty, supervisor create gate,
 * catalog pagination, atomic sector PATCH payload, archived picker tags.
 */
import { expect, test } from "@playwright/test";
import { DEMO_PASSWORD, uiLogin, USERS } from "./helpers/auth";
import { apiGet, apiPatch, apiPost } from "./helpers/api";
import { openNav } from "./helpers/nav";
// Shared test fixtures for seeding users, locations, and domain entities.
import { ownerApi } from "./helpers/fixtures";

// Suite: housekeeping modals.
test.describe("housekeeping modals", () => {
  // Case: manager: add sector modal opens, Escape closes, edit opens modal.
  test("manager: add sector modal opens, Escape closes, edit opens modal", async ({
    page,
  }) => {
    await uiLogin(page, USERS.manager, DEMO_PASSWORD);
    await openNav(page, /Почистване|Housekeeping/);
    const sectorsTab = page.getByRole("tab", { name: /Сектори|Sectors/i });
    await expect(sectorsTab).toBeVisible({ timeout: 20_000 });
    await sectorsTab.click();

    const addBtn = page.getByRole("button", {
      name: /\+ Добави сектор|\+ Add sector/i,
    });
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", {
        name: /Добавяне на сектор|Add sector/i,
      }),
    ).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    const editBtn = page
      .locator("tr")
      .filter({ has: page.getByRole("button", { name: /Редакция|Edit/i }) })
      .first()
      .getByRole("button", { name: /Редакция|Edit/i });
    await expect(editBtn).toBeVisible({ timeout: 15_000 });
    await editBtn.click();

    const editDialog = page.getByRole("dialog");
    await expect(editDialog).toBeVisible();
    await expect(
      editDialog.getByRole("heading", {
        name: /Редакция на сектор|Edit sector/i,
      }),
    ).toBeVisible();
    await editDialog.getByRole("button", { name: "Close" }).click();
    await expect(editDialog).toHaveCount(0);
  });

  // Case: dirty Escape confirms before discarding sector edit.
  test("dirty Escape confirms before discarding sector edit", async ({
    page,
  }) => {
    await uiLogin(page, USERS.manager, DEMO_PASSWORD);
    await openNav(page, /Почистване|Housekeeping/);
    await page.getByRole("tab", { name: /Сектори|Sectors/i }).click();

    await page
      .locator("tr")
      .filter({ has: page.getByRole("button", { name: /Редакция|Edit/i }) })
      .first()
      .getByRole("button", { name: /Редакция|Edit/i })
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/Име BG|Name BG/i).fill(`Dirty-${Date.now()}`);

    page.once("dialog", (d) => d.dismiss());
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();

    page.once("dialog", (d) => d.accept());
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  // Case: sector edit shows reload message on version_conflict 409.
  test("sector edit shows reload message on version_conflict 409", async ({
    page,
  }) => {
    await uiLogin(page, USERS.manager, DEMO_PASSWORD);
    await openNav(page, /Почистване|Housekeeping/);
    await page.getByRole("tab", { name: /Сектори|Sectors/i }).click();

    await page
      .locator("tr")
      // Drive the browser through the user-visible workflow step.
      .filter({ has: page.getByRole("button", { name: /Редакция|Edit/i }) })
      .first()
      // Drive the browser through the user-visible workflow step.
      .getByRole("button", { name: /Редакция|Edit/i })
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await page.route(/\/api\/sectors\/[^/]+$/, async (route) => {
      if (route.request().method() !== "PATCH") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        // Configure body for the request/server under test.
        body: JSON.stringify({
          error: "version_conflict",
          message: "Sector was updated by another user",
        }),
      });
    });

    await dialog
      // Drive the browser through the user-visible workflow step.
      .getByRole("button", { name: /Запази промените|Save changes/i })
      .click();
    await expect(
      dialog.getByText(
        /променен от друг|changed by another|version_conflict|Reload/i,
      ),
    // Runner option controlling stability or isolation of the suite.
    ).toBeVisible({ timeout: 10_000 });
  });

  // Case: sector save sends atomic PATCH with locationIds + expectedVersion.
  test("sector save sends atomic PATCH with locationIds + expectedVersion", async ({
    page,
  }) => {
    await uiLogin(page, USERS.manager, DEMO_PASSWORD);
    await openNav(page, /Почистване|Housekeeping/);
    await page.getByRole("tab", { name: /Сектори|Sectors/i }).click();

    await page
      .locator("tr")
      // Drive the browser through the user-visible workflow step.
      .filter({ has: page.getByRole("button", { name: /Редакция|Edit/i }) })
      .first()
      // Drive the browser through the user-visible workflow step.
      .getByRole("button", { name: /Редакция|Edit/i })
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const patchPromise = page.waitForRequest(
      (req) =>
        req.method() === "PATCH" &&
        /\/api\/sectors\/[^/]+$/.test(req.url()) &&
        !req.url().includes("/locations"),
    );

    await dialog
      // Drive the browser through the user-visible workflow step.
      .getByRole("button", { name: /Запази промените|Save changes/i })
      .click();

    const req = await patchPromise;
    const body = req.postDataJSON() as {
      locationIds?: string[];
      expectedVersion?: number;
    };
    expect(Array.isArray(body.locationIds)).toBeTruthy();
    expect(typeof body.expectedVersion).toBe("number");
    expect(body.expectedVersion).toBeGreaterThan(0);
  });

  // Case: supervisor: no add-sector button; edit still available.
  test("supervisor: no add-sector button; edit still available", async ({
    page,
  }) => {
    await uiLogin(page, USERS.supervisor, DEMO_PASSWORD);
    await openNav(page, /Почистване|Housekeeping/);
    await page.getByRole("tab", { name: /Сектори|Sectors/i }).click();

    await expect(
      page.getByRole("button", {
        name: /\+ Добави сектор|\+ Add sector/i,
      }),
    ).toHaveCount(0);

    const edit = page.getByRole("button", { name: /Редакция|Edit/i }).first();
    if ((await edit.count()) > 0) {
      await edit.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
    }
  });

  // Case: catalog: add room via modal, then find via search pagination.
  test("catalog: add room via modal, then find via search pagination", async ({
    page,
  }) => {
    const { token } = await ownerApi();
    const stamp = `E2E-M-${Date.now().toString(36).slice(-5)}`;
    let createdId: string | null = null;

    try {
      await uiLogin(page, USERS.owner, DEMO_PASSWORD);
      await openNav(page, /Почистване|Housekeeping/);
      const catalogTab = page.getByRole("tab", { name: /Каталог|Catalog/i });
      await expect(catalogTab).toBeVisible({ timeout: 20_000 });
      await catalogTab.click();

      // Catalog table implies hierarchy finished loading (avoids empty floorId).
      await expect(page.locator("table tbody tr").first()).toBeVisible({
        timeout: 20_000,
      });
      await page
        // Drive the browser through the user-visible workflow step.
        .getByRole("button", { name: /\+ Добави стая|\+ Add room/i })
        .click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole("heading", {
          name: /Добавяне на стая|Add room/i,
        }),
      ).toBeVisible();

      await expect(dialog.getByLabel(/Сграда|Building/i)).not.toHaveValue("");
      await expect(dialog.getByLabel(/Етаж|Floor/i)).not.toHaveValue("");
      await dialog.getByLabel(/Номер \/ име|Number \/ name/i).fill(stamp);
      await dialog
        // Drive the browser through the user-visible workflow step.
        .getByRole("button", { name: /Запази промените|Save changes/i })
        .click();
      await expect(dialog).toHaveCount(0, { timeout: 20_000 });

      const search = page.getByPlaceholder(/Номер \/ сграда|Number \/ building/i);
      await search.fill(stamp);
      await expect(page.getByText(stamp, { exact: true })).toBeVisible({
        timeout: 20_000,
      });

      const listed = await apiGet(
        token,
        `/locations?paged=true&page=1&pageSize=25&q=${encodeURIComponent(stamp)}&includeArchived=true`,
      );
      expect(listed.status).toBe(200);
      const body = listed.body as {
        items: Array<{ id: string; number: string }>;
      };
      const hit = body.items.find((r) => r.number === stamp);
      expect(hit?.id).toBeTruthy();
      createdId = hit!.id;
    } finally {
      if (createdId) {
        await apiPost(token, `/locations/${createdId}/archive`, {});
      }
    }
  });

  // Case: sector picker shows archived tag for archived membership rooms.
  test("sector picker shows archived tag for archived membership rooms", async ({
    page,
  }) => {
    const { token } = await ownerApi();
    const stamp = `E2E-A-${Date.now().toString(36).slice(-5)}`;
    const uniqueName = `ArchTag ${stamp}`;

    const hier = await apiGet(token, "/locations/hierarchy");
    expect(hier.status).toBe(200);
    const buildings = hier.body as Array<{
      floors: Array<{ id: string }>;
    }>;
    const floorId = buildings[0]?.floors[0]?.id;
    expect(floorId).toBeTruthy();

    // createdLoc: seeded entity required before the mutation under test.
    const createdLoc = await apiPost(token, "/locations", {
      floorId,
      number: stamp,
      kind: "room",
    });
    expect(createdLoc.status).toBe(201);
    const locId = (createdLoc.body as { id: string }).id;

    const sectors = await apiGet(token, "/sectors?includeInactive=true");
    expect(sectors.status).toBe(200);
    const list = sectors.body as Array<{
      id: string;
      isActive: boolean;
      version: number;
    }>;
    const sector = list.find((s) => s.isActive);
    expect(sector).toBeTruthy();

    const detail = await apiGet(token, `/sectors/${sector!.id}`);
    expect(detail.status).toBe(200);
    const body = detail.body as {
      version: number;
      locationIds: string[];
      code: string;
      nameBg: string | null;
      nameEn: string | null;
      primarySupervisorEmployeeId: string | null;
    };
    const originalLocationIds = [...(body.locationIds ?? [])];
    const locationIds = [...new Set([...originalLocationIds, locId])];
    const renamed = await apiPatch(token, `/sectors/${sector!.id}`, {
      nameBg: uniqueName,
      nameEn: body.nameEn ?? uniqueName,
      locationIds,
      expectedVersion: body.version,
    });
    expect(renamed.status).toBe(200);

    await apiPost(token, `/locations/${locId}/archive`, {});

    try {
      await uiLogin(page, USERS.manager, DEMO_PASSWORD);
      await openNav(page, /Почистване|Housekeeping/);
      await page.getByRole("tab", { name: /Сектори|Sectors/i }).click();

      const row = page.getByRole("row").filter({ hasText: uniqueName });
      await row.getByRole("button", { name: /Редакция|Edit/i }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();

      await dialog.getByPlaceholder(/Търсене|Search/i).fill(stamp);
      await expect(dialog.getByText(stamp, { exact: false })).toBeVisible({
        timeout: 15_000,
      });
      await expect(dialog.getByText(/архив|archived/i).first()).toBeVisible({
        timeout: 10_000,
      });
    } finally {
      const latest = await apiGet(token, `/sectors/${sector!.id}`);
      const latestBody = latest.body as { version: number };
      await apiPatch(token, `/sectors/${sector!.id}`, {
        nameBg: body.nameBg ?? body.code,
        nameEn: body.nameEn ?? body.code,
        locationIds: originalLocationIds,
        expectedVersion: latestBody.version,
      });
      await apiPost(token, `/locations/${locId}/restore`, {});
      await apiPost(token, `/locations/${locId}/archive`, {});
    }
  });

  // Case: shifts: add shift opens centered modal.
  test("shifts: add shift opens centered modal", async ({ page }) => {
    await uiLogin(page, USERS.manager, DEMO_PASSWORD);
    await openNav(page, /Почистване|Housekeeping/);
    await page.getByRole("tab", { name: /Смени|Shifts/i }).click();

    const add = page.getByRole("button", {
      name: /\+ Добави смяна|\+ Add shift/i,
    });
    await expect(add).toBeVisible({ timeout: 20_000 });
    await add.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", {
        name: /Добавяне на смяна|Add shift/i,
      }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });
});
