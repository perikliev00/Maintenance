// Playwright test runner APIs for browser E2E scenarios.
import { expect, test, type Page } from "@playwright/test";
// Import bindings from node:module.
import { createRequire } from "node:module";
// Import bindings from node:crypto.
import { randomUUID } from "node:crypto";
// Import bindings from node:fs.
import { existsSync, readFileSync } from "node:fs";
// Bind apiRequire for later setup or assertions in this scope.
const apiRequire = createRequire(new URL("../../../api/package.json", import.meta.url));
// Execute the next setup or assertion step for this scenario.
const { PrismaClient } = apiRequire("@prisma/client");
// Bind bcrypt for later setup or assertions in this scope.
const bcrypt = apiRequire("bcryptjs");
// Bind isolatedEnv for later setup or assertions in this scope.
const isolatedEnv = new URL("../../../api/.env.p1_test", import.meta.url);
// Bind url for later setup or assertions in this scope.
const url = process.env.P1_TEST_DATABASE_URL?.trim()
  // Concurrency/isolation step for the race under test.
  || (existsSync(isolatedEnv) ? apiRequire("dotenv").parse(readFileSync(isolatedEnv)).DATABASE_URL : undefined);
// Branch on env so isolation settings win over ambient config.
if (!url || new URL(url).pathname !== "/maintenance_p1_test") throw new Error("Auth recovery browser tests require maintenance_p1_test through P1_TEST_DATABASE_URL or api/.env.p1_test");
// Execute the next setup or assertion step for this scenario.
const db: import("../../../api/node_modules/@prisma/client").PrismaClient = new PrismaClient({ datasources: { db: { url } } });
// Execute the next setup or assertion step for this scenario.
const employees: string[] = [];
// password: credential/token material for auth flows.
const password = "browser-recovery-test-password";
// Define an individual test case.
test.beforeAll(async () => {
  // Await async work before asserting or releasing locks.
  const [row] = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  // Assert browser/UI outcome matches the scenario intent.
  expect(row?.name).toBe("maintenance_p1_test");
});
// Define an individual test case.
test.afterAll(async () => {
  // Await async work before asserting or releasing locks.
  await db.authSession.deleteMany({ where: { user: { employeeId: { in: employees } } } });
  // Await async work before asserting or releasing locks.
  await db.user.deleteMany({ where: { employeeId: { in: employees } } });
  // Await async work before asserting or releasing locks.
  await db.employee.deleteMany({ where: { id: { in: employees } } });
  // Disconnect Prisma so the pool does not leak across suites.
  await db.$disconnect();
});
// Local helper account used by cases in this file.
async function account() {
  // id: unique stamp so parallel runs do not collide.
  const id = randomUUID();
  // employee: seeded entity required before the mutation under test.
  const employee = await db.employee.create({ data: { employeeNumber: id, fullName: "Auth recovery fixture" } });
  // Execute the next setup or assertion step for this scenario.
  employees.push(employee.id);
  // Return the arranged value/result to the caller.
  return db.user.create({ data: { employeeId: employee.id, email: `${id}@recovery.test`, role: "housekeeper", passwordHash: await bcrypt.hash(password, 10), isActive: true, activatedAt: new Date() } });
}
// Local helper signIn used by cases in this file.
async function signIn(page: Page, email: string) {
  // Assert response/page reached the expected status.
  expect((await page.request.post("/api/auth/login", { data: { email, password } })).status()).toBe(200);
}
// Local helper failingRevocation used by cases in this file.
async function failingRevocation(userId: string, run: () => Promise<void>) {
  // name: unique stamp so parallel runs do not collide.
  const name = `auth_recovery_${randomUUID().replaceAll("-", "")}`;
  // Await async work before asserting or releasing locks.
  await db.$executeRawUnsafe(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD."userId" = '${userId}' AND NEW."revokedAt" IS NOT NULL THEN RAISE EXCEPTION 'temporary_auth_storage_failure'; END IF; RETURN NEW; END $$`);
  // Try path where partial failure must not leak suite state.
  try {
    // Await async work before asserting or releasing locks.
    await db.$executeRawUnsafe(`CREATE TRIGGER ${name} BEFORE UPDATE ON "AuthSession" FOR EACH ROW EXECUTE FUNCTION ${name}()`);
    // Try path where partial failure must not leak suite state.
    try { await run(); } finally { await db.$executeRawUnsafe(`DROP TRIGGER ${name} ON "AuthSession"`); }
  // Await async work before asserting or releasing locks.
  } finally { await db.$executeRawUnsafe(`DROP FUNCTION ${name}()`); }
}
// Case: real refresh 5xx preserves cookies/private stores; recovery succeeds; revoked refresh rejects.
test("real refresh 5xx preserves cookies/private stores; recovery succeeds; revoked refresh rejects", async ({ page }) => {
  // user: synchronize actors so the race window is observable.
  const user = await account(); await signIn(page, user.email);
  // Await async work before asserting or releasing locks.
  await page.route("**/__auth-recovery", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><p>Auth recovery</p>" }));
  // Drive the browser through the user-visible workflow step.
  await page.goto("/__auth-recovery");
  // Await async work before asserting or releasing locks.
  await page.evaluate(async userId => {
    // Execute the next setup or assertion step for this scenario.
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    // scope: synchronize actors so the race window is observable.
    const scope = await import(/* @vite-ignore */ "/src/offline/userScope.ts");
    // Await async work before asserting or releasing locks.
    scope.setOfflineUser(userId); await scope.whenOfflineUserSettled();
    // Execute the next setup or assertion step for this scenario.
    localStorage.setItem("user", JSON.stringify({ id: userId }));
    // ops: synchronize actors so the race window is observable.
    const ops = await import(/* @vite-ignore */ "/src/offline/queueOps.ts");
    // Await async work before asserting or releasing locks.
    await ops.enqueue({ commandId: crypto.randomUUID(), type: "ticket.start", url: "/maintenance/tickets/offline/start", method: "POST", body: {} });
    // Await async work before asserting or releasing locks.
    await ops.saveMyWorkCache({ tasks: [{ id: "cached-task" }], tickets: [], hotelDate: "2026-10-26", savedAt: 1 });
  // Execute the next setup or assertion step for this scenario.
  }, user.id);
  // before: synchronize actors so the race window is observable.
  const before = await page.context().cookies();
  // Await async work before asserting or releasing locks.
  await failingRevocation(user.id, async () => {
    // Run actors together to expose races and serialization bugs.
    const [response, outcome] = await Promise.all([
      // Session/CSRF step exercising auth lifecycle.
      page.waitForResponse(r => r.url().endsWith("/api/auth/refresh")),
      // Await async work before asserting or releasing locks.
      page.evaluate(async () => (await import(/* @vite-ignore */ "/src/api/http.ts")).refreshAccessToken()),
    ]);
    // Assert response/page reached the expected status.
    expect(response.status()).toBe(500); expect(outcome).toBe("transient");
    // Assert browser/UI outcome matches the scenario intent.
    expect(response.headers()["set-cookie"]).toBeUndefined();
    // after: synchronize actors so the race window is observable.
    const after = await page.context().cookies();
    // Assert browser/UI outcome matches the scenario intent.
    for (const name of ["session", "refresh", "csrf"]) expect(after.find(c => c.name === name)?.value === before.find(c => c.name === name)?.value).toBe(true);
  });
  // Assert browser/UI outcome matches the scenario intent.
  expect(await page.evaluate(async () => (await import(/* @vite-ignore */ "/src/api/http.ts")).refreshAccessToken())).toBe("refreshed");
  // saved: synchronize actors so the race window is observable.
  const saved = await page.evaluate(async userId => {
    // storage: synchronize actors so the race window is observable.
    const storage = await import(/* @vite-ignore */ "/src/offline/storage.ts");
    // Return the arranged value/result to the caller.
    return { count: (await storage.listQueueForUser(userId)).length, cache: await storage.readMyWorkCache(userId) };
  // Execute the next setup or assertion step for this scenario.
  }, user.id);
  // Assert response/page reached the expected status.
  expect(saved.count).toBe(1); expect(saved.cache.tasks[0].id).toBe("cached-task");
  // Await async work before asserting or releasing locks.
  await db.authSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  // Assert browser/UI outcome matches the scenario intent.
  expect(await page.evaluate(async () => (await import(/* @vite-ignore */ "/src/api/http.ts")).refreshAccessToken())).toBe("rejected");
  // Assert browser/UI outcome matches the scenario intent.
  expect(await page.evaluate(async userId => {
    // storage: synchronize actors so the race window is observable.
    const storage = await import(/* @vite-ignore */ "/src/offline/storage.ts");
    // Return the arranged value/result to the caller.
    return { count: (await storage.listQueueForUser(userId)).length, cache: await storage.readMyWorkCache(userId), user: localStorage.getItem("user") };
  // Execute the next setup or assertion step for this scenario.
  }, user.id)).toEqual({ count: 0, cache: null, user: null });
});
// Case checks authz/session policy: logout-all with expired access cookie revokes two devices, survives reload and leaves another user active.
test("logout-all with expired access cookie revokes two devices, survives reload and leaves another user active", async ({ page, browser }) => {
  // user: synchronize actors so the race window is observable.
  const user = await account(), otherUser = await account();
  // second: synchronize actors so the race window is observable.
  const second = await browser.newContext(), other = await browser.newContext();
  // Try path where partial failure must not leak suite state.
  try {
    // secondPage: synchronize actors so the race window is observable.
    const secondPage = await second.newPage(), otherPage = await other.newPage();
    // Await async work before asserting or releasing locks.
    await signIn(page, user.email); await signIn(secondPage, user.email); await signIn(otherPage, otherUser.email);
    // staleAccess: synchronize actors so the race window is observable.
    const staleAccess = (await page.context().cookies()).find(c => c.name === "session")!.value;
    // Assert UI visibility/state after the user action.
    await page.goto("/"); await expect(page.getByRole("button", { name: "Sign out everywhere" })).toBeVisible();
    // Await async work before asserting or releasing locks.
    await page.context().clearCookies({ name: "session" });
    // Refresh cookie is authentication here: CSRF must still be mandatory.
    expect((await page.request.post("/api/auth/logout-all")).status()).toBe(403);
    // Drive the browser through the user-visible workflow step.
    await page.getByRole("button", { name: "Sign out everywhere" }).click();
    // Assert UI visibility/state after the user action.
    await expect(page.locator('input[type="password"]')).toBeVisible();
    // Assert response/page reached the expected status.
    expect(await db.authSession.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    // Assert response/page reached the expected status.
    expect((await page.request.get("/api/auth/me", { headers: { Authorization: `Bearer ${staleAccess}` } })).status()).toBe(401);
    // Assert response/page reached the expected status.
    expect((await secondPage.request.get("/api/auth/me")).status()).toBe(401);
    // csrf: credential/token material for auth flows.
    const csrf = (await second.cookies()).find(c => c.name === "csrf")!.value;
    // Assert response/page reached the expected status.
    expect((await secondPage.request.post("/api/auth/refresh", { headers: { "X-CSRF-Token": csrf } })).status()).toBe(401);
    // Assert response/page reached the expected status.
    expect((await otherPage.request.get("/api/auth/me")).status()).toBe(200);
    // Assert UI visibility/state after the user action.
    await page.reload(); await expect(page.locator('input[type="password"]')).toBeVisible();
    // Assert UI visibility/state after the user action.
    await expect(page.getByRole("button", { name: "Sign out everywhere" })).toHaveCount(0);
  // Await async work before asserting or releasing locks.
  } finally { await second.close(); await other.close(); }
});
// Case: server revoke-all failure is visible and still clears this browser.
test("server revoke-all failure is visible and still clears this browser's private identity", async ({ page }) => {
  // user: synchronize actors so the race window is observable.
  const user = await account(); await signIn(page, user.email);
  // Assert UI visibility/state after the user action.
  await page.goto("/"); await expect(page.getByRole("button", { name: "Sign out everywhere" })).toBeVisible();
  // Await async work before asserting or releasing locks.
  await failingRevocation(user.id, async () => {
    // Drive the browser through the user-visible workflow step.
    await page.getByRole("button", { name: "Sign out everywhere" }).click();
    // Assert UI visibility/state after the user action.
    await expect(page.getByRole("alert")).toContainText(/Could not confirm|Не успяхме/);
    // Assert UI visibility/state after the user action.
    await expect(page.locator('input[type="password"]')).toBeVisible();
    // Assert browser/UI outcome matches the scenario intent.
    expect(await db.authSession.count({ where: { userId: user.id, revokedAt: null } })).toBeGreaterThan(0);
    // Assert browser/UI outcome matches the scenario intent.
    expect((await page.context().cookies()).some(c => c.name === "refresh")).toBe(false);
    // Assert browser/UI outcome matches the scenario intent.
    expect(await page.evaluate(() => localStorage.getItem("user"))).toBeNull();
  });
});
