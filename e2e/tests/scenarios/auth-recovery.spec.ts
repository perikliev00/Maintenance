import { openAccount } from "../helpers/auth";
// Playwright test runner APIs for browser E2E scenarios.
import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
const apiRequire = createRequire(new URL("../../../api/package.json", import.meta.url));
const { PrismaClient } = apiRequire("@prisma/client");
const bcrypt = apiRequire("bcryptjs");
const isolatedEnv = new URL("../../../api/.env.p1_test", import.meta.url);
const url = process.env.P1_TEST_DATABASE_URL?.trim()
  || (existsSync(isolatedEnv) ? apiRequire("dotenv").parse(readFileSync(isolatedEnv)).DATABASE_URL : undefined);
// Branch on env so isolation settings win over ambient config.
if (!url || new URL(url).pathname !== "/maintenance_p1_test") throw new Error("Auth recovery browser tests require maintenance_p1_test through P1_TEST_DATABASE_URL or api/.env.p1_test");
const db: import("../../../api/node_modules/@prisma/client").PrismaClient = new PrismaClient({ datasources: { db: { url } } });
const employees: string[] = [];
const password = "browser-recovery-test-password";
// Define an individual test case.
test.beforeAll(async () => {
  const [row] = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  expect(row?.name).toBe("maintenance_p1_test");
});
// Define an individual test case.
test.afterAll(async () => {
  await db.authSession.deleteMany({ where: { user: { employeeId: { in: employees } } } });
  await db.user.deleteMany({ where: { employeeId: { in: employees } } });
  await db.employee.deleteMany({ where: { id: { in: employees } } });
  await db.$disconnect();
});
// Local helper account used by cases in this file.
async function account() {
  const id = randomUUID();
  // employee: seeded entity required before the mutation under test.
  const employee = await db.employee.create({ data: { employeeNumber: id, fullName: "Auth recovery fixture" } });
  employees.push(employee.id);
  return db.user.create({ data: { employeeId: employee.id, email: `${id}@recovery.test`, role: "housekeeper", passwordHash: await bcrypt.hash(password, 10), isActive: true, activatedAt: new Date() } });
}
// Local helper signIn used by cases in this file.
async function signIn(page: Page, email: string) {
  expect((await page.request.post("/api/auth/login", { data: { email, password } })).status()).toBe(200);
}
// Local helper failingRevocation used by cases in this file.
async function failingRevocation(userId: string, run: () => Promise<void>) {
  const name = `auth_recovery_${randomUUID().replaceAll("-", "")}`;
  await db.$executeRawUnsafe(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD."userId" = '${userId}' AND NEW."revokedAt" IS NOT NULL THEN RAISE EXCEPTION 'temporary_auth_storage_failure'; END IF; RETURN NEW; END $$`);
  try {
    await db.$executeRawUnsafe(`CREATE TRIGGER ${name} BEFORE UPDATE ON "AuthSession" FOR EACH ROW EXECUTE FUNCTION ${name}()`);
    try { await run(); } finally { await db.$executeRawUnsafe(`DROP TRIGGER ${name} ON "AuthSession"`); }
  } finally { await db.$executeRawUnsafe(`DROP FUNCTION ${name}()`); }
}
// Case: real refresh 5xx preserves cookies/private stores; recovery succeeds; revoked refresh rejects.
test("real refresh 5xx preserves cookies/private stores; recovery succeeds; revoked refresh rejects", async ({ page }) => {
  const user = await account(); await signIn(page, user.email);
  await page.route("**/__auth-recovery", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><p>Auth recovery</p>" }));
  await page.goto("/__auth-recovery");
  await page.evaluate(async userId => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    const scope = await import(/* @vite-ignore */ "/src/offline/userScope.ts");
    scope.setOfflineUser(userId); await scope.whenOfflineUserSettled();
    localStorage.setItem("user", JSON.stringify({ id: userId }));
    const ops = await import(/* @vite-ignore */ "/src/offline/queueOps.ts");
    await ops.enqueue({ commandId: crypto.randomUUID(), type: "ticket.start", url: "/maintenance/tickets/offline/start", method: "POST", body: {} });
    await ops.saveMyWorkCache({ tasks: [{ id: "cached-task" }], tickets: [], hotelDate: "2026-10-26", savedAt: 1 });
  }, user.id);
  const before = await page.context().cookies();
  await failingRevocation(user.id, async () => {
    // Run actors together to expose races and serialization bugs.
    const [response, outcome] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith("/api/auth/refresh")),
      page.evaluate(async () => (await import(/* @vite-ignore */ "/src/api/http.ts")).refreshAccessToken()),
    ]);
    expect(response.status()).toBe(500); expect(outcome).toBe("transient");
    expect(response.headers()["set-cookie"]).toBeUndefined();
    const after = await page.context().cookies();
    for (const name of ["session", "refresh", "csrf"]) expect(after.find(c => c.name === name)?.value === before.find(c => c.name === name)?.value).toBe(true);
  });
  expect(await page.evaluate(async () => (await import(/* @vite-ignore */ "/src/api/http.ts")).refreshAccessToken())).toBe("refreshed");
  const saved = await page.evaluate(async userId => {
    const storage = await import(/* @vite-ignore */ "/src/offline/storage.ts");
    return { count: (await storage.listQueueForUser(userId)).length, cache: await storage.readMyWorkCache(userId) };
  }, user.id);
  expect(saved.count).toBe(1); expect(saved.cache.tasks[0].id).toBe("cached-task");
  await db.authSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  expect(await page.evaluate(async () => (await import(/* @vite-ignore */ "/src/api/http.ts")).refreshAccessToken())).toBe("rejected");
  expect(await page.evaluate(async userId => {
    const storage = await import(/* @vite-ignore */ "/src/offline/storage.ts");
    return { count: (await storage.listQueueForUser(userId)).length, cache: await storage.readMyWorkCache(userId), user: localStorage.getItem("user") };
  }, user.id)).toEqual({ count: 0, cache: null, user: null });
});
// Case checks authz/session policy: logout-all with expired access cookie revokes two devices, survives reload and leaves another user active.
test("logout-all with expired access cookie revokes two devices, survives reload and leaves another user active", async ({ page, browser }) => {
  const user = await account(), otherUser = await account();
  const second = await browser.newContext(), other = await browser.newContext();
  try {
    const secondPage = await second.newPage(), otherPage = await other.newPage();
    await signIn(page, user.email); await signIn(secondPage, user.email); await signIn(otherPage, otherUser.email);
    const staleAccess = (await page.context().cookies()).find(c => c.name === "session")!.value;
    await page.goto("/"); await openAccount(page); await expect(page.getByRole("button", { name: "Sign out everywhere" })).toBeVisible();
    await page.context().clearCookies({ name: "session" });
    // Refresh cookie is authentication here: CSRF must still be mandatory.
    expect((await page.request.post("/api/auth/logout-all")).status()).toBe(403);
    await page.getByRole("button", { name: "Sign out everywhere" }).click();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    expect(await db.authSession.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    expect((await page.request.get("/api/auth/me", { headers: { Authorization: `Bearer ${staleAccess}` } })).status()).toBe(401);
    expect((await secondPage.request.get("/api/auth/me")).status()).toBe(401);
    const csrf = (await second.cookies()).find(c => c.name === "csrf")!.value;
    expect((await secondPage.request.post("/api/auth/refresh", { headers: { "X-CSRF-Token": csrf } })).status()).toBe(401);
    expect((await otherPage.request.get("/api/auth/me")).status()).toBe(200);
    await page.reload(); await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out everywhere" })).toHaveCount(0);
  } finally { await second.close(); await other.close(); }
});
// Case: server revoke-all failure is visible and still clears this browser.
test("server revoke-all failure is visible and still clears this browser's private identity", async ({ page }) => {
  const user = await account(); await signIn(page, user.email);
  await page.goto("/"); await openAccount(page); await expect(page.getByRole("button", { name: "Sign out everywhere" })).toBeVisible();
  await failingRevocation(user.id, async () => {
    await page.getByRole("button", { name: "Sign out everywhere" }).click();
    await expect(page.getByRole("alert")).toContainText(/Could not confirm|Не успяхме/);
    await expect(page.locator('input[type="password"]')).toBeVisible();
    expect(await db.authSession.count({ where: { userId: user.id, revokedAt: null } })).toBeGreaterThan(0);
    expect((await page.context().cookies()).some(c => c.name === "refresh")).toBe(false);
    expect(await page.evaluate(() => localStorage.getItem("user"))).toBeNull();
  });
});
