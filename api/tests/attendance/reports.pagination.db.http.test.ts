/**
 * b — list cursor drain + CSV export for 1205 same-day intervals.
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  AttendanceIntervalStatus,
  PrismaClient,
  Role,
} from "@prisma/client";
import { assertTestDatabase } from "../assertTestDatabase";
import {
  closeServer,
  getJson,
  listenApp,
  loginBearer,
} from "../httpHarness";
import {
  ATT_PASSWORD,
  cleanupAttendanceWorld,
  createAttendanceWorld,
  ensureActionGrant,
  type AttendanceWorld,
} from "./fixtures";

const prisma = new PrismaClient();
const N = 1205;
const HOTEL_DATE = new Date("2026-10-15T00:00:00.000Z");
const STARTED_AT = new Date("2026-10-15T08:00:00.000Z");

describe("attendance reports pagination HTTP/DB", () => {
  let world: AttendanceWorld;
  let api: string;
  let server: import("node:http").Server;
  let seedIds: string[] = [];
  let seedEndedAtIso: string[] = [];
  let negSepIds: string[] = [];
  let negCtrlIds: string[] = [];

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    await assertTestDatabase(prisma);
    world = await createAttendanceWorld(prisma);
    await ensureActionGrant(prisma, Role.manager, "attendance.view");
    ({ server, api } = await listenApp());

    const emp = world.technician.employeeId;
    const rows: Array<{
      employeeId: string;
      hotelDate: Date;
      startedAt: Date;
      endedAt: Date;
      breakMinutes: number;
      workedMinutes: number;
      status: typeof AttendanceIntervalStatus.closed;
      anomalyFlags: string[];
    }> = [];
    for (let i = 0; i < N; i += 1) {
      const endedAt = new Date(STARTED_AT.getTime() + (i + 1) * 60_000);
      seedEndedAtIso.push(endedAt.toISOString());
      rows.push({
        employeeId: emp,
        hotelDate: HOTEL_DATE,
        startedAt: STARTED_AT,
        endedAt,
        breakMinutes: 0,
        workedMinutes: i + 1,
        status: AttendanceIntervalStatus.closed,
        anomalyFlags: [],
      });
    }
    // createMany does not return ids on Postgres without skipDuplicates tricks —
    // insert in chunks then reload.
    const chunk = 200;
    for (let i = 0; i < rows.length; i += chunk) {
      await prisma.attendanceInterval.createMany({
        data: rows.slice(i, i + chunk),
      });
    }
    const seeded = await prisma.attendanceInterval.findMany({
      where: {
        employeeId: emp,
        hotelDate: HOTEL_DATE,
        startedAt: STARTED_AT,
      },
      select: { id: true, endedAt: true },
      orderBy: { endedAt: "asc" },
    });
    assert.equal(seeded.length, N);
    seedIds = seeded.map((r) => r.id);
    seedEndedAtIso = seeded.map((r) => r.endedAt!.toISOString());

    for (let i = 0; i < 10; i += 1) {
      const sep = await prisma.attendanceInterval.create({
        data: {
          employeeId: emp,
          hotelDate: new Date("2026-09-01T00:00:00.000Z"),
          startedAt: new Date("2026-09-01T08:00:00.000Z"),
          endedAt: new Date(`2026-09-01T09:${String(i).padStart(2, "0")}:00.000Z`),
          breakMinutes: 0,
          workedMinutes: 60,
          status: AttendanceIntervalStatus.closed,
          anomalyFlags: [],
        },
      });
      negSepIds.push(sep.id);
      const ctrl = await prisma.attendanceInterval.create({
        data: {
          employeeId: world.control.employeeId,
          hotelDate: HOTEL_DATE,
          startedAt: STARTED_AT,
          endedAt: new Date(STARTED_AT.getTime() + (2000 + i) * 60_000),
          breakMinutes: 0,
          workedMinutes: 60,
          status: AttendanceIntervalStatus.closed,
          anomalyFlags: [],
        },
      });
      negCtrlIds.push(ctrl.id);
    }
  });

  after(async () => {
    await closeServer(server);
    if (seedIds.length || negSepIds.length || negCtrlIds.length) {
      await prisma.attendanceInterval.deleteMany({
        where: {
          id: { in: [...seedIds, ...negSepIds, ...negCtrlIds] },
        },
      });
    }
    if (world) await cleanupAttendanceWorld(prisma, world);
    await prisma.$disconnect();
  });

  it("list drain limit=200 → 1205 ids; nextCursor null; no negatives", async () => {
    const mgr = await loginBearer(api, world.manager.email, ATT_PASSWORD);
    const emp = world.technician.employeeId;
    const collected: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    let totalSeen: number | null = null;

    for (;;) {
      const qs = new URLSearchParams({
        employeeId: emp,
        month: "2026-10",
        limit: "200",
      });
      if (cursor) qs.set("cursor", cursor);
      const res = await getJson(
        api,
        mgr.token,
        `/attendance/intervals?${qs.toString()}`,
      );
      assert.equal(res.status, 200);
      const body = res.body as {
        intervals: Array<{ id: string }>;
        total: number;
        nextCursor: string | null;
        limit: number;
      };
      assert.equal(body.limit, 200);
      assert.equal(body.total, N);
      totalSeen = body.total;
      for (const iv of body.intervals) collected.push(iv.id);
      pages += 1;
      cursor = body.nextCursor;
      if (cursor == null) break;
      assert.ok(pages < 20, "pagination must terminate");
    }

    assert.ok(pages >= 7, `expected >=7 pages, got ${pages}`);
    assert.equal(totalSeen, N);
    assert.equal(collected.length, N);
    assert.equal(new Set(collected).size, N);
    assert.deepEqual(
      [...collected].sort(),
      [...seedIds].sort(),
    );
    for (const id of negSepIds) {
      assert.ok(!collected.includes(id));
    }
    for (const id of negCtrlIds) {
      assert.ok(!collected.includes(id));
    }
  });

  it("CSV export 1205 rows; unique (startedAt,endedAt); no negatives", async () => {
    const mgr = await loginBearer(api, world.manager.email, ATT_PASSWORD);
    const emp = world.technician.employeeId;
    const qs = new URLSearchParams({
      employeeId: emp,
      month: "2026-10",
    });
    const res = await fetch(
      `${api}/attendance/export.csv?${qs.toString()}`,
      { headers: { Authorization: `Bearer ${mgr.token}` } },
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("X-Attendance-Total"), String(N));
    assert.equal(res.headers.get("X-Attendance-Truncated"), null);
    const text = await res.text();
    const lines = text.split(/\n/).filter((l) => l.length > 0);
    assert.ok(lines.length >= N + 1);
    const header = lines[0]!;
    assert.ok(header.includes("startedAt"));
    assert.ok(header.includes("endedAt"));
    const data = lines.slice(1);
    assert.equal(data.length, N);

    const pairs = new Set<string>();
    for (const line of data) {
      const cols = line.split(",");
      // hotelDate,employeeNumber,fullName,department,startedAt,endedAt,...
      const startedAt = cols[4]!;
      const endedAt = cols[5]!;
      pairs.add(`${startedAt}|${endedAt}`);
      assert.equal(startedAt, STARTED_AT.toISOString());
      assert.ok(!endedAt.startsWith("2026-09-"));
    }
    assert.equal(pairs.size, N);
    for (const ended of seedEndedAtIso) {
      assert.ok(
        pairs.has(`${STARTED_AT.toISOString()}|${ended}`),
        `missing pair endedAt=${ended}`,
      );
    }
  });
});