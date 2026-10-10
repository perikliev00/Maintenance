/**
 * Assert-based data-scope smoke with in-process HTTP server.
 * Creates two controlled sectors; fails if foreign access is allowed or fixtures missing.
 */
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import dotenv from "dotenv";
import { PrismaClient, Role } from "@prisma/client";
import { createApp } from "../src/app";
import { canDeliverLiveEvent } from "../src/events/authorizeLiveEvent";
import { resolveDataScope } from "../src/services/dataScope";
import {
  cleanupScopeSmokeFixture,
  createScopeSmokeFixture,
  type ScopeSmokeFixture,
} from "../tests/fixtures";

dotenv.config({
  path: path.resolve(__dirname, "../.env"),
  override: true,
});

const prisma = new PrismaClient();

function sessionFromSetCookie(res: Response): string | null {
  const getSetCookie = (
    res.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie;
  const lines =
    typeof getSetCookie === "function"
      ? getSetCookie.call(res.headers)
      : ([res.headers.get("set-cookie")].filter(Boolean) as string[]);
  for (const line of lines) {
    const m = /^session=([^;]+)/.exec(line);
    if (m) return decodeURIComponent(m[1]!);
  }
  return null;
}

async function login(api: string, email: string, password: string) {
  const res = await fetch(`${api}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.ok, true, `login ${email} → ${res.status}`);
  const body = (await res.json()) as { user: { employeeId: string; role: Role } };
  const token = sessionFromSetCookie(res);
  assert.ok(token, `login ${email}: missing session cookie`);
  return { token, user: body.user };
}

async function getJson(api: string, token: string, pathName: string) {
  const res = await fetch(`${api}${pathName}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function postJson(
  api: string,
  token: string,
  pathName: string,
  payload: unknown,
) {
  const res = await fetch(`${api}${pathName}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

function asIdList(body: unknown): Array<{ id: string }> {
  assert.ok(Array.isArray(body), "expected JSON array");
  return body as Array<{ id: string }>;
}

async function listenApp(): Promise<{ server: http.Server; api: string }> {
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  assert.ok(addr && typeof addr === "object", "server address");
  return { server, api: `http://127.0.0.1:${addr.port}` };
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function runAssertions(api: string, fx: ScopeSmokeFixture): Promise<void> {
  const [supA, supEmpty, hk, mgr] = await Promise.all([
    login(api, fx.supervisorA.email, fx.password),
    login(api, fx.supervisorEmpty.email, fx.password),
    login(api, fx.housekeeper.email, fx.password),
    login(api, fx.manager.email, fx.password),
  ]);

  // Own list/read allowed for supervisor A
  const ownRooms = await getJson(api, supA.token, "/rooms");
  assert.equal(ownRooms.status, 200, "supervisor A rooms list");
  const ownRoomIds = asIdList(ownRooms.body).map((r) => r.id);
  assert.ok(ownRoomIds.includes(fx.locAId), "own room in list");
  assert.ok(!ownRoomIds.includes(fx.locBId), "foreign room excluded from list");

  const ownRoomGet = await getJson(api, supA.token, `/rooms/${fx.locAId}`);
  assert.equal(ownRoomGet.status, 200, "own room GET allowed");

  const ownTasks = await getJson(api, supA.token, "/cleaning/tasks");
  assert.equal(ownTasks.status, 200, "supervisor A tasks list");
  const ownTaskIds = asIdList(ownTasks.body).map((t) => t.id);
  assert.ok(ownTaskIds.includes(fx.taskAId), "own task in list");
  assert.ok(!ownTaskIds.includes(fx.taskBId), "foreign task excluded from list");

  // Foreign read/write denied
  const foreignRoom = await getJson(api, supA.token, `/rooms/${fx.locBId}`);
  assert.equal(foreignRoom.status, 403, "foreign room GET must be 403");

  const foreignReassign = await postJson(
    api,
    supA.token,
    `/cleaning/tasks/${fx.taskBId}/reassign`,
    {
      assignedEmployeeId: fx.housekeeper.employeeId,
      reason: "scope smoke foreign",
    },
  );
  assert.equal(foreignReassign.status, 403, "foreign reassign must be 403");

  // Housekeeper: no foreign assignees in visible tasks
  const hkTasks = await getJson(api, hk.token, "/cleaning/tasks");
  assert.equal(hkTasks.status, 200, "housekeeper tasks list");
  const hkRows = asIdList(hkTasks.body) as Array<{
    id: string;
    assignedEmployeeId: string | null;
  }>;
  assert.ok(
    hkRows.some((t) => t.id === fx.taskAId),
    "housekeeper sees own assigned task",
  );
  assert.ok(
    !hkRows.some((t) => t.id === fx.taskOtherHkId),
    "housekeeper must not see other assignee task",
  );
  const foreignAssignees = hkRows.filter(
    (t) =>
      t.assignedEmployeeId &&
      t.assignedEmployeeId !== fx.housekeeper.employeeId,
  );
  assert.equal(foreignAssignees.length, 0, "hk foreign assignee count must be 0");

  // Empty scope ≠ unrestricted
  const emptyRooms = await getJson(api, supEmpty.token, "/rooms");
  assert.equal(emptyRooms.status, 200, "empty-scope rooms list");
  const emptyRoomIds = asIdList(emptyRooms.body).map((r) => r.id);
  assert.equal(emptyRoomIds.length, 0, "empty-scope supervisor must see 0 rooms");
  const mgrRooms = await getJson(api, mgr.token, "/rooms");
  assert.equal(mgrRooms.status, 200);
  assert.ok(
    asIdList(mgrRooms.body).length > 0,
    "manager (all scope) still sees rooms",
  );
  assert.ok(
    !emptyRoomIds.includes(fx.locAId) && !emptyRoomIds.includes(fx.locBId),
    "empty scope must not expose fixture rooms",
  );

  // Tickets: list filter + point assert on events
  const tickets = await getJson(
    api,
    supA.token,
    "/maintenance/tickets?status=all",
  );
  assert.equal(tickets.status, 200, "supervisor A tickets list");
  const ticketIds = asIdList(tickets.body).map((t) => t.id);
  assert.ok(ticketIds.includes(fx.ticketAId), "own ticket listed");
  assert.ok(!ticketIds.includes(fx.ticketBId), "foreign ticket excluded");

  const foreignTicketEvents = await getJson(
    api,
    supA.token,
    `/maintenance/tickets/${fx.ticketBId}/events`,
  );
  assert.equal(
    foreignTicketEvents.status,
    403,
    "foreign ticket events must be 403",
  );

  // Audit: location-scoped; foreign location denied
  const auditOwn = await getJson(
    api,
    supA.token,
    `/audit?locationId=${encodeURIComponent(fx.locAId)}`,
  );
  assert.equal(auditOwn.status, 200, "own location audit");
  assert.ok(Array.isArray(auditOwn.body), "audit body array");
  const auditOwnIds = (auditOwn.body as Array<{ id: string }>).map((e) => e.id);
  assert.ok(auditOwnIds.includes(fx.auditOwnId), "own audit event present");
  assert.ok(
    !auditOwnIds.includes(fx.auditForeignId),
    "foreign audit event must not appear under own location filter",
  );

  const auditForeign = await getJson(
    api,
    supA.token,
    `/audit?locationId=${encodeURIComponent(fx.locBId)}`,
  );
  assert.equal(auditForeign.status, 403, "foreign location audit must be 403");

  // Live delivery via production export + real resolveDataScope
  const scopeA = await resolveDataScope({
    userId: fx.supervisorA.userId,
    employeeId: fx.supervisorA.employeeId,
    role: Role.supervisor,
    email: fx.supervisorA.email,
    sid: "t04-scope-smoke",
  });
  assert.equal(scopeA.kind, "sectors");
  assert.ok(scopeA.sectorIds.includes(fx.sectorAId));

  assert.equal(
    await canDeliverLiveEvent(scopeA, {
      type: "location.changed",
      at: new Date().toISOString(),
      locationId: fx.locAId,
    }),
    true,
    "live: own location deliverable",
  );
  assert.equal(
    await canDeliverLiveEvent(scopeA, {
      type: "location.changed",
      at: new Date().toISOString(),
      locationId: fx.locBId,
    }),
    false,
    "live: foreign location not deliverable",
  );
  assert.equal(
    await canDeliverLiveEvent(scopeA, {
      type: "cleaning.changed",
      at: new Date().toISOString(),
      taskId: fx.taskBId,
      locationId: fx.locBId,
    }),
    false,
    "live: foreign cleaning not deliverable",
  );
  assert.equal(
    await canDeliverLiveEvent(scopeA, {
      type: "ticket.changed",
      at: new Date().toISOString(),
      ticketId: fx.ticketBId,
      locationId: fx.locBId,
    }),
    false,
    "live: foreign ticket not deliverable",
  );
}

async function main() {
  assert.ok(process.env.JWT_SECRET, "JWT_SECRET required");
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");

  let fx: ScopeSmokeFixture | null = null;
  let server: http.Server | null = null;

  try {
    fx = await createScopeSmokeFixture(prisma);
    assert.ok(fx.locBId && fx.taskBId && fx.ticketBId, "foreign fixtures required");

    const listened = await listenApp();
    server = listened.server;
    await runAssertions(listened.api, fx);
    console.log("smoke-data-scope: ok");
  } finally {
    if (server) {
      await closeServer(server).catch((err) => {
        console.error("server close failed", err);
      });
    }
    if (fx) {
      await cleanupScopeSmokeFixture(prisma, fx).catch((err) => {
        console.error("fixture cleanup failed", err);
      });
    }
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
