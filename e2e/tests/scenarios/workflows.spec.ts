import { expect, test, type Page } from "@playwright/test";
import { uiLogin, USERS } from "../helpers/auth";
import { openNav } from "../helpers/nav";
async function mutation(page: Page, method: string, path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find(c => c.name === "csrf")?.value;
  const res = await page.request.fetch(`/api${path}`, { method, data, headers: { "X-CSRF-Token": csrf ?? "" } });
  expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBe(true); return res.json();
}
/** PATCH /settings/:key with the current row version (required CAS token). */
async function patchSetting(
  page: Page,
  key: string,
  value: unknown,
  reason: string,
) {
  const settings = await (await page.request.get("/api/settings")).json();
  const expectedVersion = settings[key]?.version;
  expect(typeof expectedVersion, `settings.${key}.version`).toBe("number");
  return mutation(page, "PATCH", `/settings/${key}`, {
    value,
    reason,
    expectedVersion,
  });
}
async function room(page: Page, suffix: string) {
  const hierarchy = await (await page.request.get("/api/locations/hierarchy")).json();
  return mutation(page, "POST", "/locations", { floorId: hierarchy[0].floors[0].id, number: `SC-${suffix}-${Date.now()}`, occupancy: "vacant", kind: "room" });
}
test("P1-85 P1-89 P1-129 P2-48 real invitation UI suppresses repeat submit and activates with cookie-only secrets", async ({ page, browser }) => {
  await uiLogin(page, USERS.owner); await openNav(page, /Екип|Team/); await page.getByRole("button", { name: "Onboarding", exact: true }).click();
  const id = crypto.randomUUID(); const email = `${id}@e2e.test`;
  await page.getByLabel(/Име|Full name/, { exact: true }).fill(`Scenario ${id}`); await page.getByLabel(/Служебен номер|Employee number/, { exact: true }).fill(id); await page.getByLabel("Email", { exact: true }).fill(email);
  let release!: () => void; const gate = new Promise<void>(r => { release = r; }); let requests = 0;
  await page.route("**/api/invitations", async route => { if (route.request().method() !== "POST") return route.continue(); requests++; await gate; await route.fulfill({ response: await route.fetch() }); });
  await page.getByRole("button", { name: /Издай код|Issue code/, exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect.poll(() => requests).toBe(1); await expect(page.getByRole("button", { name: /Издаване|Issuing/ })).toBeDisabled(); release();
  await expect(page.locator(".invite-code")).toBeVisible(); const code = (await page.locator(".invite-code").textContent())!.trim(); expect(requests).toBe(1);
  const rejected = await page.request.post("/api/auth/login", { data: { email, password: "scenario-password" } }); expect(rejected.status()).toBe(403);
  const context = await browser.newContext(); const activation = await context.newPage();
  try {
    await activation.goto(`http://127.0.0.1:5185/#/activate?code=${code}`);
    await expect(activation.getByRole("heading", { name: "Activate device" })).toBeVisible();
    await activation.getByRole("button", { name: "Activate", exact: true }).click(); await expect(activation.getByText(/Password of at least 8 characters/)).toBeVisible();
    await activation.getByLabel(/Password.*required for first activation/).fill("scenario-password"); await activation.getByLabel("Confirm password", { exact: true }).fill("scenario-password");
    const response = activation.waitForResponse(r => r.url().includes("/invitations/redeem") && r.status() === 200);
    await activation.getByRole("button", { name: "Activate", exact: true }).click(); const body = await (await response).json();
    await expect(activation.getByRole("navigation", { name: "Main" })).toBeVisible(); expect(JSON.stringify(body)).not.toMatch(/"(?:password|passwordHash|accessToken|refreshToken|token)"\s*:/);
    const readable = await activation.evaluate(async () => {
      const databases = await indexedDB.databases(); const rows: unknown[] = [];
      for (const database of databases) await new Promise<void>((resolve, reject) => { const r = indexedDB.open(database.name!); r.onerror = () => reject(r.error); r.onsuccess = () => { const db = r.result; const names = [...db.objectStoreNames]; if (!names.length) { db.close(); resolve(); return; } const tx = db.transaction(names); for (const name of names) { const get = tx.objectStore(name).getAll(); get.onsuccess = () => rows.push(...get.result); } tx.oncomplete = () => { db.close(); resolve(); }; }; });
      return JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie, rows });
    });
    expect(readable).not.toContain("scenario-password"); expect(readable).not.toMatch(/"(?:passwordHash|accessToken|refreshToken)"|session=eyJ|refresh=/);
    for (const name of ["session", "refresh"]) expect((await context.cookies()).find(c => c.name === name)?.httpOnly).toBe(true);
  } finally { await context.close(); }
});
test("invitation activate from login screen with manual code entry (no QR, no hash prefill)", async ({ page, browser }) => {
  await uiLogin(page, USERS.owner); await openNav(page, /Екип|Team/); await page.getByRole("button", { name: "Onboarding", exact: true }).click();
  const id = crypto.randomUUID(); const email = `${id}@e2e.manual.test`;
  await page.getByLabel(/Име|Full name/, { exact: true }).fill(`Manual ${id}`);
  await page.getByLabel(/Служебен номер|Employee number/, { exact: true }).fill(`M-${id.slice(0, 8)}`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: /Издай код|Issue code/, exact: true }).click();
  await expect(page.locator(".invite-code")).toBeVisible();
  const code = (await page.locator(".invite-code").textContent())!.trim();
  expect(code.length).toBeGreaterThan(4);

  const context = await browser.newContext();
  const activation = await context.newPage();
  try {
    await activation.goto("http://127.0.0.1:5185/");
    await expect(activation.getByRole("button", { name: /Вход|Sign in/, exact: true })).toBeVisible();
    await activation.getByRole("button", { name: "Activate device", exact: true }).click();
    await expect(activation).toHaveURL(/#\/activate(?!\?)/);
    await expect(activation.getByRole("heading", { name: "Activate device" })).toBeVisible();
    await expect(activation.getByLabel("Invitation code", { exact: true })).toHaveValue("");
    await activation.getByLabel("Invitation code", { exact: true }).fill(code);
    await activation.getByLabel(/Password.*required for first activation/).fill("manual-activate-1");
    await activation.getByLabel("Confirm password", { exact: true }).fill("manual-activate-1");
    const response = activation.waitForResponse(r => r.url().includes("/invitations/redeem") && r.status() === 200);
    await activation.getByRole("button", { name: "Activate", exact: true }).click();
    await response;
    await expect(activation.getByRole("navigation", { name: "Main" })).toBeVisible();
  } finally {
    await context.close();
  }
});
test("P1-95 P1-97 P1-109 P1-110 real queued report reloads then single-flight sync replaces optimistic row", async ({ page }) => {
  await uiLogin(page, USERS.owner); const target = await room(page, "OFFLINE"); await openNav(page, /Повреди|Repairs/);
  await page.getByLabel(/Стая|Room/, { exact: true }).selectOption(target.id); await page.getByLabel(/Опция|Option/, { exact: true }).selectOption({ index: 0 });
  const title = `QUEUED-${crypto.randomUUID()}`; await page.getByLabel(/Заглавие|Title/, { exact: true }).fill(title);
  await page.addInitScript(() => Object.defineProperty(navigator, "onLine", { configurable: true, value: false }));
  await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { configurable: true, value: false }); window.dispatchEvent(new Event("offline")); });
  await page.getByRole("button", { name: /Докладвай|Report/, exact: true }).click(); await expect(page.getByText(/Докладът е в опашката|Report queued for sync/)).toBeVisible();
  expect((await (await page.request.get(`/api/maintenance/tickets?locationId=${target.id}&status=all`)).json()).filter((r: any) => r.title === title)).toHaveLength(0);
  const queued = await page.evaluate(async () => (await import(/* @vite-ignore */ "/src/offline/queueOps.ts")).listQueuedActions()); expect(queued).toHaveLength(1); const commandId = queued[0].commandId;
  await page.reload(); await openNav(page, /Повреди|Repairs/);
  expect(await page.evaluate(async () => (await import(/* @vite-ignore */ "/src/offline/queueOps.ts")).listQueuedActions())).toHaveLength(1);
  await page.evaluate(() => { const w = window as any; w.__MERIDIAN_E2E_AFTER_DRAIN_CLAIM__ = () => new Promise<void>(r => { w.claimed = true; w.releaseClaim = r; }); Object.defineProperty(navigator, "onLine", { configurable: true, value: true }); window.dispatchEvent(new Event("online")); });
  await expect.poll(() => page.evaluate(() => (window as any).claimed)).toBe(true);
  let sends = 0; page.on("request", req => { if (req.url().includes("/sync/push") && req.postData()?.includes(commandId)) sends++; });
  await page.evaluate(async () => { const m = await import(/* @vite-ignore */ "/src/offline/queueDrain.ts"); await Promise.all([m.drainQueue(), m.drainQueue(), m.drainQueue()]); (window as any).releaseClaim(); });
  await expect.poll(() => page.evaluate(async () => (await import(/* @vite-ignore */ "/src/offline/queueOps.ts")).listQueuedActions())).toEqual([]);
  await expect(page.locator("tr").filter({ hasText: title })).toHaveCount(1); expect(sends).toBe(1);
  const tickets = await (await page.request.get(`/api/maintenance/tickets?locationId=${target.id}&status=all`)).json(); expect(tickets.filter((r: any) => r.title === title)).toHaveLength(1); expect(tickets[0].id).not.toMatch(/^local-/);
  const events = await (await page.request.get(`/api/maintenance/tickets/${tickets[0].id}/events`)).json(); expect(events).toHaveLength(1);
  await page.reload(); await openNav(page, /Повреди|Repairs/); await expect(page.locator("tr").filter({ hasText: title })).toHaveCount(1);
});
test("P2-44 P2-48 card type switches send applicable fields; delayed double click commits one actual card", async ({ page }) => {
  await uiLogin(page, USERS.owner); await openNav(page, /Карти|Cards/);
  await page.getByRole("button", { name: "Гост", exact: true }).click(); await page.getByRole("button", { name: "Напред", exact: true }).click();
  const roomId = await page.getByRole("combobox", { name: /^Стая/ }).locator("option").nth(1).getAttribute("value"); await page.getByRole("combobox", { name: /^Стая/ }).selectOption(roomId!);
  await page.getByRole("button", { name: "Назад", exact: true }).click(); await page.getByRole("button", { name: "Камериерка", exact: true }).click(); await page.getByRole("button", { name: "Напред", exact: true }).click();
  const employeeId = await page.getByRole("combobox", { name: /^Служител/ }).locator("option").nth(1).getAttribute("value"); await page.getByRole("combobox", { name: /^Служител/ }).selectOption(employeeId!); await page.getByLabel(/Локация \(опционално\)/).selectOption(roomId!);
  await page.getByRole("button", { name: "Назад", exact: true }).click(); await page.getByRole("button", { name: "Мастър", exact: true }).click(); await page.getByRole("button", { name: "Напред", exact: true }).click();
  await expect(page.getByRole("combobox", { name: /^Служител/ })).toHaveValue(""); await page.getByRole("combobox", { name: /^Служител/ }).selectOption(employeeId!);
  const label = `CARD-${crypto.randomUUID()}`; await page.getByLabel("Етикет (опционално)").fill(label); await page.getByRole("button", { name: "Напред", exact: true }).click();
  let release!: () => void; const gate = new Promise<void>(r => { release = r; }); const bodies: any[] = []; let card: any;
  await page.route("**/api/cards", async route => { if (route.request().method() !== "POST") return route.continue(); bodies.push(route.request().postDataJSON()); await gate; const response = await route.fetch(); card = await response.json(); await route.fulfill({ response }); });
  await page.getByRole("button", { name: "Запиши в системата", exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect.poll(() => bodies.length).toBe(1); release(); await expect(page.getByText("Записано в системата", { exact: true }).first()).toBeVisible();
  expect(bodies[0]).toMatchObject({ cardType: "master", employeeId, locationId: null, label }); expect(bodies[0].validFrom).toBeTruthy(); expect(bodies[0].validUntil).toBeTruthy();
  const rows = await (await page.request.get("/api/cards?staffOnly=true")).json(); const list = Array.isArray(rows) ? rows : rows.cards; expect(list.filter((r: any) => r.label === label)).toHaveLength(1);
});
test("P2-24 Rooms uses saved task due hours without changing an existing task", async ({ page }) => {
  await uiLogin(page, USERS.owner); const settings = await (await page.request.get("/api/settings")).json(); const original = settings.operations.value;
  const a = await room(page, "DUE-A"); const b = await room(page, "DUE-B");
  try {
    await patchSetting(page, "operations", { ...original, defaultTaskDueHours: 2 }, "scenario due before"); await page.reload(); await openNav(page, /Стаи|Rooms/);
    const row = (number: string) => page.locator("tr").filter({ has: page.getByText(number, { exact: true }) });
    const beforeA = Date.now(); await row(a.number).getByRole("button", { name: "Create task", exact: true }).click();
    await expect(row(a.number).getByRole("button", { name: "Create task", exact: true })).toHaveCount(0);
    const taskA = (await (await page.request.get(`/api/cleaning/tasks?hotelDate=${new Intl.DateTimeFormat("en-CA", { timeZone: original.hotelTimezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())}`)).json()).find((t: any) => t.locationId === a.id);
    expect(Math.abs(new Date(taskA.dueAt).getTime() - beforeA - 2 * 3600000)).toBeLessThan(10000);
    await patchSetting(page, "operations", { ...original, defaultTaskDueHours: 7 }, "scenario due after"); await page.reload(); await openNav(page, /Стаи|Rooms/);
    const beforeB = Date.now(); await row(b.number).getByRole("button", { name: "Create task", exact: true }).click(); await expect(row(b.number).getByRole("button", { name: "Create task", exact: true })).toHaveCount(0);
    const tasks = await (await page.request.get(`/api/cleaning/tasks?hotelDate=${taskA.hotelDate.slice(0, 10)}`)).json(); const taskB = tasks.find((t: any) => t.locationId === b.id); const old = tasks.find((t: any) => t.id === taskA.id);
    expect(Math.abs(new Date(taskB.dueAt).getTime() - beforeB - 7 * 3600000)).toBeLessThan(10000); expect(old.dueAt).toBe(taskA.dueAt);
  } finally { await patchSetting(page, "operations", original, "scenario restore"); }
});
test("P2-48 rapid report clicks preserve one logical queued report", async ({ page }) => {
  await uiLogin(page, USERS.owner); await openNav(page, /Повреди|Repairs/);
  await page.getByLabel(/Заглавие|Title/, { exact: true }).fill(`DOUBLE-${crypto.randomUUID()}`);
  await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { configurable: true, value: false }); window.dispatchEvent(new Event("offline")); });
  await page.getByRole("button", { name: /Докладвай|Report/, exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.getByText(/Докладът е в опашката|Report queued for sync/)).toBeVisible();
  const rows = await page.evaluate(async () => (await import(/* @vite-ignore */ "/src/offline/queueOps.ts")).listQueuedActions()); expect(rows).toHaveLength(1);
});
test("P1-114 report UI shows storage quota failure without queued success or optimistic row", async ({ page }) => {
  await uiLogin(page, USERS.owner); await openNav(page, /Повреди|Repairs/);
  const title = `QUOTA-${crypto.randomUUID()}`; await page.getByLabel(/Заглавие|Title/, { exact: true }).fill(title);
  await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { configurable: true, value: false }); window.dispatchEvent(new Event("offline")); IDBObjectStore.prototype.put = function () { throw new DOMException("Storage quota exceeded", "QuotaExceededError"); }; });
  await page.getByRole("button", { name: /Докладвай|Report/, exact: true }).click();
  await expect(page.getByText(/Storage quota exceeded/)).toBeVisible(); await expect(page.getByText(/Докладът е в опашката|Report queued for sync/)).toHaveCount(0); await expect(page.locator("tr").filter({ hasText: title })).toHaveCount(0);
});
test("P2-25 disabling current module selects allowed panel and remains hidden after reload", async ({ page }) => {
  await uiLogin(page, USERS.owner); const original = (await (await page.request.get("/api/settings")).json()).modules.value;
  try {
    await openNav(page, /Присъствие|Attendance/); await expect(page.getByRole("heading", { name: /Присъствие|Attendance/ })).toBeVisible();
    await patchSetting(page, "modules", { ...original, attendance: false }, "scenario current module");
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /Присъствие|Attendance/ })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Присъствие|Attendance/ })).toHaveCount(0);
    await page.reload(); await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible(); await expect(page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /Присъствие|Attendance/ })).toHaveCount(0);
  } finally { await patchSetting(page, "modules", original, "scenario restore"); }
});
test("P2-46 legacy room-QR hash clears without calling retired by-qr API", async ({ page }) => {
  await uiLogin(page, USERS.owner);
  let byQrHits = 0;
  page.on("request", (request) => {
    if (request.url().includes("/locations/by-qr/")) byQrHits++;
  });
  await page.goto("/#/room-qr/legacy-retired-token");
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.location.hash)).not.toMatch(/room-qr/);
  expect(byQrHits).toBe(0);
  expect((await page.request.get("/api/locations/by-qr/legacy-retired-token")).status()).toBe(404);
});
test("P2-53 app logout aborts its shared live stream and never reconnects", async ({ page }) => {
  const streams: import("@playwright/test").Request[] = []; const finished = new Set<import("@playwright/test").Request>();
  page.on("request", request => { if (request.url().includes("/events/stream")) streams.push(request); });
  page.on("requestfailed", request => { finished.add(request); }); page.on("requestfinished", request => { finished.add(request); });
  await uiLogin(page, USERS.owner); await openNav(page, /Повреди|Repairs/); await expect.poll(() => streams.length).toBe(1);
  await page.getByRole("button", { name: "Log out", exact: true }).click(); await expect(page.getByRole("button", { name: /Вход|Sign in/, exact: true })).toBeVisible();
  await expect.poll(() => finished.has(streams[0]!)).toBe(true); const count = streams.length;
  await page.clock.install(); await page.clock.fastForward(60000); expect(streams.length).toBe(count);
});
for (const type of ["guest", "housekeeper"] as const) test(`P2-44 switch from master to ${type} sends exact holder, room and selected validity`, async ({ page }) => {
  await uiLogin(page, USERS.owner); await openNav(page, /Карти|Cards/);
  await page.getByRole("button", { name: "Мастър", exact: true }).click(); await page.getByRole("button", { name: "Напред", exact: true }).click();
  const employeeId = (await page.getByRole("combobox", { name: /^Служител/ }).locator("option").nth(1).getAttribute("value"))!; await page.getByRole("combobox", { name: /^Служител/ }).selectOption(employeeId);
  await page.getByRole("button", { name: "Назад", exact: true }).click(); await page.getByRole("button", { name: type === "guest" ? "Гост" : "Камериерка", exact: true }).click(); await page.getByRole("button", { name: "Напред", exact: true }).click();
  const select = type === "guest" ? page.getByRole("combobox", { name: /^Стая/ }) : page.getByLabel(/Локация \(опционално\)/);
  const locationId = (await select.locator("option").nth(1).getAttribute("value"))!; await select.selectOption(locationId);
  if (type === "housekeeper") { await expect(page.getByRole("combobox", { name: /^Служител/ })).toHaveValue(""); await page.getByRole("combobox", { name: /^Служител/ }).selectOption(employeeId); }
  await page.getByLabel("Валидна от", { exact: true }).fill("2027-01-02T03:04"); await page.getByLabel("Валидна до", { exact: true }).fill("2027-01-03T05:06");
  const expectedDates = await page.evaluate(() => ({ validFrom: new Date("2027-01-02T03:04").toISOString(), validUntil: new Date("2027-01-03T05:06").toISOString() }));
  await page.getByRole("button", { name: "Напред", exact: true }).click(); const request = page.waitForRequest(r => r.url().endsWith("/api/cards") && r.method() === "POST");
  await page.getByRole("button", { name: "Запиши в системата", exact: true }).click(); expect((await request).postDataJSON()).toMatchObject({ cardType: type, employeeId: type === "guest" ? null : employeeId, locationId, ...expectedDates });
  await expect(page.getByText("Записано в системата", { exact: true }).first()).toBeVisible();
});
