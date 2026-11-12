// Load isolated P1 test env before any Prisma/DB clients connect.
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Node test runner and strict assertions for API suite checks.
import { after, before, describe, it } from "node:test";
// Import bindings from node:crypto.
import { randomUUID } from "node:crypto";
// Import bindings from bcryptjs.
import bcrypt from "bcryptjs";
// Import bindings from ../../src/db.
import { prisma } from "../../src/db";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Shared test fixtures for seeding users, locations, and domain entities.
import { createEmployeeWithUser } from "../fixtures";
// HTTP harness to listen an in-process API for request-level tests.
import { closeServer, listenApp, loginBearer, postJson } from "../httpHarness";
// Import bindings from ../../src/services/invitations.
import { issueInvitation, redeemInvitation, revokeInvitation } from "../../src/services/invitations";
// Shared test fixtures for seeding users, locations, and domain entities.
import { waitForBackendsBlockedByHolderChain } from "../attendance/fixtures";

// stamp: unique stamp so parallel runs do not collide.
const stamp = randomUUID();
// password: credential/token material for auth flows.
const password = "scenario-password-123";
// Execute the next setup or assertion step for this scenario.
const employees: string[] = [];
// Execute the next setup or assertion step for this scenario.
let api: string;
// Execute the next setup or assertion step for this scenario.
let server: Awaited<ReturnType<typeof listenApp>>["server"];
// Execute the next setup or assertion step for this scenario.
let owner: Awaited<ReturnType<typeof createEmployeeWithUser>>;
// Execute the next setup or assertion step for this scenario.
let token: string;
// Local helper user used by cases in this file.
async function user(role: "owner" | "manager" | "housekeeper" = "housekeeper") {
  // id: unique stamp so parallel runs do not collide.
  const id = randomUUID();
  // value: seeded entity required before the mutation under test.
  const value = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: id, email: `${id}@scenario.test`, role, fullName: `Scenario ${stamp}`, password,
  });
  // Execute the next setup or assertion step for this scenario.
  employees.push(value.employeeId);
  // Return the arranged value/result to the caller.
  return value;
}
// Local helper noSecrets used by cases in this file.
function noSecrets(value: unknown) {
  // Bind json for later setup or assertions in this scope.
  const json = JSON.stringify(value);
  // Session/CSRF step exercising auth lifecycle.
  assert.doesNotMatch(json, /"(?:password|passwordHash|accessToken|refreshToken|token|refreshTokenHash)"\s*:/);
  // Assert the observed value matches the intended post-condition.
  assert.ok(!json.includes(password));
}
// Local helper invite used by cases in this file.
async function invite(employeeId: string) {
  // Return the arranged value/result to the caller.
  return issueInvitation({ userId: owner.userId, role: "owner" }, { kind: "existing", employeeId });
}
// Local helper redeem used by cases in this file.
async function redeem(code: string, nextPassword?: string) {
  // Return the arranged value/result to the caller.
  return fetch(`${api}/invitations/redeem`, {
    // Configure method for the request/server under test.
    method: "POST", headers: { "Content-Type": "application/json" },
    // Configure body for the request/server under test.
    body: JSON.stringify({ code, password: nextPassword, deviceLabel: "Test", fingerprint: randomUUID() }),
  });
}

