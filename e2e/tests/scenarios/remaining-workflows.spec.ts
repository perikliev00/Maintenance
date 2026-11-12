// Playwright test runner APIs for browser E2E scenarios.
import { expect, test } from "@playwright/test";
// Import bindings from ../helpers/auth.
import { uiLogin } from "../helpers/auth";
// Import bindings from ../helpers/nav.
import { openNav } from "../helpers/nav";
// Import bindings from ../helpers/api.
import { apiGet, apiPost, API_ORIGIN } from "../helpers/api";
// Shared test fixtures for seeding users, locations, and domain entities.
import { hotelToday, ownerApi, prepareVacantDirtyRoom } from "../helpers/fixtures";

// Case checks authz/session policy: real offline cleaning start and complete reconcile to authoritative session and inspection state.
test("real offline cleaning start and complete reconcile to authoritative session and inspection state", async ({ page }) => {
  // Await async work before asserting or releasing locks.
  const { token } = await ownerApi();
  // id: unique stamp so parallel runs do not collide.
  const id = crypto.randomUUID();
  // Bind email for later setup or assertions in this scope.
  const email = `cleaning-sync-${id}@test.local`;
  // issued: HTTP response captured for status/body checks.
  const issued = await apiPost(token, "/invitations", { kind: "new", fullName: `Cleaning Sync ${id}`, employeeNumber: id, email, role: "housekeeper" });
  // Assert response/page reached the expected status.
  expect(issued.status).toBe(201);
  // Bind invite for later setup or assertions in this scope.
  const invite = issued.body as { code: string; invitation: { employeeId: string } };
  // redeemed: HTTP response captured for status/body checks.
  const redeemed = await fetch(`${API_ORIGIN}/invitations/redeem`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: invite.code, password: "demo1234", deviceLabel: id, fingerprint: id }) });
  // Assert response/page reached the expected status.
  expect(redeemed.status).toBe(200);
  // room: synchronize actors so the race window is observable.
  const room = await prepareVacantDirtyRoom(token);
  // created: seeded entity required before the mutation under test.
  const created = await apiPost(token, "/cleaning/tasks", { locationId: room.id, hotelDate: await hotelToday(token), assignedEmployeeId: invite.invitation.employeeId });
  // Assert response/page reached the expected status.
  expect(created.status).toBe(201);
  // Bind task for later setup or assertions in this scope.
  const task = created.body as { id: string; version: number };
  // Bind online for later setup or assertions in this scope.
  const online = async (value: boolean) => page.evaluate(value => {
    // Execute the next setup or assertion step for this scenario.
    Object.defineProperty(navigator, "onLine", { configurable: true, value });
    // Execute the next setup or assertion step for this scenario.
    window.dispatchEvent(new Event(value ? "online" : "offline"));
  // Execute the next setup or assertion step for this scenario.
  }, value);
  // outbox: synchronize actors so the race window is observable.
  const outbox = () => page.evaluate(async () => (await import(/* @vite-ignore */ "/src/offline/queueOps.ts")).listQueuedActions());
  // serverTask: in-process HTTP server handle for this suite.
  const serverTask = async () => {
    // result: HTTP response captured for status/body checks.
    const result = await apiGet(token, `/cleaning/tasks?hotelDate=${await hotelToday(token)}`);
    // Assert response/page reached the expected status.
    expect(result.status).toBe(200);
    // Return the arranged value/result to the caller.
    return (result.body as any[]).find(t => t.id === task.id);
  };
  // Try path where partial failure must not leak suite state.
  try {
    // Drive the browser through the user-visible workflow step.
    await uiLogin(page, email);
    // Await async work before asserting or releasing locks.
    await openNav(page, /^(Моите задачи|My Work)$/);
    // Bind card for later setup or assertions in this scope.
    const card = page.locator("article.mywork-card").filter({ hasText: room.number });
    // Assert UI visibility/state after the user action.
    await expect(card).toHaveCount(1);
    // Await async work before asserting or releasing locks.
    await online(false);
    // Drive the browser through the user-visible workflow step.
    await card.getByRole("button", { name: /^(Начало|Start)$/ }).click();
    // Assert UI visibility/state after the user action.
    await expect(card.getByText(/^(Чака синхрон|Pending sync)$/)).toBeVisible();
    // Assert browser/UI outcome matches the scenario intent.
    expect((await outbox()).map((r: { type: string }) => r.type)).toEqual(["cleaning.start"]);
    // Assert browser/UI outcome matches the scenario intent.
    expect((await serverTask()).sessions).toHaveLength(0);
    // Await async work before asserting or releasing locks.
    await online(true);
    // Await async work before asserting or releasing locks.
    await expect.poll(async () => (await outbox()).length).toBe(0);
    // Assert UI visibility/state after the user action.
    await expect(card.getByRole("button", { name: /^(Приключи|Complete)$/ })).toBeEnabled();
    // Assert UI visibility/state after the user action.
    await expect(card.getByText(/^(Чака синхрон|Pending sync)$/)).toHaveCount(0);
    // started: synchronize actors so the race window is observable.
    const started = await serverTask();
    // Assert response/page reached the expected status.
    expect(started.status).toBe("in_progress");
    // Assert browser/UI outcome matches the scenario intent.
    expect(started.sessions).toHaveLength(1);
    // Assert browser/UI outcome matches the scenario intent.
    expect(started.sessions[0].employeeId).toBe(invite.invitation.employeeId);
    // Assert browser/UI outcome matches the scenario intent.
    expect(started.version).toBe(task.version + 1);
    // Await async work before asserting or releasing locks.
    await online(false);
    // Execute the next setup or assertion step for this scenario.
    page.once("dialog", dialog => dialog.accept("Offline completion evidence"));
    // Drive the browser through the user-visible workflow step.
    await card.getByRole("button", { name: /^(Приключи|Complete)$/ }).click();
    await expect(card).toHaveCount(0); // Optimistic completed hides the active card.
    // Assert browser/UI outcome matches the scenario intent.
    expect((await outbox()).map((r: { type: string }) => r.type)).toEqual(["cleaning.complete"]);
    // Assert response/page reached the expected status.
    expect((await serverTask()).status).toBe("in_progress");
    // Await async work before asserting or releasing locks.
    await online(true);
    // Await async work before asserting or releasing locks.
    await expect.poll(async () => (await outbox()).length).toBe(0);
    // Assert UI visibility/state after the user action.
    await expect(card).toHaveCount(1);
    // Assert UI visibility/state after the user action.
    await expect(card.getByText(/^(Чака инспекция|Awaiting inspection)$/)).toBeVisible();
    // Assert UI visibility/state after the user action.
    await expect(card.getByText(/^(Чака синхрон|Pending sync)$/)).toHaveCount(0);
    // completed: synchronize actors so the race window is observable.
    const completed = await serverTask();
    // Assert response/page reached the expected status.
    expect(completed.status).toBe("awaiting_inspection");
    // Assert browser/UI outcome matches the scenario intent.
    expect(completed.sessions).toHaveLength(1);
    // Assert response/page reached the expected status.
    expect(completed.sessions[0]).toMatchObject({ status: "completed", notes: "Offline completion evidence" });
    // Assert browser/UI outcome matches the scenario intent.
    expect(completed.version).toBe(started.version + 1);
    // Assert browser/UI outcome matches the scenario intent.
    expect(completed.inspections).toHaveLength(0);
    // cached: synchronize actors so the race window is observable.
    const cached = await page.evaluate(async () => (await import(/* @vite-ignore */ "/src/offline/index.ts")).loadMyWorkCache());
    // Bind cachedTask for later setup or assertions in this scope.
    const cachedTask = (cached?.tasks as any[]).find(t => t.id === task.id);
    // Assert response/page reached the expected status.
    expect(cachedTask).toMatchObject({ id: task.id, status: completed.status, version: completed.version, sessions: completed.sessions, inspections: completed.inspections });
    // Await async work before asserting or releasing locks.
    await page.reload();
    // Await async work before asserting or releasing locks.
    await openNav(page, /^(Моите задачи|My Work)$/);
    // Assert UI visibility/state after the user action.
    await expect(card).toHaveCount(1);
    // Assert UI visibility/state after the user action.
    await expect(card.getByText(/^(Чака инспекция|Awaiting inspection)$/)).toBeVisible();
  // Execute the next setup or assertion step for this scenario.
  } finally {
    // Assert response/page reached the expected status.
    expect((await apiPost(token, `/locations/${room.id}/archive`, {})).status).toBe(200);
  }
});

