// Load isolated P1 test env before any Prisma/DB clients connect.
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../../src/db";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Shared test fixtures for seeding users, locations, and domain entities.
import { createEmployeeWithUser } from "../fixtures";
// HTTP harness to listen an in-process API for request-level tests.
import { closeServer, listenApp, loginBearer, postJson } from "../httpHarness";
import { issueInvitation, redeemInvitation, revokeInvitation } from "../../src/services/invitations";
// Shared test fixtures for seeding users, locations, and domain entities.
import { waitForBackendsBlockedByHolderChain } from "../attendance/fixtures";

const stamp = randomUUID();
const password = "scenario-password-123";
const employees: string[] = [];
let api: string;
let server: Awaited<ReturnType<typeof listenApp>>["server"];
let owner: Awaited<ReturnType<typeof createEmployeeWithUser>>;
let token: string;
// Local helper user used by cases in this file.
async function user(role: "owner" | "manager" | "housekeeper" = "housekeeper") {
  const id = randomUUID();
  // value: seeded entity required before the mutation under test.
  const value = await createEmployeeWithUser(prisma, {
    employeeNumber: id, email: `${id}@scenario.test`, role, fullName: `Scenario ${stamp}`, password,
  });
  employees.push(value.employeeId);
  return value;
}
// Local helper noSecrets used by cases in this file.
function noSecrets(value: unknown) {
  const json = JSON.stringify(value);
  assert.doesNotMatch(json, /"(?:password|passwordHash|accessToken|refreshToken|token|refreshTokenHash)"\s*:/);
  assert.ok(!json.includes(password));
}
// Local helper invite used by cases in this file.
async function invite(employeeId: string) {
  return issueInvitation({ userId: owner.userId, role: "owner" }, { kind: "existing", employeeId });
}
// Local helper redeem used by cases in this file.
async function redeem(code: string, nextPassword?: string) {
  return fetch(`${api}/invitations/redeem`, {
    // Configure method for the request/server under test.
    method: "POST", headers: { "Content-Type": "application/json" },
    // Configure body for the request/server under test.
    body: JSON.stringify({ code, password: nextPassword, deviceLabel: "Test", fingerprint: randomUUID() }),
  });
}

