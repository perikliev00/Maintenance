/**
 * Cross-process RoleGrant authorization: two real Node API processes share one
 * Postgres DB and must not serve stale canPerform results after a remote revoke.
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Import bindings from node:child_process.
import { spawn, type ChildProcess } from "node:child_process";
// Import bindings from node:path.
import path from "node:path";
// Node test runner and strict assertions for API suite checks.
import { after, before, describe, it } from "node:test";
// Prisma client types/runtime for DB setup and assertions.
import { PrismaClient, Role } from "@prisma/client";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  createEmployeeWithUser,
  // Execute the next setup or assertion step for this scenario.
  cleanupEmployeeGraph,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "../fixtures";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  getJson,
  // Session/CSRF step exercising auth lifecycle.
  loginBearer,
  // Execute the next setup or assertion step for this scenario.
  putRoleGrantsJson,
  // Execute the next setup or assertion step for this scenario.
  restoreRoleGrants,
  // Execute the next setup or assertion step for this scenario.
  snapshotRoleGrants,
  // Shape RoleGrantSnapshotRow documents the fixture/response fields this suite touches.
  type RoleGrantSnapshotRow,
// Execute the next setup or assertion step for this scenario.
} from "../httpHarness";
// Import bindings from ../../src/permissions.
import { DEFAULT_ACTION_GRANTS, DEFAULT_PANEL_GRANTS, MATRIX_ROLES } from "../../src/permissions";
// Import bindings from ../../src/services/roleGrants.
import { ensureDefaultRoleGrants } from "../../src/services/roleGrants";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();
// Bind apiRoot for later setup or assertions in this scope.
const apiRoot = path.resolve(__dirname, "../..");
// serverEntry: in-process HTTP server handle for this suite.
const serverEntry = path.join(apiRoot, "tests/auth/crossInstance.server.ts");
// PASSWORD: credential/token material for auth flows.
const PASSWORD = "test-password-cross-instance";

// Shape Instance documents the fixture/response fields this suite touches.
type Instance = {
  // Execute the next setup or assertion step for this scenario.
  child: ChildProcess;
  // Execute the next setup or assertion step for this scenario.
  api: string;
  // Execute the next setup or assertion step for this scenario.
  port: number;
};

// Local helper spawnApiInstance used by cases in this file.
async function spawnApiInstance(): Promise<Instance> {
  // Bind child for later setup or assertions in this scope.
  const child = spawn(
    // Execute the next setup or assertion step for this scenario.
    process.execPath,
    [
      // Execute the next setup or assertion step for this scenario.
      "--import",
      // Execute the next setup or assertion step for this scenario.
      "./tests/registerP1TestEnv.mjs",
      // Execute the next setup or assertion step for this scenario.
      "--import",
      // Execute the next setup or assertion step for this scenario.
      "tsx",
      // Execute the next setup or assertion step for this scenario.
      serverEntry,
    ],
    {
      // Configure cwd for the request/server under test.
      cwd: apiRoot,
      // Configure env for the request/server under test.
      env: {
        // Continue the call chain for setup or assertion detail.
        ...process.env,
        // Execute the next setup or assertion step for this scenario.
        DISABLE_JOB_SCHEDULER: "1",
      },
      // Execute the next setup or assertion step for this scenario.
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  // port: synchronize actors so the race window is observable.
  const port = await new Promise<number>((resolve, reject) => {
    // Bind timer for later setup or assertions in this scope.
    const timer = setTimeout(() => {
      // Execute the next setup or assertion step for this scenario.
      reject(new Error(`cross-instance server timed out (stderr=${stderr})`));
    // Execute the next setup or assertion step for this scenario.
    }, 30_000);
    // Bind stdout for later setup or assertions in this scope.
    let stdout = "";
    // Bind stderr for later setup or assertions in this scope.
    let stderr = "";
    // Execute the next setup or assertion step for this scenario.
    child.stderr.on("data", (chunk: Buffer) => {
      // Execute the next setup or assertion step for this scenario.
      stderr += chunk.toString("utf8");
    });
    // Execute the next setup or assertion step for this scenario.
    child.stdout.on("data", (chunk: Buffer) => {
      // Execute the next setup or assertion step for this scenario.
      stdout += chunk.toString("utf8");
      // Bind match for later setup or assertions in this scope.
      const match = /CROSS_INSTANCE_READY ({.*})/.exec(stdout);
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (match) {
        // Execute the next setup or assertion step for this scenario.
        clearTimeout(timer);
        // Try path where partial failure must not leak suite state.
        try {
          // Execute the next setup or assertion step for this scenario.
          resolve((JSON.parse(match[1]!) as { port: number }).port);
        // Execute the next setup or assertion step for this scenario.
        } catch (err) {
          // Execute the next setup or assertion step for this scenario.
          reject(err);
        }
      }
    });
    // Execute the next setup or assertion step for this scenario.
    child.on("exit", (code) => {
      // Execute the next setup or assertion step for this scenario.
      clearTimeout(timer);
      // Execute the next setup or assertion step for this scenario.
      reject(new Error(`cross-instance server exited early code=${code} stderr=${stderr}`));
    });
  });
  // Return the arranged value/result to the caller.
  return { child, port, api: `http://127.0.0.1:${port}` };
}

// Local helper stopInstance used by cases in this file.
async function stopInstance(instance: Instance | null): Promise<void> {
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (!instance) return;
  // Execute the next setup or assertion step for this scenario.
  instance.child.kill("SIGTERM");
  // Await async work before asserting or releasing locks.
  await new Promise<void>((resolve) => {
    // Bind timer for later setup or assertions in this scope.
    const timer = setTimeout(() => {
      // Execute the next setup or assertion step for this scenario.
      instance.child.kill("SIGKILL");
      // Execute the next setup or assertion step for this scenario.
      resolve();
    // Execute the next setup or assertion step for this scenario.
    }, 5_000);
    // Execute the next setup or assertion step for this scenario.
    instance.child.once("exit", () => {
      // Execute the next setup or assertion step for this scenario.
      clearTimeout(timer);
      // Execute the next setup or assertion step for this scenario.
      resolve();
    });
  });
}

// Suite: cross-instance RoleGrant authorization.
describe("cross-instance RoleGrant authorization", () => {
  // Execute the next setup or assertion step for this scenario.
  let instanceA: Instance | null = null;
  // Execute the next setup or assertion step for this scenario.
  let instanceB: Instance | null = null;
  // Execute the next setup or assertion step for this scenario.
  let snapshot: RoleGrantSnapshotRow[] = [];
  // Execute the next setup or assertion step for this scenario.
  let ownerIds: string[] = [];
  // Execute the next setup or assertion step for this scenario.
  let managerIds: string[] = [];
  // Bind ownerEmail for later setup or assertions in this scope.
  let ownerEmail = "";
  // Bind managerEmail for later setup or assertions in this scope.
  let managerEmail = "";

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    // Await async work before asserting or releasing locks.
    await ensureDefaultRoleGrants();
    // Await async work before asserting or releasing locks.
    snapshot = await snapshotRoleGrants(prisma, [...MATRIX_ROLES]);

    // stamp: unique stamp so parallel runs do not collide.
    const stamp = Date.now();
    // owner: seeded entity required before the mutation under test.
    const owner = await createEmployeeWithUser(prisma, {
      // Fixture field employeeNumber for the seeded actor/entity.
      employeeNumber: `XINST-OWN-${stamp}`,
      // Fixture field email for the seeded actor/entity.
      email: `xinst-own-${stamp}@test.local`,
      // Fixture field role for the seeded actor/entity.
      role: Role.owner,
      // Fixture field fullName for the seeded actor/entity.
      fullName: "XInst Owner",
      // Fixture field password for the seeded actor/entity.
      password: PASSWORD,
    });
    // manager: seeded entity required before the mutation under test.
    const manager = await createEmployeeWithUser(prisma, {
      // Fixture field employeeNumber for the seeded actor/entity.
      employeeNumber: `XINST-MGR-${stamp}`,
      // Fixture field email for the seeded actor/entity.
      email: `xinst-mgr-${stamp}@test.local`,
      // Fixture field role for the seeded actor/entity.
      role: Role.manager,
      // Fixture field fullName for the seeded actor/entity.
      fullName: "XInst Manager",
      // Fixture field password for the seeded actor/entity.
      password: PASSWORD,
    });
    // Execute the next setup or assertion step for this scenario.
    ownerIds = [owner.employeeId];
    // Execute the next setup or assertion step for this scenario.
    managerIds = [manager.employeeId];
    // Execute the next setup or assertion step for this scenario.
    ownerEmail = owner.email;
    // Execute the next setup or assertion step for this scenario.
    managerEmail = manager.email;

    // Await async work before asserting or releasing locks.
    instanceA = await spawnApiInstance();
    // Await async work before asserting or releasing locks.
    instanceB = await spawnApiInstance();
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Await async work before asserting or releasing locks.
    await stopInstance(instanceA);
    // Await async work before asserting or releasing locks.
    await stopInstance(instanceB);
    // Execute the next setup or assertion step for this scenario.
    instanceA = null;
    // Execute the next setup or assertion step for this scenario.
    instanceB = null;
    // Await async work before asserting or releasing locks.
    await restoreRoleGrants(prisma, [...MATRIX_ROLES], snapshot);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (ownerIds.length) await cleanupEmployeeGraph(prisma, ownerIds);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (managerIds.length) await cleanupEmployeeGraph(prisma, managerIds);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Case: revoking grants on instance A denies the action on instance B immediately.
  it("revoking grants on instance A denies the action on instance B immediately", async () => {
    // Assert the observed value matches the intended post-condition.
    assert.ok(instanceA && instanceB);
    // ownerLogin: synchronize actors so the race window is observable.
    const ownerLogin = await loginBearer(instanceA.api, ownerEmail, PASSWORD);
    // managerOnB: synchronize actors so the race window is observable.
    const managerOnB = await loginBearer(instanceB.api, managerEmail, PASSWORD);

    // Warm instance B's in-process grant cache while manager still has rooms.view.
    const warm = await getJson(instanceB.api, managerOnB.token, "/rooms");
    // Assert HTTP status matches the contract for this path.
    assert.equal(warm.status, 200, `warm /rooms → ${warm.status}`);

    // Revoke every manager action via instance A (bumps RoleGrantRevision).
    const revoke = await putRoleGrantsJson(instanceA.api, ownerLogin.token, "manager", {
      // Execute the next setup or assertion step for this scenario.
      panels: [...DEFAULT_PANEL_GRANTS.manager],
      // Execute the next setup or assertion step for this scenario.
      actions: [],
      // Execute the next setup or assertion step for this scenario.
      reason: "cross-instance revoke proof",
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(revoke.status, 200, `revoke → ${revoke.status} ${JSON.stringify(revoke.body)}`);

    // Immediate request on B must see the new stamp and deny — not the ≤5s TTL window.
    const denied = await getJson(instanceB.api, managerOnB.token, "/rooms");
    // Assert HTTP status matches the contract for this path.
    assert.equal(denied.status, 403, `post-revoke /rooms on B → ${denied.status}`);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      (denied.body as { error?: string }).error,
      // Execute the next setup or assertion step for this scenario.
      "forbidden",
    );

    // Restore manager defaults through A so later scenarios start clean.
    const restore = await putRoleGrantsJson(instanceA.api, ownerLogin.token, "manager", {
      // Execute the next setup or assertion step for this scenario.
      panels: [...DEFAULT_PANEL_GRANTS.manager],
      // Execute the next setup or assertion step for this scenario.
      actions: [...DEFAULT_ACTION_GRANTS.manager],
      // Execute the next setup or assertion step for this scenario.
      reason: "cross-instance restore",
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(restore.status, 200, `restore → ${restore.status}`);
  });

  // Case checks authz/session policy: role change on A is visible to authenticated requests on B.
  it("role change on A is visible to authenticated requests on B", async () => {
    // Assert the observed value matches the intended post-condition.
    assert.ok(instanceA && instanceB);
    // managerOnB: synchronize actors so the race window is observable.
    const managerOnB = await loginBearer(instanceB.api, managerEmail, PASSWORD);
    // people.view is granted to manager, not housekeeper.
    const warm = await getJson(instanceB.api, managerOnB.token, "/people");
    // Assert HTTP status matches the contract for this path.
    assert.equal(warm.status, 200, `warm /people → ${warm.status}`);

    // Await async work before asserting or releasing locks.
    await prisma.user.update({
      // SQL fragment used to observe locks or assert DB state.
      where: { email: managerEmail },
      // Execute the next setup or assertion step for this scenario.
      data: { role: Role.housekeeper },
    });

    // authenticateToken loads role from DB every request — no grant-cache dependence.
    const after = await getJson(instanceB.api, managerOnB.token, "/people");
    // Assert HTTP status matches the contract for this path.
    assert.equal(after.status, 403, `housekeeper /people → ${after.status}`);

    // Await async work before asserting or releasing locks.
    await prisma.user.update({
      // SQL fragment used to observe locks or assert DB state.
      where: { email: managerEmail },
      // Execute the next setup or assertion step for this scenario.
      data: { role: Role.manager },
    });
  });

  // Case: session revoke on A rejects the same token on B.
  it("session revoke on A rejects the same token on B", async () => {
    // Assert the observed value matches the intended post-condition.
    assert.ok(instanceA && instanceB);
    // managerOnB: synchronize actors so the race window is observable.
    const managerOnB = await loginBearer(instanceB.api, managerEmail, PASSWORD);
    // ok: HTTP response captured for status/body checks.
    const ok = await getJson(instanceB.api, managerOnB.token, "/rooms");
    // Assert HTTP status matches the contract for this path.
    assert.equal(ok.status, 200);

    // sessions: session cookie jar for authenticated requests.
    const sessions = await prisma.authSession.findMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { user: { email: managerEmail }, revokedAt: null },
      // SQL fragment used to observe locks or assert DB state.
      select: { id: true },
    });
    // Assert collection size matches the expected post-condition.
    assert.ok(sessions.length >= 1);
    // Await async work before asserting or releasing locks.
    await prisma.authSession.updateMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: { in: sessions.map((s) => s.id) } },
      // Execute the next setup or assertion step for this scenario.
      data: { revokedAt: new Date() },
    });

    // denied: HTTP response captured for status/body checks.
    const denied = await getJson(instanceB.api, managerOnB.token, "/rooms");
    // Assert HTTP status matches the contract for this path.
    assert.equal(denied.status, 401, `revoked session on B → ${denied.status}`);
  });
});
