// Playwright test runner APIs for browser E2E scenarios.
import { expect, test, type Page } from "@playwright/test";
// Import bindings from ../helpers/auth.
import { uiLogin, USERS } from "../helpers/auth";
// Import bindings from ../helpers/nav.
import { openNav } from "../helpers/nav";
// Local helper mutation used by cases in this file.
async function mutation(page: Page, method: string, path: string, data?: unknown) {
  // csrf: credential/token material for auth flows.
  const csrf = (await page.context().cookies()).find(c => c.name === "csrf")?.value;
  // res: HTTP response captured for status/body checks.
  const res = await page.request.fetch(`/api${path}`, { method, data, headers: { "X-CSRF-Token": csrf ?? "" } });
  // Assert response/page reached the expected status.
  expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBe(true); return res.json();
}
/** PATCH /settings/:key with the current row version (required CAS token). */
async function patchSetting(
  // Execute the next setup or assertion step for this scenario.
  page: Page,
  // Execute the next setup or assertion step for this scenario.
  key: string,
  // Execute the next setup or assertion step for this scenario.
  value: unknown,
  // Execute the next setup or assertion step for this scenario.
  reason: string,
// Execute the next setup or assertion step for this scenario.
) {
  // settings: HTTP response captured for status/body checks.
  const settings = await (await page.request.get("/api/settings")).json();
  // Bind expectedVersion for later setup or assertions in this scope.
  const expectedVersion = settings[key]?.version;
  // Assert browser/UI outcome matches the scenario intent.
  expect(typeof expectedVersion, `settings.${key}.version`).toBe("number");
  // Return the arranged value/result to the caller.
  return mutation(page, "PATCH", `/settings/${key}`, {
    // Execute the next setup or assertion step for this scenario.
    value,
    // Execute the next setup or assertion step for this scenario.
    reason,
    // Execute the next setup or assertion step for this scenario.
    expectedVersion,
  });
}
// Local helper room used by cases in this file.
async function room(page: Page, suffix: string) {
  // hierarchy: HTTP response captured for status/body checks.
  const hierarchy = await (await page.request.get("/api/locations/hierarchy")).json();
  // Return the arranged value/result to the caller.
  return mutation(page, "POST", "/locations", { floorId: hierarchy[0].floors[0].id, number: `SC-${suffix}-${Date.now()}`, occupancy: "vacant", kind: "room" });
}
// Case: real invitation UI suppresses repeat submit and activates with cookie-only secrets.
test("real invitation UI suppresses repeat submit and activates with cookie-only secrets", async ({ page, browser }) => {
  // Drive the browser through the user-visible workflow step.
  await uiLogin(page, USERS.owner); await openNav(page, /Екип|Team/); await page.getByRole("button", { name: "Onboarding", exact: true }).click();
  // id: unique stamp so parallel runs do not collide.
  const id = crypto.randomUUID(); const email = `${id}@e2e.test`;
  // Await async work before asserting or releasing locks.
  await page.getByLabel(/Име|Full name/, { exact: true }).fill(`Scenario ${id}`); await page.getByLabel(/Служебен номер|Employee number/, { exact: true }).fill(id); await page.getByLabel("Email", { exact: true }).fill(email);
  // Execute the next setup or assertion step for this scenario.
  let release!: () => void; const gate = new Promise<void>(r => { release = r; }); let requests = 0;
  // Await async work before asserting or releasing locks.
  await page.route("**/api/invitations", async route => { if (route.request().method() !== "POST") return route.continue(); requests++; await gate; await route.fulfill({ response: await route.fetch() }); });
  // Drive the browser through the user-visible workflow step.
  await page.getByRole("button", { name: /Издай код|Issue code/, exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  // Assert UI visibility/state after the user action.
  await expect.poll(() => requests).toBe(1); await expect(page.getByRole("button", { name: /Издаване|Issuing/ })).toBeDisabled(); release();
  // Assert UI visibility/state after the user action.
  await expect(page.locator(".invite-code")).toBeVisible(); const code = (await page.locator(".invite-code").textContent())!.trim(); expect(requests).toBe(1);
  // rejected: HTTP response captured for status/body checks.
  const rejected = await page.request.post("/api/auth/login", { data: { email, password: "scenario-password" } }); expect(rejected.status()).toBe(403);
  // context: synchronize actors so the race window is observable.
  const context = await browser.newContext(); const activation = await context.newPage();
  // Try path where partial failure must not leak suite state.
  try {
    // Await async work before asserting or releasing locks.
    await activation.goto(`http://127.0.0.1:5185/#/activate?code=${code}`);
    // Assert UI visibility/state after the user action.
    await expect(activation.getByRole("heading", { name: "Activate device" })).toBeVisible();
    // Assert UI visibility/state after the user action.
    await activation.getByRole("button", { name: "Activate", exact: true }).click(); await expect(activation.getByText(/Password of at least 8 characters/)).toBeVisible();
    // Await async work before asserting or releasing locks.
    await activation.getByLabel(/Password.*required for first activation/).fill("scenario-password"); await activation.getByLabel("Confirm password", { exact: true }).fill("scenario-password");
    // Bind response for later setup or assertions in this scope.
    const response = activation.waitForResponse(r => r.url().includes("/invitations/redeem") && r.status() === 200);
    // Drive the browser through the user-visible workflow step.
    await activation.getByRole("button", { name: "Activate", exact: true }).click(); const body = await (await response).json();
    // Assert UI visibility/state after the user action.
    await expect(activation.getByRole("navigation", { name: "Main" })).toBeVisible(); expect(JSON.stringify(body)).not.toMatch(/"(?:password|passwordHash|accessToken|refreshToken|token)"\s*:/);
    // readable: synchronize actors so the race window is observable.
    const readable = await activation.evaluate(async () => {
      // databases: synchronize actors so the race window is observable.
      const databases = await indexedDB.databases(); const rows: unknown[] = [];
      // Iterate to cover variants or wait until a condition holds.
      for (const database of databases) await new Promise<void>((resolve, reject) => { const r = indexedDB.open(database.name!); r.onerror = () => reject(r.error); r.onsuccess = () => { const db = r.result; const names = [...db.objectStoreNames]; if (!names.length) { db.close(); resolve(); return; } const tx = db.transaction(names); for (const name of names) { const get = tx.objectStore(name).getAll(); get.onsuccess = () => rows.push(...get.result); } tx.oncomplete = () => { db.close(); resolve(); }; }; });
      // Return the arranged value/result to the caller.
      return JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie, rows });
    });
    // Assert browser/UI outcome matches the scenario intent.
    expect(readable).not.toContain("scenario-password"); expect(readable).not.toMatch(/"(?:passwordHash|accessToken|refreshToken)"|session=eyJ|refresh=/);
    // Assert browser/UI outcome matches the scenario intent.
    for (const name of ["session", "refresh"]) expect((await context.cookies()).find(c => c.name === name)?.httpOnly).toBe(true);
  // Await async work before asserting or releasing locks.
  } finally { await context.close(); }
});
// Case: invitation activate from login screen with manual code entry (no QR, no hash prefill).
test("invitation activate from login screen with manual code entry (no QR, no hash prefill)", async ({ page, browser }) => {
  // Drive the browser through the user-visible workflow step.
  await uiLogin(page, USERS.owner); await openNav(page, /Екип|Team/); await page.getByRole("button", { name: "Onboarding", exact: true }).click();
  // id: unique stamp so parallel runs do not collide.
  const id = crypto.randomUUID(); const email = `${id}@e2e.manual.test`;
  // Await async work before asserting or releasing locks.
  await page.getByLabel(/Име|Full name/, { exact: true }).fill(`Manual ${id}`);
  // Await async work before asserting or releasing locks.
  await page.getByLabel(/Служебен номер|Employee number/, { exact: true }).fill(`M-${id.slice(0, 8)}`);
  // Await async work before asserting or releasing locks.
  await page.getByLabel("Email", { exact: true }).fill(email);
  // Drive the browser through the user-visible workflow step.
  await page.getByRole("button", { name: /Издай код|Issue code/, exact: true }).click();
  // Assert UI visibility/state after the user action.
  await expect(page.locator(".invite-code")).toBeVisible();
  // code: synchronize actors so the race window is observable.
  const code = (await page.locator(".invite-code").textContent())!.trim();
  // Assert browser/UI outcome matches the scenario intent.
  expect(code.length).toBeGreaterThan(4);

  // context: synchronize actors so the race window is observable.
  const context = await browser.newContext();
  // activation: synchronize actors so the race window is observable.
  const activation = await context.newPage();
  // Try path where partial failure must not leak suite state.
  try {
    // Await async work before asserting or releasing locks.
    await activation.goto("http://127.0.0.1:5185/");
    // Assert UI visibility/state after the user action.
    await expect(activation.getByRole("button", { name: /Вход|Sign in/, exact: true })).toBeVisible();
    // Drive the browser through the user-visible workflow step.
    await activation.getByRole("button", { name: "Activate device", exact: true }).click();
    // Assert browser/UI outcome matches the scenario intent.
    await expect(activation).toHaveURL(/#\/activate(?!\?)/);
    // Assert UI visibility/state after the user action.
    await expect(activation.getByRole("heading", { name: "Activate device" })).toBeVisible();
    // Assert browser/UI outcome matches the scenario intent.
    await expect(activation.getByLabel("Invitation code", { exact: true })).toHaveValue("");
    // Await async work before asserting or releasing locks.
    await activation.getByLabel("Invitation code", { exact: true }).fill(code);
    // Await async work before asserting or releasing locks.
    await activation.getByLabel(/Password.*required for first activation/).fill("manual-activate-1");
    // Await async work before asserting or releasing locks.
    await activation.getByLabel("Confirm password", { exact: true }).fill("manual-activate-1");
    // Bind response for later setup or assertions in this scope.
    const response = activation.waitForResponse(r => r.url().includes("/invitations/redeem") && r.status() === 200);
    // Drive the browser through the user-visible workflow step.
    await activation.getByRole("button", { name: "Activate", exact: true }).click();
    // Await async work before asserting or releasing locks.
    await response;
    // Assert UI visibility/state after the user action.
    await expect(activation.getByRole("navigation", { name: "Main" })).toBeVisible();
  // Execute the next setup or assertion step for this scenario.
  } finally {
    // Await async work before asserting or releasing locks.
    await context.close();
  }
});
// Case: real queued report reloads then single-flight sync replaces optimistic row.
test("real queued report reloads then single-flight sync replaces optimistic row", async ({ page }) => {
  // Drive the browser through the user-visible workflow step.
  await uiLogin(page, USERS.owner); const target = await room(page, "OFFLINE"); await openNav(page, /Повреди|Repairs/);
  // Await async work before asserting or releasing locks.
  await page.getByLabel(/Стая|Room/, { exact: true }).selectOption(target.id);
  // Await async work before asserting or releasing locks.
  await page.getByLabel(/Опция|Option/, { exact: true }).selectOption({ index: 0 });
  // Repairs is catalog-only — unique marker lives in clarification, not Title.
  const marker = `QUEUED-${crypto.randomUUID()}`;
  // Await async work before asserting or releasing locks.
  await page.getByLabel(/Уточнение|Clarification/).fill(marker);
  // Await async work before asserting or releasing locks.
  await page.addInitScript(() => Object.defineProperty(navigator, "onLine", { configurable: true, value: false }));
  // Await async work before asserting or releasing locks.
  await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { configurable: true, value: false }); window.dispatchEvent(new Event("offline")); });
  // Assert UI visibility/state after the user action.
  await page.getByRole("button", { name: /Докладвай|Report/, exact: true }).click(); await expect(page.getByText(/Докладът е в опашката|Report queued for sync/)).toBeVisible();
  // Assert response/page reached the expected status.
  expect((await (await page.request.get(`/api/maintenance/tickets?locationId=${target.id}&status=all`)).json()).filter((r: any) => (r.description ?? "").includes(marker))).toHaveLength(0);
  // queued: synchronize actors so the race window is observable.
  const queued = await page.evaluate(async () => (await import(/* @vite-ignore */ "/src/offline/queueOps.ts")).listQueuedActions()); expect(queued).toHaveLength(1); const commandId = queued[0].commandId;
  // Assert browser/UI outcome matches the scenario intent.
  expect(JSON.stringify(queued[0].body)).toContain(marker);
  // Await async work before asserting or releasing locks.
  await page.reload(); await openNav(page, /Повреди|Repairs/);
  // Assert browser/UI outcome matches the scenario intent.
  expect(await page.evaluate(async () => (await import(/* @vite-ignore */ "/src/offline/queueOps.ts")).listQueuedActions())).toHaveLength(1);
  // Await async work before asserting or releasing locks.
  await page.evaluate(() => { const w = window as any; w.__MERIDIAN_E2E_AFTER_DRAIN_CLAIM__ = () => new Promise<void>(r => { w.claimed = true; w.releaseClaim = r; }); Object.defineProperty(navigator, "onLine", { configurable: true, value: true }); window.dispatchEvent(new Event("online")); });
  // Await async work before asserting or releasing locks.
  await expect.poll(() => page.evaluate(() => (window as any).claimed)).toBe(true);
  // Bind sends for later setup or assertions in this scope.
  let sends = 0; page.on("request", req => { if (req.url().includes("/sync/push") && req.postData()?.includes(commandId)) sends++; });
  // Run actors together to expose races and serialization bugs.
  await page.evaluate(async () => { const m = await import(/* @vite-ignore */ "/src/offline/queueDrain.ts"); await Promise.all([m.drainQueue(), m.drainQueue(), m.drainQueue()]); (window as any).releaseClaim(); });
  // Await async work before asserting or releasing locks.
  await expect.poll(() => page.evaluate(async () => (await import(/* @vite-ignore */ "/src/offline/queueOps.ts")).listQueuedActions())).toEqual([]);
  // Assert response/page reached the expected status.
  expect(sends).toBe(1);
  // tickets: HTTP response captured for status/body checks.
  const tickets = await (await page.request.get(`/api/maintenance/tickets?locationId=${target.id}&status=all`)).json();
  // Bind matched for later setup or assertions in this scope.
  const matched = tickets.filter((r: any) => (r.description ?? "").includes(marker));
  // Assert browser/UI outcome matches the scenario intent.
  expect(matched).toHaveLength(1); expect(matched[0].id).not.toMatch(/^local-/);
  // events: HTTP response captured for status/body checks.
  const events = await (await page.request.get(`/api/maintenance/tickets/${matched[0].id}/events`)).json(); expect(events).toHaveLength(1);
  // Await async work before asserting or releasing locks.
  await page.reload(); await openNav(page, /Повреди|Repairs/);
  // Room number is unique per run; catalog titles collide across prior SC-OFFLINE-* tickets.
  await expect(
    // Execute the next setup or assertion step for this scenario.
    page.locator("tr").filter({ hasText: target.number }).filter({ hasText: matched[0].title }),
  // Execute the next setup or assertion step for this scenario.
  ).toHaveCount(1);
});
// Case: card type switches send applicable fields; delayed double click commits one actual card.
test("card type switches send applicable fields; delayed double click commits one actual card", async ({ page }) => {
  // Drive the browser through the user-visible workflow step.
  await uiLogin(page, USERS.owner); await openNav(page, /Карти|Cards/);
  // Drive the browser through the user-visible workflow step.
  await page.getByRole("button", { name: "Гост", exact: true }).click(); await page.getByRole("button", { name: "Напред", exact: true }).click();
  // roomId: unique stamp so parallel runs do not collide.
  const roomId = await page.getByRole("combobox", { name: /^Стая/ }).locator("option").nth(1).getAttribute("value"); await page.getByRole("combobox", { name: /^Стая/ }).selectOption(roomId!);
  // Drive the browser through the user-visible workflow step.
  await page.getByRole("button", { name: "Назад", exact: true }).click(); await page.getByRole("button", { name: "Камериерка", exact: true }).click(); await page.getByRole("button", { name: "Напред", exact: true }).click();
  // employeeId: unique stamp so parallel runs do not collide.
  const employeeId = await page.getByRole("combobox", { name: /^Служител/ }).locator("option").nth(1).getAttribute("value"); await page.getByRole("combobox", { name: /^Служител/ }).selectOption(employeeId!); await page.getByLabel(/Локация \(опционално\)/).selectOption(roomId!);
  // Drive the browser through the user-visible workflow step.
  await page.getByRole("button", { name: "Назад", exact: true }).click(); await page.getByRole("button", { name: "Мастър", exact: true }).click(); await page.getByRole("button", { name: "Напред", exact: true }).click();
  // Assert UI visibility/state after the user action.
  await expect(page.getByRole("combobox", { name: /^Служител/ })).toHaveValue(""); await page.getByRole("combobox", { name: /^Служител/ }).selectOption(employeeId!);
  // label: unique stamp so parallel runs do not collide.
  const label = `CARD-${crypto.randomUUID()}`; await page.getByLabel("Етикет (опционално)").fill(label); await page.getByRole("button", { name: "Напред", exact: true }).click();
  // Execute the next setup or assertion step for this scenario.
  let release!: () => void; const gate = new Promise<void>(r => { release = r; }); const bodies: any[] = []; let card: any;
  // Await async work before asserting or releasing locks.
  await page.route("**/api/cards", async route => { if (route.request().method() !== "POST") return route.continue(); bodies.push(route.request().postDataJSON()); await gate; const response = await route.fetch(); card = await response.json(); await route.fulfill({ response }); });
  // Drive the browser through the user-visible workflow step.
  await page.getByRole("button", { name: "Запиши в системата", exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  // Assert UI visibility/state after the user action.
  await expect.poll(() => bodies.length).toBe(1); release(); await expect(page.getByText("Записано в системата", { exact: true }).first()).toBeVisible();
  // Assert browser/UI outcome matches the scenario intent.
  expect(bodies[0]).toMatchObject({ cardType: "master", employeeId, locationId: null, label }); expect(bodies[0].validFrom).toBeTruthy(); expect(bodies[0].validUntil).toBeTruthy();
  // rows: HTTP response captured for status/body checks.
  const rows = await (await page.request.get("/api/cards?staffOnly=true")).json(); const list = Array.isArray(rows) ? rows : rows.cards; expect(list.filter((r: any) => r.label === label)).toHaveLength(1);
});
// Case: Rooms uses saved task due hours without changing an existing task.
test("Rooms uses saved task due hours without changing an existing task", async ({ page }) => {
  // Define an individual test case.
  test.setTimeout(90_000);
  // Drive the browser through the user-visible workflow step.
  await uiLogin(page, USERS.owner);
  // settings: HTTP response captured for status/body checks.
  const settings = await (await page.request.get("/api/settings")).json();
  // Bind original for later setup or assertions in this scope.
  const original = settings.operations.value;
  // a: synchronize actors so the race window is observable.
  const a = await room(page, "DUE-A");
  // b: synchronize actors so the race window is observable.
  const b = await room(page, "DUE-B");
  // Create-task CTA is clearest on dirty rooms without an active task.
  await mutation(page, "POST", `/rooms/${a.id}/mark-dirty`, {});
  // Await async work before asserting or releasing locks.
  await mutation(page, "POST", `/rooms/${b.id}/mark-dirty`, {});
  // Board labels room cells as "<building> <number>", so exact number match misses the row.
  const createTask = /Създай задача|Create task/;
  // Bind row for later setup or assertions in this scope.
  const row = (number: string) => page.locator("tbody tr").filter({ hasText: number });
  // Bind findRoom for later setup or assertions in this scope.
  const findRoom = async (number: string) => {
    // Await async work before asserting or releasing locks.
    await page.getByLabel(/Търсене|Search/).fill(number);
    // Assert UI visibility/state after the user action.
    await expect(row(number).getByRole("button", { name: createTask })).toBeVisible();
  };
  // Try path where partial failure must not leak suite state.
  try {
    // Await async work before asserting or releasing locks.
    await patchSetting(page, "operations", { ...original, defaultTaskDueHours: 2 }, "scenario due before");
    // Await async work before asserting or releasing locks.
    await page.reload();
    // Await async work before asserting or releasing locks.
    await openNav(page, /Стаи|Rooms/);
    // Await async work before asserting or releasing locks.
    await findRoom(a.number);
    // Bind beforeA for later setup or assertions in this scope.
    const beforeA = Date.now();
    // Drive the browser through the user-visible workflow step.
    await row(a.number).getByRole("button", { name: createTask }).click();
    // Assert UI visibility/state after the user action.
    await expect(row(a.number).getByRole("button", { name: createTask })).toHaveCount(0);
    // Bind hotelDate for later setup or assertions in this scope.
    const hotelDate = new Intl.DateTimeFormat("en-CA", {
      // Execute the next setup or assertion step for this scenario.
      timeZone: original.hotelTimezone,
      // Execute the next setup or assertion step for this scenario.
      year: "numeric",
      // Execute the next setup or assertion step for this scenario.
      month: "2-digit",
      // Execute the next setup or assertion step for this scenario.
      day: "2-digit",
    // Execute the next setup or assertion step for this scenario.
    }).format(new Date());
    // taskA: HTTP response captured for status/body checks.
    const taskA = (await (await page.request.get(`/api/cleaning/tasks?hotelDate=${hotelDate}`)).json())
      // Continue the call chain for setup or assertion detail.
      .find((t: any) => t.locationId === a.id);
    // Assert browser/UI outcome matches the scenario intent.
    expect(taskA, "task A created").toBeTruthy();
    // Assert browser/UI outcome matches the scenario intent.
    expect(Math.abs(new Date(taskA.dueAt).getTime() - beforeA - 2 * 3600000)).toBeLessThan(10000);
    // Await async work before asserting or releasing locks.
    await patchSetting(page, "operations", { ...original, defaultTaskDueHours: 7 }, "scenario due after");
    // Await async work before asserting or releasing locks.
    await page.reload();
    // Await async work before asserting or releasing locks.
    await openNav(page, /Стаи|Rooms/);
    // Await async work before asserting or releasing locks.
    await findRoom(b.number);
    // Bind beforeB for later setup or assertions in this scope.
    const beforeB = Date.now();
    // Drive the browser through the user-visible workflow step.
    await row(b.number).getByRole("button", { name: createTask }).click();
    // Assert UI visibility/state after the user action.
    await expect(row(b.number).getByRole("button", { name: createTask })).toHaveCount(0);
    // tasks: HTTP response captured for status/body checks.
    const tasks = await (await page.request.get(`/api/cleaning/tasks?hotelDate=${taskA.hotelDate.slice(0, 10)}`)).json();
    // Bind taskB for later setup or assertions in this scope.
    const taskB = tasks.find((t: any) => t.locationId === b.id);
    // Bind old for later setup or assertions in this scope.
    const old = tasks.find((t: any) => t.id === taskA.id);
    // Assert browser/UI outcome matches the scenario intent.
    expect(taskB, "task B created").toBeTruthy();
    // Assert browser/UI outcome matches the scenario intent.
    expect(Math.abs(new Date(taskB.dueAt).getTime() - beforeB - 7 * 3600000)).toBeLessThan(10000);
    // Assert browser/UI outcome matches the scenario intent.
    expect(old.dueAt).toBe(taskA.dueAt);
  // Execute the next setup or assertion step for this scenario.
  } finally {
    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await patchSetting(page, "operations", original, "scenario restore");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Execute the next setup or assertion step for this scenario.
      console.warn("operations restore failed", err);
    }
  }
});
// Case: rapid report clicks preserve one logical queued report.
test("rapid report clicks preserve one logical queued report", async ({ page }) => {
  // Drive the browser through the user-visible workflow step.
  await uiLogin(page, USERS.owner); await openNav(page, /Повреди|Repairs/);
  // Await async work before asserting or releasing locks.
  await page.getByLabel(/Опция|Option/, { exact: true }).selectOption({ index: 0 });
  // Await async work before asserting or releasing locks.
  await page.getByLabel(/Уточнение|Clarification/).fill(`DOUBLE-${crypto.randomUUID()}`);
  // Await async work before asserting or releasing locks.
  await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { configurable: true, value: false }); window.dispatchEvent(new Event("offline")); });
  // Drive the browser through the user-visible workflow step.
  await page.getByRole("button", { name: /Докладвай|Report/, exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  // Assert UI visibility/state after the user action.
  await expect(page.getByText(/Докладът е в опашката|Report queued for sync/)).toBeVisible();
  // rows: synchronize actors so the race window is observable.
  const rows = await page.evaluate(async () => (await import(/* @vite-ignore */ "/src/offline/queueOps.ts")).listQueuedActions()); expect(rows).toHaveLength(1);
});
// Case: report UI shows storage quota failure without queued success or optimistic row.
test("report UI shows storage quota failure without queued success or optimistic row", async ({ page }) => {
  // Drive the browser through the user-visible workflow step.
  await uiLogin(page, USERS.owner); await openNav(page, /Повреди|Repairs/);
  // Await async work before asserting or releasing locks.
  await page.getByLabel(/Опция|Option/, { exact: true }).selectOption({ index: 0 });
  // marker: unique stamp so parallel runs do not collide.
  const marker = `QUOTA-${crypto.randomUUID()}`;
  // Await async work before asserting or releasing locks.
  await page.getByLabel(/Уточнение|Clarification/).fill(marker);
  // Await async work before asserting or releasing locks.
  await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { configurable: true, value: false }); window.dispatchEvent(new Event("offline")); IDBObjectStore.prototype.put = function () { throw new DOMException("Storage quota exceeded", "QuotaExceededError"); }; });
  // Drive the browser through the user-visible workflow step.
  await page.getByRole("button", { name: /Докладвай|Report/, exact: true }).click();
  // Assert UI visibility/state after the user action.
  await expect(page.getByText(/Storage quota exceeded/)).toBeVisible();
  // Assert UI visibility/state after the user action.
  await expect(page.getByText(/Докладът е в опашката|Report queued for sync/)).toHaveCount(0);
  // Assert browser/UI outcome matches the scenario intent.
  expect(await page.evaluate(async () => (await import(/* @vite-ignore */ "/src/offline/queueOps.ts")).listQueuedActions())).toHaveLength(0);
});
// Case: disabling current module selects allowed panel and remains hidden after reload.
test("disabling current module selects allowed panel and remains hidden after reload", async ({ page }) => {
  // Drive the browser through the user-visible workflow step.
  await uiLogin(page, USERS.owner); const original = (await (await page.request.get("/api/settings")).json()).modules.value;
  // Try path where partial failure must not leak suite state.
  try {
    // Assert UI visibility/state after the user action.
    await openNav(page, /Присъствие|Attendance/); await expect(page.getByRole("heading", { name: /Присъствие|Attendance/ })).toBeVisible();
    // Await async work before asserting or releasing locks.
    await patchSetting(page, "modules", { ...original, attendance: false }, "scenario current module");
    // Assert UI visibility/state after the user action.
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /Присъствие|Attendance/ })).toHaveCount(0);
    // Assert UI visibility/state after the user action.
    await expect(page.getByRole("heading", { name: /Присъствие|Attendance/ })).toHaveCount(0);
    // Assert UI visibility/state after the user action.
    await page.reload(); await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible(); await expect(page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /Присъствие|Attendance/ })).toHaveCount(0);
  // Await async work before asserting or releasing locks.
  } finally { await patchSetting(page, "modules", original, "scenario restore"); }
});
// Case: legacy room-QR hash clears without calling retired by-qr API.
test("legacy room-QR hash clears without calling retired by-qr API", async ({ page }) => {
  // Drive the browser through the user-visible workflow step.
  await uiLogin(page, USERS.owner);
  // Bind byQrHits for later setup or assertions in this scope.
  let byQrHits = 0;
  // Execute the next setup or assertion step for this scenario.
  page.on("request", (request) => {
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (request.url().includes("/locations/by-qr/")) byQrHits++;
  });
  // Drive the browser through the user-visible workflow step.
  await page.goto("/#/room-qr/legacy-retired-token");
  // Assert UI visibility/state after the user action.
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  // Await async work before asserting or releasing locks.
  await expect.poll(() => page.evaluate(() => window.location.hash)).not.toMatch(/room-qr/);
  // Assert response/page reached the expected status.
  expect(byQrHits).toBe(0);
  // Assert response/page reached the expected status.
  expect((await page.request.get("/api/locations/by-qr/legacy-retired-token")).status()).toBe(404);
});
// Case checks authz/session policy: app logout aborts its shared live stream and never reconnects.
test("app logout aborts its shared live stream and never reconnects", async ({ page }) => {
  // Execute the next setup or assertion step for this scenario.
  const streams: import("@playwright/test").Request[] = []; const finished = new Set<import("@playwright/test").Request>();
  // Execute the next setup or assertion step for this scenario.
  page.on("request", request => { if (request.url().includes("/events/stream")) streams.push(request); });
  // Execute the next setup or assertion step for this scenario.
  page.on("requestfailed", request => { finished.add(request); }); page.on("requestfinished", request => { finished.add(request); });
  // Drive the browser through the user-visible workflow step.
  await uiLogin(page, USERS.owner); await openNav(page, /Повреди|Repairs/); await expect.poll(() => streams.length).toBe(1);
  // Assert UI visibility/state after the user action.
  await page.getByRole("button", { name: "Log out", exact: true }).click(); await expect(page.getByRole("button", { name: /Вход|Sign in/, exact: true })).toBeVisible();
  // Await async work before asserting or releasing locks.
  await expect.poll(() => finished.has(streams[0]!)).toBe(true); const count = streams.length;
  // Assert browser/UI outcome matches the scenario intent.
  await page.clock.install(); await page.clock.fastForward(60000); expect(streams.length).toBe(count);
});
// Iterate to cover variants or wait until a condition holds.
for (const type of ["guest", "housekeeper"] as const) test(`switch from master to ${type} sends exact holder, room and selected validity`, async ({ page }) => {
  // Drive the browser through the user-visible workflow step.
  await uiLogin(page, USERS.owner); await openNav(page, /Карти|Cards/);
  // Drive the browser through the user-visible workflow step.
  await page.getByRole("button", { name: "Мастър", exact: true }).click(); await page.getByRole("button", { name: "Напред", exact: true }).click();
  // employeeId: unique stamp so parallel runs do not collide.
  const employeeId = (await page.getByRole("combobox", { name: /^Служител/ }).locator("option").nth(1).getAttribute("value"))!; await page.getByRole("combobox", { name: /^Служител/ }).selectOption(employeeId);
  // Drive the browser through the user-visible workflow step.
  await page.getByRole("button", { name: "Назад", exact: true }).click(); await page.getByRole("button", { name: type === "guest" ? "Гост" : "Камериерка", exact: true }).click(); await page.getByRole("button", { name: "Напред", exact: true }).click();
  // Bind select for later setup or assertions in this scope.
  const select = type === "guest" ? page.getByRole("combobox", { name: /^Стая/ }) : page.getByLabel(/Локация \(опционално\)/);
  // locationId: unique stamp so parallel runs do not collide.
  const locationId = (await select.locator("option").nth(1).getAttribute("value"))!; await select.selectOption(locationId);
  // Assert UI visibility/state after the user action.
  if (type === "housekeeper") { await expect(page.getByRole("combobox", { name: /^Служител/ })).toHaveValue(""); await page.getByRole("combobox", { name: /^Служител/ }).selectOption(employeeId); }
  // Await async work before asserting or releasing locks.
  await page.getByLabel("Валидна от", { exact: true }).fill("2027-01-02T03:04"); await page.getByLabel("Валидна до", { exact: true }).fill("2027-01-03T05:06");
  // expectedDates: synchronize actors so the race window is observable.
  const expectedDates = await page.evaluate(() => ({ validFrom: new Date("2027-01-02T03:04").toISOString(), validUntil: new Date("2027-01-03T05:06").toISOString() }));
  // Drive the browser through the user-visible workflow step.
  await page.getByRole("button", { name: "Напред", exact: true }).click(); const request = page.waitForRequest(r => r.url().endsWith("/api/cards") && r.method() === "POST");
  // Assert UI visibility/state after the user action.
  await page.getByRole("button", { name: "Запиши в системата", exact: true }).click(); expect((await request).postDataJSON()).toMatchObject({ cardType: type, employeeId: type === "guest" ? null : employeeId, locationId, ...expectedDates });
  // Assert UI visibility/state after the user action.
  await expect(page.getByText("Записано в системата", { exact: true }).first()).toBeVisible();
});