// Suite: invitations and real sessions.
describe("invitations and real sessions", () => {
  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    process.env.E2E_DISABLE_RATE_LIMIT = "1";
    owner = await user("owner");
    ({ api, server } = await listenApp());
    token = (await loginBearer(api, owner.email, password)).token;
  });
  after(async () => {
    if (server) await closeServer(server);
    await prisma.invitation.deleteMany({ where: { employeeId: { in: employees } } });
    await prisma.authSession.deleteMany({ where: { user: { employeeId: { in: employees } } } });
    await prisma.device.deleteMany({ where: { employeeId: { in: employees } } });
    await prisma.user.deleteMany({ where: { employeeId: { in: employees } } });
    await prisma.employee.deleteMany({ where: { id: { in: employees } } });
    await prisma.$disconnect();
  });
  // Case: pending login and rejected activation leave no session; activation succeeds with cookie-only secrets.
  it("pending login and rejected activation leave no session; activation succeeds with cookie-only secrets", async () => {
    const target = await user();
    await prisma.user.update({ where: { id: target.userId }, data: { activatedAt: null } });
    const login = await fetch(`${api}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: target.email, password }) });
    assert.equal(login.status, 403);
    assert.equal(login.headers.get("set-cookie"), null);
    const issued = await invite(target.employeeId);
    for (const invalid of [undefined, "1234567"]) {
      const rejected = await redeem(issued.code, invalid);
      assert.equal(rejected.status, 400);
      assert.equal(rejected.headers.get("set-cookie"), null);
      assert.equal((await prisma.invitation.findUniqueOrThrow({ where: { id: issued.invitation.id } })).status, "issued");
      assert.equal(await prisma.device.count({ where: { userId: target.userId } }), 0);
      assert.equal(await prisma.authSession.count({ where: { userId: target.userId } }), 0);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target.userId } })).activatedAt, null);
    }
    const accepted = await redeem(issued.code, "12345678");
    assert.equal(accepted.status, 200);
    noSecrets(await accepted.json());
    // cookies: session cookie jar for authenticated requests.
    const cookies = accepted.headers.getSetCookie();
    for (const name of ["session", "refresh"]) assert.ok(cookies.some(c => c.startsWith(`${name}=`) && /httponly/i.test(c)), `${name} HttpOnly`);
    const authenticated = await loginBearer(api, target.email, "12345678");
    const loginSuccess = await fetch(`${api}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: target.email, password: "12345678" }) });
    assert.equal(loginSuccess.status, 200); noSecrets(await loginSuccess.json());
    const me = await fetch(`${api}/auth/me`, { headers: { Authorization: `Bearer ${authenticated.token}` } });
    assert.equal(me.status, 200); noSecrets(await me.json());
  });
  // Case: existing employee onboarding validation and late insert rollback.
  it("existing employee onboarding validation and late insert rollback", async () => {
    const employee = await prisma.employee.create({ data: { employeeNumber: randomUUID(), fullName: "Without login" } });
    employees.push(employee.id);
    for (const extra of [{}, { email: `${randomUUID()}@scenario.test` }, { role: "housekeeper" }, { email: owner.email, role: "housekeeper" }]) {
      const res = await postJson(api, token, "/invitations", { kind: "existing", employeeId: employee.id, ...extra });
      assert.ok([400, 409].includes(res.status), JSON.stringify(res));
      assert.equal(await prisma.user.count({ where: { employeeId: employee.id } }), 0);
    }
    const manager = await user("manager");
    const managerToken = (await loginBearer(api, manager.email, password)).token;
    const rejected = await postJson(api, managerToken, "/invitations", { kind: "existing", employeeId: employee.id, email: `${randomUUID()}@scenario.test`, role: "owner" });
    assert.equal(rejected.status, 403);
    // The trigger runs only after seeing the newly inserted User inside the TX.
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION scenario_invite_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."employeeId" = '${employee.id}' AND EXISTS (SELECT 1 FROM "User" WHERE "employeeId" = NEW."employeeId") THEN RAISE EXCEPTION 'scenario_late_invitation_insert_after_user'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe('CREATE TRIGGER scenario_invite_fail BEFORE INSERT ON "Invitation" FOR EACH ROW EXECUTE FUNCTION scenario_invite_fail()');
    try {
      await assert.rejects(issueInvitation({ userId: owner.userId, role: "owner" }, { kind: "existing", employeeId: employee.id, email: `${randomUUID()}@scenario.test`, role: "housekeeper" }), /scenario_late_invitation_insert_after_user/);
      assert.equal(await prisma.user.count({ where: { employeeId: employee.id } }), 0);
      assert.equal(await prisma.invitation.count({ where: { employeeId: employee.id } }), 0);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER scenario_invite_fail ON "Invitation"');
      await prisma.$executeRawUnsafe('DROP FUNCTION scenario_invite_fail()');
    }
    const accepted = await postJson(api, token, "/invitations", { kind: "existing", employeeId: employee.id, email: `${randomUUID()}@scenario.test`, role: "housekeeper" });
    assert.equal(accepted.status, 201);
  });
  // Case: reissue/revoke reject old codes; adding a device preserves password.
  it("reissue/revoke reject old codes; adding a device preserves password", async () => {
    const target = await user();
    const first = await invite(target.employeeId);
    const second = await invite(target.employeeId);
    assert.equal((await prisma.invitation.findUniqueOrThrow({ where: { id: first.invitation.id } })).status, "revoked");
    assert.equal((await redeem(first.code)).status, 400);
    const before = await prisma.user.findUniqueOrThrow({ where: { id: target.userId } });
    assert.equal((await redeem(second.code, "a-different-password")).status, 200);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target.userId } })).passwordHash, before.passwordHash);
    await loginBearer(api, target.email, password);
    const third = await invite(target.employeeId);
    await revokeInvitation(third.invitation.id);
    assert.equal((await redeem(third.code)).status, 400);
    assert.equal(await prisma.device.count({ where: { userId: target.userId } }), 1);
    assert.equal((await prisma.invitation.findUniqueOrThrow({ where: { id: second.invitation.id } })).status, "consumed");
  });
  // Case probes concurrency/isolation: distinct invites overlap behind a real User lock and retain the winning password.
  it("distinct invites overlap behind a real User lock and retain the winning password", async () => {
    const target = await user();
    await prisma.user.update({ where: { id: target.userId }, data: { activatedAt: null } });
    const first = await invite(target.employeeId);
    const second = await invite(target.employeeId);
    await prisma.invitation.update({ where: { id: first.invitation.id }, data: { status: "issued", revokedAt: null } });
    let release!: () => void;
    let held!: (pid: number) => void;
    const ready = new Promise<number>(r => { held = r; });
    const gate = new Promise<void>(r => { release = r; });
    const holder = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${target.userId} FOR UPDATE`;
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      held(pid!); await gate;
    // Runner option controlling stability or isolation of the suite.
    }, { timeout: 20000 });
    const pid = await ready;
    const operations = [
      redeemInvitation({ code: first.code, password: "first-password", deviceLabel: "first", fingerprint: randomUUID() }),
      redeemInvitation({ code: second.code, password: "second-password", deviceLabel: "second", fingerprint: randomUUID() }),
    ];
    try { await waitForBackendsBlockedByHolderChain(prisma, pid, 2, 12000); }
    // Always run cleanup to preserve DB/server isolation across cases.
    finally { release(); }
    await holder;
    // results: capture concurrent outcomes for race assertions.
    const results = await Promise.all(operations);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: target.userId } });
    assert.ok(stored.activatedAt);
    // matches: capture concurrent outcomes for race assertions.
    const matches = await Promise.all(["first-password", "second-password"].map(p => bcrypt.compare(p, stored.passwordHash)));
    assert.equal(matches.filter(Boolean).length, 1);
    assert.equal(await prisma.authSession.count({ where: { userId: target.userId, deviceId: { in: results.map(r => r.device.id) } } }), 2);
    for (const result of results) assert.equal(result.user.id, target.userId);
    for (const id of [first.invitation.id, second.invitation.id]) {
      const row = await prisma.invitation.findUniqueOrThrow({ where: { id } });
      assert.equal(row.status, "consumed"); assert.ok(results.some(r => r.device.id === row.consumedDeviceId));
    }
  });
  // Case probes concurrency/isolation: concurrent revoke/redeem wait on the Invitation row and leave one consistent winner.
  it("concurrent revoke/redeem wait on the Invitation row and leave one consistent winner", async () => {
    const target = await user(); const issued = await invite(target.employeeId);
    let release!: () => void; let held!: (pid: number) => void;
    const gate = new Promise<void>(r => { release = r; }); const ready = new Promise<number>(r => { held = r; });
    const holder = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Invitation" WHERE id = ${issued.invitation.id} FOR UPDATE`;
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`; held(pid!); await gate;
    // Runner option controlling stability or isolation of the suite.
    }, { timeout: 20000 });
    const pid = await ready;
    // operations: capture concurrent outcomes for race assertions.
    const operations = Promise.allSettled([
      revokeInvitation(issued.invitation.id),
      redeemInvitation({ code: issued.code, deviceLabel: "race", fingerprint: randomUUID() }),
    ]);
    try { await waitForBackendsBlockedByHolderChain(prisma, pid, 2, 12000); } finally { release(); }
    await holder; const results = await operations;
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    for (const result of results) if (result.status === "rejected") assert.ok([400, 409].includes(result.reason.status), String(result.reason));
    const final = await prisma.invitation.findUniqueOrThrow({ where: { id: issued.invitation.id } });
    if (final.status === "revoked") {
      assert.equal(await prisma.device.count({ where: { userId: target.userId } }), 0);
      assert.equal(await prisma.authSession.count({ where: { userId: target.userId } }), 0);
    } else {
      assert.equal(final.status, "consumed"); assert.ok(final.consumedDeviceId);
      assert.equal(await prisma.device.count({ where: { userId: target.userId, id: final.consumedDeviceId! } }), 1);
      assert.equal(await prisma.authSession.count({ where: { userId: target.userId, deviceId: final.consumedDeviceId! } }), 1);
    }
  });
  // Case: revocation denies real access and refresh for A while B keeps access.
  it("revocation denies real access and refresh for A while B keeps access", async () => {
    const target = await user();
    const a = await redeemInvitation({ code: (await invite(target.employeeId)).code, deviceLabel: "A", fingerprint: randomUUID() });
    const b = await redeemInvitation({ code: (await invite(target.employeeId)).code, deviceLabel: "B", fingerprint: randomUUID() });
    const access = (t: string) => fetch(`${api}/auth/me`, { headers: { Authorization: `Bearer ${t}` } });
    assert.equal((await access(a.accessToken)).status, 200);
    assert.equal((await postJson(api, token, `/devices/${a.device.id}/revoke`, {})).status, 200);
    assert.equal((await access(a.accessToken)).status, 401);
    assert.equal((await access(b.accessToken)).status, 200);
    const refresh = await fetch(`${api}/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: a.refreshToken }) });
    assert.equal(refresh.status, 401);
    assert.equal((await access(b.accessToken)).status, 200);
  });
});
