/**
 * Cross-process RoleGrant authorization: two real Node API processes share one
 * Postgres DB and must not serve stale canPerform results after a remote revoke.
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { PrismaClient, Role } from "@prisma/client";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
import {
  createEmployeeWithUser,
  cleanupEmployeeGraph,
} from "../fixtures";
import {
  getJson,
  loginBearer,
  putRoleGrantsJson,
  restoreRoleGrants,
  snapshotRoleGrants,
  // Shape RoleGrantSnapshotRow documents the fixture/response fields this suite touches.
  type RoleGrantSnapshotRow,
} from "../httpHarness";
import { DEFAULT_ACTION_GRANTS, DEFAULT_PANEL_GRANTS, MATRIX_ROLES } from "../../src/permissions";
import { ensureDefaultRoleGrants } from "../../src/services/roleGrants";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();
const apiRoot = path.resolve(__dirname, "../..");
// serverEntry: in-process HTTP server handle for this suite.
const serverEntry = path.join(apiRoot, "tests/auth/crossInstance.server.ts");
const PASSWORD = "test-password-cross-instance";

// Shape Instance documents the fixture/response fields this suite touches.
type Instance = {
  child: ChildProcess;
  api: string;
  port: number;
};

// Local helper spawnApiInstance used by cases in this file.
async function spawnApiInstance(): Promise<Instance> {
  const child = spawn(
    process.execPath,
    [
      "--import",
      "./tests/registerP1TestEnv.mjs",
      "--import",
      "tsx",
      serverEntry,
    ],
    {
      // Configure cwd for the request/server under test.
      cwd: apiRoot,
      // Configure env for the request/server under test.
      env: {
        ...process.env,
        DISABLE_JOB_SCHEDULER: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`cross-instance server timed out (stderr=${stderr})`));
    }, 30_000);
    let stdout = "";
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      const match = /CROSS_INSTANCE_READY ({.*})/.exec(stdout);
      if (match) {
        clearTimeout(timer);
        try {
          resolve((JSON.parse(match[1]!) as { port: number }).port);
        } catch (err) {
          reject(err);
        }
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`cross-instance server exited early code=${code} stderr=${stderr}`));
    });
  });
  return { child, port, api: `http://127.0.0.1:${port}` };
}

// Local helper stopInstance used by cases in this file.
async function stopInstance(instance: Instance | null): Promise<void> {
  if (!instance) return;
  instance.child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      instance.child.kill("SIGKILL");
      resolve();
    }, 5_000);
    instance.child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// Suite: cross-instance RoleGrant authorization.
describe("cross-instance RoleGrant authorization", () => {
  let instanceA: Instance | null = null;
  let instanceB: Instance | null = null;
  let snapshot: RoleGrantSnapshotRow[] = [];
  let ownerIds: string[] = [];
  let managerIds: string[] = [];
  let ownerEmail = "";
  let managerEmail = "";

  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    await ensureDefaultRoleGrants();
    snapshot = await snapshotRoleGrants(prisma, [...MATRIX_ROLES]);

    const stamp = Date.now();
    // owner: seeded entity required before the mutation under test.
    const owner = await createEmployeeWithUser(prisma, {
      employeeNumber: `XINST-OWN-${stamp}`,
      email: `xinst-own-${stamp}@test.local`,
      role: Role.owner,
      fullName: "XInst Owner",
      password: PASSWORD,
    });
    // manager: seeded entity required before the mutation under test.
    const manager = await createEmployeeWithUser(prisma, {
      employeeNumber: `XINST-MGR-${stamp}`,
      email: `xinst-mgr-${stamp}@test.local`,
      role: Role.manager,
      fullName: "XInst Manager",
      password: PASSWORD,
    });
    ownerIds = [owner.employeeId];
    managerIds = [manager.employeeId];
    ownerEmail = owner.email;
    managerEmail = manager.email;

    instanceA = await spawnApiInstance();
    instanceB = await spawnApiInstance();
  });

  after(async () => {
    await stopInstance(instanceA);
    await stopInstance(instanceB);
    instanceA = null;
    instanceB = null;
    await restoreRoleGrants(prisma, [...MATRIX_ROLES], snapshot);
    if (ownerIds.length) await cleanupEmployeeGraph(prisma, ownerIds);
    if (managerIds.length) await cleanupEmployeeGraph(prisma, managerIds);
    await prisma.$disconnect();
  });

  // Case: revoking grants on instance A denies the action on instance B immediately.
  it("revoking grants on instance A denies the action on instance B immediately", async () => {
    assert.ok(instanceA && instanceB);
    const ownerLogin = await loginBearer(instanceA.api, ownerEmail, PASSWORD);
    const managerOnB = await loginBearer(instanceB.api, managerEmail, PASSWORD);

    // Warm instance B's in-process grant cache while manager still has rooms.view.
    const warm = await getJson(instanceB.api, managerOnB.token, "/rooms");
    assert.equal(warm.status, 200, `warm /rooms → ${warm.status}`);

    // Revoke every manager action via instance A (bumps RoleGrantRevision).
    const revoke = await putRoleGrantsJson(instanceA.api, ownerLogin.token, "manager", {
      panels: [...DEFAULT_PANEL_GRANTS.manager],
      actions: [],
      reason: "cross-instance revoke proof",
    });
    assert.equal(revoke.status, 200, `revoke → ${revoke.status} ${JSON.stringify(revoke.body)}`);

    // Immediate request on B must see the new stamp and deny — not the ≤5s TTL window.
    const denied = await getJson(instanceB.api, managerOnB.token, "/rooms");
    assert.equal(denied.status, 403, `post-revoke /rooms on B → ${denied.status}`);
    assert.equal(
      (denied.body as { error?: string }).error,
      "forbidden",
    );

    // Restore manager defaults through A so later scenarios start clean.
    const restore = await putRoleGrantsJson(instanceA.api, ownerLogin.token, "manager", {
      panels: [...DEFAULT_PANEL_GRANTS.manager],
      actions: [...DEFAULT_ACTION_GRANTS.manager],
      reason: "cross-instance restore",
    });
    assert.equal(restore.status, 200, `restore → ${restore.status}`);
  });

  // Case checks authz/session policy: role change on A is visible to authenticated requests on B.
  it("role change on A is visible to authenticated requests on B", async () => {
    assert.ok(instanceA && instanceB);
    const managerOnB = await loginBearer(instanceB.api, managerEmail, PASSWORD);
    // people.view is granted to manager, not housekeeper.
    const warm = await getJson(instanceB.api, managerOnB.token, "/people");
    assert.equal(warm.status, 200, `warm /people → ${warm.status}`);

    await prisma.user.update({
      where: { email: managerEmail },
      data: { role: Role.housekeeper },
    });

    // authenticateToken loads role from DB every request — no grant-cache dependence.
    const after = await getJson(instanceB.api, managerOnB.token, "/people");
    assert.equal(after.status, 403, `housekeeper /people → ${after.status}`);

    await prisma.user.update({
      where: { email: managerEmail },
      data: { role: Role.manager },
    });
  });

  // Case: session revoke on A rejects the same token on B.
  it("session revoke on A rejects the same token on B", async () => {
    assert.ok(instanceA && instanceB);
    const managerOnB = await loginBearer(instanceB.api, managerEmail, PASSWORD);
    const ok = await getJson(instanceB.api, managerOnB.token, "/rooms");
    assert.equal(ok.status, 200);

    // sessions: session cookie jar for authenticated requests.
    const sessions = await prisma.authSession.findMany({
      where: { user: { email: managerEmail }, revokedAt: null },
      select: { id: true },
    });
    assert.ok(sessions.length >= 1);
    await prisma.authSession.updateMany({
      where: { id: { in: sessions.map((s) => s.id) } },
      data: { revokedAt: new Date() },
    });

    const denied = await getJson(instanceB.api, managerOnB.token, "/rooms");
    assert.equal(denied.status, 401, `revoked session on B → ${denied.status}`);
  });
});