// Suite: invitations and real sessions.
describe("invitations and real sessions", () => {
  // Arrange shared preconditions before cases run.
  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    // Override env for isolation, rate-limit disable, or scheduler quieting.
    process.env.E2E_DISABLE_RATE_LIMIT = "1";
    // Await async work before asserting or releasing locks.
    owner = await user("owner");
    // Start or stop the in-process API server for this suite.
    ({ api, server } = await listenApp());
    // Await async work before asserting or releasing locks.
    token = (await loginBearer(api, owner.email, password)).token;
  });
  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Guard optional cleanup or alternate assertion paths.
    if (server) await closeServer(server);
    // Await async work before asserting or releasing locks.
    await prisma.invitation.deleteMany({ where: { employeeId: { in: employees } } });
    // Await async work before asserting or releasing locks.
    await prisma.authSession.deleteMany({ where: { user: { employeeId: { in: employees } } } });
    // Await async work before asserting or releasing locks.
    await prisma.device.deleteMany({ where: { employeeId: { in: employees } } });
    // Await async work before asserting or releasing locks.
    await prisma.user.deleteMany({ where: { employeeId: { in: employees } } });
    // Await async work before asserting or releasing locks.
    await prisma.employee.deleteMany({ where: { id: { in: employees } } });
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });
  // Case: pending login and rejected activation leave no session; activation succeeds with cookie-only secrets.
  it("pending login and rejected activation leave no session; activation succeeds with cookie-only secrets", async () => {
    // target: HTTP response captured for status/body checks.
    const target = await user();
    // Await async work before asserting or releasing locks.
    await prisma.user.update({ where: { id: target.userId }, data: { activatedAt: null } });
    // login: HTTP response captured for status/body checks.
    const login = await fetch(`${api}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: target.email, password }) });
    // Assert HTTP status matches the contract for this path.
    assert.equal(login.status, 403);
    // Assert the observed value matches the intended post-condition.
    assert.equal(login.headers.get("set-cookie"), null);
    // issued: HTTP response captured for status/body checks.
    const issued = await invite(target.employeeId);
    // Iterate to cover variants or wait until a condition holds.
    for (const invalid of [undefined, "1234567"]) {
      // rejected: synchronize actors so the race window is observable.
      const rejected = await redeem(issued.code, invalid);
      // Assert HTTP status matches the contract for this path.
      assert.equal(rejected.status, 400);
      // Assert the observed value matches the intended post-condition.
      assert.equal(rejected.headers.get("set-cookie"), null);
      // Assert HTTP status matches the contract for this path.
      assert.equal((await prisma.invitation.findUniqueOrThrow({ where: { id: issued.invitation.id } })).status, "issued");
      // Assert collection size matches the expected post-condition.
      assert.equal(await prisma.device.count({ where: { userId: target.userId } }), 0);
      // Assert collection size matches the expected post-condition.
      assert.equal(await prisma.authSession.count({ where: { userId: target.userId } }), 0);
      // Assert the observed value matches the intended post-condition.
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target.userId } })).activatedAt, null);
    }
    // accepted: synchronize actors so the race window is observable.
    const accepted = await redeem(issued.code, "12345678");
    // Assert HTTP status matches the contract for this path.
    assert.equal(accepted.status, 200);
    // Await async work before asserting or releasing locks.
    noSecrets(await accepted.json());
    // cookies: session cookie jar for authenticated requests.
    const cookies = accepted.headers.getSetCookie();
    // Assert the observed value matches the intended post-condition.
    for (const name of ["session", "refresh"]) assert.ok(cookies.some(c => c.startsWith(`${name}=`) && /httponly/i.test(c)), `${name} HttpOnly`);
    // authenticated: HTTP response captured for status/body checks.
    const authenticated = await loginBearer(api, target.email, "12345678");
    // loginSuccess: HTTP response captured for status/body checks.
    const loginSuccess = await fetch(`${api}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: target.email, password: "12345678" }) });
    // Assert HTTP status matches the contract for this path.
    assert.equal(loginSuccess.status, 200); noSecrets(await loginSuccess.json());
    // me: HTTP response captured for status/body checks.
    const me = await fetch(`${api}/auth/me`, { headers: { Authorization: `Bearer ${authenticated.token}` } });
    // Assert HTTP status matches the contract for this path.
    assert.equal(me.status, 200); noSecrets(await me.json());
  });
  // Case: existing employee onboarding validation and late insert rollback.
  it("existing employee onboarding validation and late insert rollback", async () => {
    // employee: unique stamp so parallel runs do not collide.
    const employee = await prisma.employee.create({ data: { employeeNumber: randomUUID(), fullName: "Without login" } });
    // Execute the next setup or assertion step for this scenario.
    employees.push(employee.id);
    // Iterate to cover variants or wait until a condition holds.
    for (const extra of [{}, { email: `${randomUUID()}@scenario.test` }, { role: "housekeeper" }, { email: owner.email, role: "housekeeper" }]) {
      // res: HTTP response captured for status/body checks.
      const res = await postJson(api, token, "/invitations", { kind: "existing", employeeId: employee.id, ...extra });
      // Assert HTTP status matches the contract for this path.
      assert.ok([400, 409].includes(res.status), JSON.stringify(res));
      // Assert collection size matches the expected post-condition.
      assert.equal(await prisma.user.count({ where: { employeeId: employee.id } }), 0);
    }
    // manager: synchronize actors so the race window is observable.
    const manager = await user("manager");
    // managerToken: credential/token material for auth flows.
    const managerToken = (await loginBearer(api, manager.email, password)).token;
    // rejected: unique stamp so parallel runs do not collide.
    const rejected = await postJson(api, managerToken, "/invitations", { kind: "existing", employeeId: employee.id, email: `${randomUUID()}@scenario.test`, role: "owner" });
    // Assert HTTP status matches the contract for this path.
    assert.equal(rejected.status, 403);
    // The trigger runs only after seeing the newly inserted User inside the TX.
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION scenario_invite_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."employeeId" = '${employee.id}' AND EXISTS (SELECT 1 FROM "User" WHERE "employeeId" = NEW."employeeId") THEN RAISE EXCEPTION 'scenario_late_invitation_insert_after_user'; END IF; RETURN NEW; END $$`);
    // Await async work before asserting or releasing locks.
    await prisma.$executeRawUnsafe('CREATE TRIGGER scenario_invite_fail BEFORE INSERT ON "Invitation" FOR EACH ROW EXECUTE FUNCTION scenario_invite_fail()');
    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await assert.rejects(issueInvitation({ userId: owner.userId, role: "owner" }, { kind: "existing", employeeId: employee.id, email: `${randomUUID()}@scenario.test`, role: "housekeeper" }), /scenario_late_invitation_insert_after_user/);
      // Assert collection size matches the expected post-condition.
      assert.equal(await prisma.user.count({ where: { employeeId: employee.id } }), 0);
      // Assert collection size matches the expected post-condition.
      assert.equal(await prisma.invitation.count({ where: { employeeId: employee.id } }), 0);
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Await async work before asserting or releasing locks.
      await prisma.$executeRawUnsafe('DROP TRIGGER scenario_invite_fail ON "Invitation"');
      // Await async work before asserting or releasing locks.
      await prisma.$executeRawUnsafe('DROP FUNCTION scenario_invite_fail()');
    }
    // accepted: unique stamp so parallel runs do not collide.
    const accepted = await postJson(api, token, "/invitations", { kind: "existing", employeeId: employee.id, email: `${randomUUID()}@scenario.test`, role: "housekeeper" });
    // Assert HTTP status matches the contract for this path.
    assert.equal(accepted.status, 201);
  });
  // Case: reissue/revoke reject old codes; adding a device preserves password.
  it("reissue/revoke reject old codes; adding a device preserves password", async () => {
    // target: HTTP response captured for status/body checks.
    const target = await user();
    // first: HTTP response captured for status/body checks.
    const first = await invite(target.employeeId);
    // second: HTTP response captured for status/body checks.
    const second = await invite(target.employeeId);
    // Assert HTTP status matches the contract for this path.
    assert.equal((await prisma.invitation.findUniqueOrThrow({ where: { id: first.invitation.id } })).status, "revoked");
    // Assert HTTP status matches the contract for this path.
    assert.equal((await redeem(first.code)).status, 400);
    // before: HTTP response captured for status/body checks.
    const before = await prisma.user.findUniqueOrThrow({ where: { id: target.userId } });
    // Assert HTTP status matches the contract for this path.
    assert.equal((await redeem(second.code, "a-different-password")).status, 200);
    // Assert the observed value matches the intended post-condition.
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target.userId } })).passwordHash, before.passwordHash);
    // Await async work before asserting or releasing locks.
    await loginBearer(api, target.email, password);
    // third: HTTP response captured for status/body checks.
    const third = await invite(target.employeeId);
    // Await async work before asserting or releasing locks.
    await revokeInvitation(third.invitation.id);
    // Assert HTTP status matches the contract for this path.
    assert.equal((await redeem(third.code)).status, 400);
    // Assert collection size matches the expected post-condition.
    assert.equal(await prisma.device.count({ where: { userId: target.userId } }), 1);
    // Assert HTTP status matches the contract for this path.
    assert.equal((await prisma.invitation.findUniqueOrThrow({ where: { id: second.invitation.id } })).status, "consumed");
  });
  // Case probes concurrency/isolation: distinct invites overlap behind a real User lock and retain the winning password.
  it("distinct invites overlap behind a real User lock and retain the winning password", async () => {
    // target: HTTP response captured for status/body checks.
    const target = await user();
    // Await async work before asserting or releasing locks.
    await prisma.user.update({ where: { id: target.userId }, data: { activatedAt: null } });
    // first: HTTP response captured for status/body checks.
    const first = await invite(target.employeeId);
    // second: HTTP response captured for status/body checks.
    const second = await invite(target.employeeId);
    // Await async work before asserting or releasing locks.
    await prisma.invitation.update({ where: { id: first.invitation.id }, data: { status: "issued", revokedAt: null } });
    // Execute the next setup or assertion step for this scenario.
    let release!: () => void;
    // Execute the next setup or assertion step for this scenario.
    let held!: (pid: number) => void;
    // Bind ready for later setup or assertions in this scope.
    const ready = new Promise<number>(r => { held = r; });
    // Bind gate for later setup or assertions in this scope.
    const gate = new Promise<void>(r => { release = r; });
    // Bind holder for later setup or assertions in this scope.
    const holder = prisma.$transaction(async tx => {
      // Await async work before asserting or releasing locks.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${target.userId} FOR UPDATE`;
      // Await async work before asserting or releasing locks.
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      // Await async work before asserting or releasing locks.
      held(pid!); await gate;
    // Runner option controlling stability or isolation of the suite.
    }, { timeout: 20000 });
    // pid: unique stamp so parallel runs do not collide.
    const pid = await ready;
    // Bind operations for later setup or assertions in this scope.
    const operations = [
      // Execute the next setup or assertion step for this scenario.
      redeemInvitation({ code: first.code, password: "first-password", deviceLabel: "first", fingerprint: randomUUID() }),
      // Execute the next setup or assertion step for this scenario.
      redeemInvitation({ code: second.code, password: "second-password", deviceLabel: "second", fingerprint: randomUUID() }),
    ];
    // Try path where partial failure must not leak suite state.
    try { await waitForBackendsBlockedByHolderChain(prisma, pid, 2, 12000); }
    // Always run cleanup to preserve DB/server isolation across cases.
    finally { release(); }
    // Await async work before asserting or releasing locks.
    await holder;
    // results: capture concurrent outcomes for race assertions.
    const results = await Promise.all(operations);
    // stored: HTTP response captured for status/body checks.
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: target.userId } });
    // Assert the observed value matches the intended post-condition.
    assert.ok(stored.activatedAt);
    // matches: capture concurrent outcomes for race assertions.
    const matches = await Promise.all(["first-password", "second-password"].map(p => bcrypt.compare(p, stored.passwordHash)));
    // Assert collection size matches the expected post-condition.
    assert.equal(matches.filter(Boolean).length, 1);
    // Assert collection size matches the expected post-condition.
    assert.equal(await prisma.authSession.count({ where: { userId: target.userId, deviceId: { in: results.map(r => r.device.id) } } }), 2);
    // Assert the observed value matches the intended post-condition.
    for (const result of results) assert.equal(result.user.id, target.userId);
    // Iterate to cover variants or wait until a condition holds.
    for (const id of [first.invitation.id, second.invitation.id]) {
      // row: synchronize actors so the race window is observable.
      const row = await prisma.invitation.findUniqueOrThrow({ where: { id } });
      // Assert HTTP status matches the contract for this path.
      assert.equal(row.status, "consumed"); assert.ok(results.some(r => r.device.id === row.consumedDeviceId));
    }
  });
  // Case probes concurrency/isolation: concurrent revoke/redeem wait on the Invitation row and leave one consistent winner.
  it("concurrent revoke/redeem wait on the Invitation row and leave one consistent winner", async () => {
    // target: HTTP response captured for status/body checks.
    const target = await user(); const issued = await invite(target.employeeId);
    // Execute the next setup or assertion step for this scenario.
    let release!: () => void; let held!: (pid: number) => void;
    // Bind gate for later setup or assertions in this scope.
    const gate = new Promise<void>(r => { release = r; }); const ready = new Promise<number>(r => { held = r; });
    // Bind holder for later setup or assertions in this scope.
    const holder = prisma.$transaction(async tx => {
      // Await async work before asserting or releasing locks.
      await tx.$queryRaw`SELECT id FROM "Invitation" WHERE id = ${issued.invitation.id} FOR UPDATE`;
      // Await async work before asserting or releasing locks.
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`; held(pid!); await gate;
    // Runner option controlling stability or isolation of the suite.
    }, { timeout: 20000 });
    // pid: unique stamp so parallel runs do not collide.
    const pid = await ready;
    // operations: capture concurrent outcomes for race assertions.
    const operations = Promise.allSettled([
      // Execute the next setup or assertion step for this scenario.
      revokeInvitation(issued.invitation.id),
      // Concurrency/isolation step for the race under test.
      redeemInvitation({ code: issued.code, deviceLabel: "race", fingerprint: randomUUID() }),
    ]);
    // Try path where partial failure must not leak suite state.
    try { await waitForBackendsBlockedByHolderChain(prisma, pid, 2, 12000); } finally { release(); }
    // Await async work before asserting or releasing locks.
    await holder; const results = await operations;
    // Assert HTTP status matches the contract for this path.
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    // Assert HTTP status matches the contract for this path.
    for (const result of results) if (result.status === "rejected") assert.ok([400, 409].includes(result.reason.status), String(result.reason));
    // final: synchronize actors so the race window is observable.
    const final = await prisma.invitation.findUniqueOrThrow({ where: { id: issued.invitation.id } });
    // Guard optional cleanup or alternate assertion paths.
    if (final.status === "revoked") {
      // Assert collection size matches the expected post-condition.
      assert.equal(await prisma.device.count({ where: { userId: target.userId } }), 0);
      // Assert collection size matches the expected post-condition.
      assert.equal(await prisma.authSession.count({ where: { userId: target.userId } }), 0);
    // Execute the next setup or assertion step for this scenario.
    } else {
      // Assert HTTP status matches the contract for this path.
      assert.equal(final.status, "consumed"); assert.ok(final.consumedDeviceId);
      // Assert collection size matches the expected post-condition.
      assert.equal(await prisma.device.count({ where: { userId: target.userId, id: final.consumedDeviceId! } }), 1);
      // Assert collection size matches the expected post-condition.
      assert.equal(await prisma.authSession.count({ where: { userId: target.userId, deviceId: final.consumedDeviceId! } }), 1);
    }
  });
  // Case: revocation denies real access and refresh for A while B keeps access.
  it("revocation denies real access and refresh for A while B keeps access", async () => {
    // target: HTTP response captured for status/body checks.
    const target = await user();
    // a: unique stamp so parallel runs do not collide.
    const a = await redeemInvitation({ code: (await invite(target.employeeId)).code, deviceLabel: "A", fingerprint: randomUUID() });
    // b: unique stamp so parallel runs do not collide.
    const b = await redeemInvitation({ code: (await invite(target.employeeId)).code, deviceLabel: "B", fingerprint: randomUUID() });
    // Bind access for later setup or assertions in this scope.
    const access = (t: string) => fetch(`${api}/auth/me`, { headers: { Authorization: `Bearer ${t}` } });
    // Assert HTTP status matches the contract for this path.
    assert.equal((await access(a.accessToken)).status, 200);
    // Assert HTTP status matches the contract for this path.
    assert.equal((await postJson(api, token, `/devices/${a.device.id}/revoke`, {})).status, 200);
    // Assert HTTP status matches the contract for this path.
    assert.equal((await access(a.accessToken)).status, 401);
    // Assert HTTP status matches the contract for this path.
    assert.equal((await access(b.accessToken)).status, 200);
    // refresh: HTTP response captured for status/body checks.
    const refresh = await fetch(`${api}/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: a.refreshToken }) });
    // Assert HTTP status matches the contract for this path.
    assert.equal(refresh.status, 401);
    // Assert HTTP status matches the contract for this path.
    assert.equal((await access(b.accessToken)).status, 200);
  });
});