// Case: real cookie login waits for pending refresh so stale Set-Cookie cannot restore the prior account.
test("real cookie login waits for pending refresh so stale Set-Cookie cannot restore the prior account", async ({ page }) => {
  // Drive the browser through the user-visible workflow step.
  await uiLogin(page, "owner@meridian.local");
  // Execute the next setup or assertion step for this scenario.
  let release!: () => void;
  // Bind gate for later setup or assertions in this scope.
  const gate = new Promise<void>(resolve => { release = resolve; });
  // Bind refreshing for later setup or assertions in this scope.
  let refreshing = false;
  // Bind newLoginRequests for later setup or assertions in this scope.
  let newLoginRequests = 0;
  // Await async work before asserting or releasing locks.
  await page.route("**/api/auth/refresh", async route => {
    // Session/CSRF step exercising auth lifecycle.
    refreshing = true;
    const response = await route.fetch(); // Real rotation, including Set-Cookie.
    // Assert response/page reached the expected status.
    expect(response.status()).toBe(200);
    // Await async work before asserting or releasing locks.
    await gate;
    // Await async work before asserting or releasing locks.
    await route.fulfill({ response });
  });
  // Session/CSRF step exercising auth lifecycle.
  page.on("request", request => { if (request.url().endsWith("/auth/login")) newLoginRequests++; });
  // Await async work before asserting or releasing locks.
  await page.evaluate(() => {
    // Session/CSRF step exercising auth lifecycle.
    (window as any).oldRefresh = import(/* @vite-ignore */ "/src/api/http.ts").then(m => m.refreshAccessToken());
  });
  // Await async work before asserting or releasing locks.
  await expect.poll(() => refreshing).toBe(true);
  // Await async work before asserting or releasing locks.
  await page.evaluate(() => {
    // Session/CSRF step exercising auth lifecycle.
    (window as any).newLogin = import(/* @vite-ignore */ "/src/api/http.ts").then(m => m.login("technician@meridian.local", "demo1234"));
  });
  // Await async work before asserting or releasing locks.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  // Assert response/page reached the expected status.
  expect(newLoginRequests).toBe(0);
  // Execute the next setup or assertion step for this scenario.
  release();
  // result: synchronize actors so the race window is observable.
  const result = await page.evaluate(async () => {
    // staleOutcome: synchronize actors so the race window is observable.
    const staleOutcome = await (window as any).oldRefresh;
    // result: synchronize actors so the race window is observable.
    const result = await (window as any).newLogin;
    // current: HTTP response captured for status/body checks.
    const current = await (await fetch("/api/auth/me", { credentials: "include" })).json();
    // Return the arranged value/result to the caller.
    return { staleOutcome, loginId: result.user.id, currentId: current.id, cachedId: JSON.parse(localStorage.getItem("user")!).id };
  });
  // Assert browser/UI outcome matches the scenario intent.
  expect(result.staleOutcome).toBe("rejected");
  // Assert browser/UI outcome matches the scenario intent.
  expect(result.currentId).toBe(result.loginId);
  // Assert browser/UI outcome matches the scenario intent.
  expect(result.cachedId).toBe(result.loginId);
  // Assert response/page reached the expected status.
  expect(newLoginRequests).toBe(1);
});
