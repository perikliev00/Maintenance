import { PrismaClient } from "@prisma/client";

const API = process.env.API_BASE ?? "http://localhost:4000";
const prisma = new PrismaClient();

function sessionFromSetCookie(res: Response): string | null {
  const getSetCookie = (
    res.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie;
  const lines =
    typeof getSetCookie === "function"
      ? getSetCookie.call(res.headers)
      : [res.headers.get("set-cookie")].filter(Boolean) as string[];
  for (const line of lines) {
    const m = /^session=([^;]+)/.exec(line);
    if (m) return decodeURIComponent(m[1]!);
  }
  return null;
}

async function login(email: string) {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  if (!res.ok) throw new Error(`login ${email} ${res.status}`);
  const body = (await res.json()) as { user: { employeeId: string } };
  const token = sessionFromSetCookie(res);
  if (!token) throw new Error(`login ${email}: missing session cookie`);
  return { token, user: body.user };
}

async function getJson(token: string, path: string) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function main() {
  // Ensure sector snapshots exist
  const backfilled = await prisma.$executeRaw`
    UPDATE "CleaningTask" AS t
    SET "sectorId" = sl."sectorId"
    FROM "SectorLocation" AS sl
    WHERE sl."locationId" = t."locationId" AND t."sectorId" IS NULL
  `;
  console.log("backfilled", backfilled);

  const [mgr, sup, hk, tech] = await Promise.all([
    login("manager@meridian.local"),
    login("supervisor@meridian.local"),
    login("housekeeper@meridian.local"),
    login("technician@meridian.local"),
  ]);

  const counts: Record<string, number> = {};
  for (const [label, token] of [
    ["mgr", mgr.token],
    ["sup", sup.token],
    ["hk", hk.token],
    ["tech", tech.token],
  ] as const) {
    const rooms = await getJson(token, "/rooms");
    const tasks = await getJson(token, "/cleaning/tasks");
    const tickets = await getJson(token, "/maintenance/tickets?status=all");
    counts[`${label}_rooms`] = Array.isArray(rooms.body) ? rooms.body.length : -1;
    counts[`${label}_tasks`] = Array.isArray(tasks.body) ? tasks.body.length : -1;
    counts[`${label}_tickets`] = Array.isArray(tickets.body) ? tickets.body.length : -1;
  }
  console.log(counts);

  const mgrRooms = (await getJson(mgr.token, "/rooms")).body as Array<{ id: string; number: string }>;
  const supRooms = (await getJson(sup.token, "/rooms")).body as Array<{ id: string }>;
  const supSet = new Set(supRooms.map((r) => r.id));
  const outRoom = mgrRooms.find((r) => !supSet.has(r.id));
  if (!outRoom) {
    console.log("no out-of-scope room for supervisor");
  } else {
    const got = await getJson(sup.token, `/rooms/${outRoom.id}`);
    console.log("out_of_scope_room_get", outRoom.number, got.status, got.body);
  }

  const mgrTasks = (await getJson(mgr.token, "/cleaning/tasks")).body as Array<{
    id: string;
    status: string;
  }>;
  const supTasks = (await getJson(sup.token, "/cleaning/tasks")).body as Array<{ id: string }>;
  const supTaskSet = new Set(supTasks.map((t) => t.id));
  const outTask = mgrTasks.find((t) => !supTaskSet.has(t.id));
  if (!outTask) {
    console.log("no out-of-scope task for supervisor");
  } else {
    const res = await fetch(`${API}/cleaning/tasks/${outTask.id}/reassign`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sup.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assignedEmployeeId: hk.user.employeeId,
        reason: "scope smoke",
      }),
    });
    const body = await res.json().catch(() => null);
    console.log("out_of_scope_reassign", outTask.id, res.status, body);
  }

  const hkTasks = (await getJson(hk.token, "/cleaning/tasks")).body as Array<{
    assignedEmployeeId: string | null;
  }>;
  const foreign = hkTasks.filter(
    (t) => t.assignedEmployeeId && t.assignedEmployeeId !== hk.user.employeeId,
  );
  console.log("hk_foreign_assignee", foreign.length);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
