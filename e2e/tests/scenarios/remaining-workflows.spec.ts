import { expect, test } from "@playwright/test";
import { uiLogin } from "../helpers/auth";
import { openNav } from "../helpers/nav";
import { apiGet, apiPost, API_ORIGIN } from "../helpers/api";
import { hotelToday, ownerApi, prepareVacantDirtyRoom } from "../helpers/fixtures";

test("P1-110 real offline cleaning start and complete reconcile to authoritative session and inspection state", async ({ page }) => {
  const { token } = await ownerApi();
  const id = crypto.randomUUID();
  const email = `cleaning-sync-${id}@test.local`;
  const issued = await apiPost(token, "/invitations", { kind: "new", fullName: `Cleaning Sync ${id}`, employeeNumber: id, email, role: "housekeeper" });
  expect(issued.status).toBe(201);
  const invite = issued.body as { code: string; invitation: { employeeId: string } };
  const redeemed = await fetch(`${API_ORIGIN}/invitations/redeem`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: invite.code, password: "demo1234", deviceLabel: id, fingerprint: id }) });
  expect(redeemed.status).toBe(200);
  const room = await prepareVacantDirtyRoom(token);
  const created = await apiPost(token, "/cleaning/tasks", { locationId: room.id, hotelDate: await hotelToday(token), assignedEmployeeId: invite.invitation.employeeId });
  expect(created.status).toBe(201);
  const task = created.body as { id: string; version: number };
  const online = async (value: boolean) => page.evaluate(value => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value });
    window.dispatchEvent(new Event(value ? "online" : "offline"));
  }, value);
  const outbox = () => page.evaluate(async () => (await import(/* @vite-ignore */ "/src/offline/queueOps.ts")).listQueuedActions());
  const serverTask = async () => {
    const result = await apiGet(token, `/cleaning/tasks?hotelDate=${await hotelToday(token)}`);
    expect(result.status).toBe(200);
    return (result.body as any[]).find(t => t.id === task.id);
  };
  try {
    await uiLogin(page, email);
    await openNav(page, /^(Моите задачи|My Work)$/);
    const card = page.locator("article.mywork-card").filter({ hasText: room.number });
    await expect(card).toHaveCount(1);
    await online(false);
    await card.getByRole("button", { name: /^(Начало|Start)$/ }).click();
    await expect(card.getByText(/^(Чака синхрон|Pending sync)$/)).toBeVisible();
    expect((await outbox()).map((r: { type: string }) => r.type)).toEqual(["cleaning.start"]);
    expect((await serverTask()).sessions).toHaveLength(0);
    await online(true);
    await expect.poll(async () => (await outbox()).length).toBe(0);
    await expect(card.getByRole("button", { name: /^(Приключи|Complete)$/ })).toBeEnabled();
    await expect(card.getByText(/^(Чака синхрон|Pending sync)$/)).toHaveCount(0);
    const started = await serverTask();
    expect(started.status).toBe("in_progress");
    expect(started.sessions).toHaveLength(1);
    expect(started.sessions[0].employeeId).toBe(invite.invitation.employeeId);
    expect(started.version).toBe(task.version + 1);
    await online(false);
    page.once("dialog", dialog => dialog.accept("Offline completion evidence"));
    await card.getByRole("button", { name: /^(Приключи|Complete)$/ }).click();
    await expect(card).toHaveCount(0); // Optimistic completed hides the active card.
    expect((await outbox()).map((r: { type: string }) => r.type)).toEqual(["cleaning.complete"]);
    expect((await serverTask()).status).toBe("in_progress");
    await online(true);
    await expect.poll(async () => (await outbox()).length).toBe(0);
    await expect(card).toHaveCount(1);
    await expect(card.getByText(/^(Чака инспекция|Awaiting inspection)$/)).toBeVisible();
    await expect(card.getByText(/^(Чака синхрон|Pending sync)$/)).toHaveCount(0);
    const completed = await serverTask();
    expect(completed.status).toBe("awaiting_inspection");
    expect(completed.sessions).toHaveLength(1);
    expect(completed.sessions[0]).toMatchObject({ status: "completed", notes: "Offline completion evidence" });
    expect(completed.version).toBe(started.version + 1);
    expect(completed.inspections).toHaveLength(0);
    const cached = await page.evaluate(async () => (await import(/* @vite-ignore */ "/src/offline/index.ts")).loadMyWorkCache());
    const cachedTask = (cached?.tasks as any[]).find(t => t.id === task.id);
    expect(cachedTask).toMatchObject({ id: task.id, status: completed.status, version: completed.version, sessions: completed.sessions, inspections: completed.inspections });
    await page.reload();
    await openNav(page, /^(Моите задачи|My Work)$/);
    await expect(card).toHaveCount(1);
    await expect(card.getByText(/^(Чака инспекция|Awaiting inspection)$/)).toBeVisible();
  } finally {
    expect((await apiPost(token, `/locations/${room.id}/archive`, {})).status).toBe(200);
  }
});

test("P0-10 real cookie login waits for pending refresh so stale Set-Cookie cannot restore the prior account", async ({ page }) => {
  await uiLogin(page, "owner@meridian.local");
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let refreshing = false;
  let newLoginRequests = 0;
  await page.route("**/api/auth/refresh", async route => {
    refreshing = true;
    const response = await route.fetch(); // Real rotation, including Set-Cookie.
    expect(response.status()).toBe(200);
    await gate;
    await route.fulfill({ response });
  });
  page.on("request", request => { if (request.url().endsWith("/auth/login")) newLoginRequests++; });
  await page.evaluate(() => {
    (window as any).oldRefresh = import(/* @vite-ignore */ "/src/api/http.ts").then(m => m.refreshAccessToken());
  });
  await expect.poll(() => refreshing).toBe(true);
  await page.evaluate(() => {
    (window as any).newLogin = import(/* @vite-ignore */ "/src/api/http.ts").then(m => m.login("technician@meridian.local", "demo1234"));
  });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(newLoginRequests).toBe(0);
  release();
  const result = await page.evaluate(async () => {
    const staleOutcome = await (window as any).oldRefresh;
    const result = await (window as any).newLogin;
    const current = await (await fetch("/api/auth/me", { credentials: "include" })).json();
    return { staleOutcome, loginId: result.user.id, currentId: current.id, cachedId: JSON.parse(localStorage.getItem("user")!).id };
  });
  expect(result.staleOutcome).toBe("rejected");
  expect(result.currentId).toBe(result.loginId);
  expect(result.cachedId).toBe(result.loginId);
  expect(newLoginRequests).toBe(1);
});
