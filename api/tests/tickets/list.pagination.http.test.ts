/**
 * Permanent ticket-list keyset pagination suite (HTTP + real PostgreSQL).
 *
 * Consistency model (documented):
 * - Pages are keyset-stable on (openedAt|resolvedAt DESC, id DESC).
 * - Concurrent inserts that sort *before* the current cursor are intentionally
 *   invisible until a first-page refresh (not treated as a bug).
 * - Concurrent status changes may omit a row from later pages when it no longer
 *   matches filters; duplicates across a single drain are still forbidden.
 * - Totals are counted against the filter set at request time (may change between pages).
 */
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import path from "node:path";
import { PrismaClient, Priority, TicketStatus } from "@prisma/client";
import dotenv from "dotenv";
import {
  cleanupTicketsWorld,
  createTicketsWorld,
  CLN_PASSWORD,
  listenApp,
  closeServer,
  loginBearer,
  getJson,
  findActiveIssueOption,
  type TicketsWorld,
} from "./fixtures";
import {
  decodeTicketListCursor,
  encodeTicketListCursor,
} from "../../src/services/maintenance/ticketListCursor";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});

const prisma = new PrismaClient();

type TicketRow = {
  id: string;
  title: string;
  status: string;
  blocksRoom: boolean;
  assignee?: { id: string } | null;
  openedAt?: string;
  resolvedAt?: string | null;
  slaBreached?: boolean;
};
type PageBody = {
  items: TicketRow[];
  nextCursor: string | null;
  total: number;
};

describe("ticket list pagination HTTP", () => {
  let world: TicketsWorld;
  let api: string;
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  let ownerToken: string;
  let managerToken: string;
  let supervisorToken: string;
  let techToken: string;
  let receptionToken: string;
  let hkToken: string;
  let optionId: string;
  let categoryId: string;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    world = await createTicketsWorld(prisma);
    ({ server, api } = await listenApp());
    ownerToken = (await loginBearer(api, world.owner.email, CLN_PASSWORD)).token;
    managerToken = (await loginBearer(api, world.manager.email, CLN_PASSWORD)).token;
    supervisorToken = (
      await loginBearer(api, world.supervisor.email, CLN_PASSWORD)
    ).token;
    techToken = (
      await loginBearer(api, world.technician.email, CLN_PASSWORD)
    ).token;
    receptionToken = (
      await loginBearer(api, world.reception.email, CLN_PASSWORD)
    ).token;
    hkToken = (await loginBearer(api, world.hk1.email, CLN_PASSWORD)).token;
    const option = await findActiveIssueOption(prisma);
    optionId = option.id;
    categoryId = option.maintenanceCategoryId;
  });

  beforeEach(async () => {
    await prisma.ticketEvent.deleteMany({
      where: { ticket: { locationId: { in: [world.locationAId, world.locationBId] } } },
    });
    await prisma.maintenanceTicket.deleteMany({
      where: { locationId: { in: [world.locationAId, world.locationBId] } },
    });
  });

  after(async () => {
    if (server) await closeServer(server);
    if (world) await cleanupTicketsWorld(prisma, world);
    await prisma.$disconnect();
  });

  async function seedTickets(
    count: number,
    opts: {
      blocksRoom?: boolean;
      status?: TicketStatus;
      assigneeId?: string | null;
      locationId?: string;
      openedAt?: Date | ((i: number) => Date);
      resolvedAt?: Date | null | ((i: number) => Date);
      dueAt?: Date | null;
      titlePrefix?: string;
    } = {},
  ) {
    const base = Date.now();
    const locationId = opts.locationId ?? world.locationAId;
    const prefix = opts.titlePrefix ?? "page";
    const rows = Array.from({ length: count }, (_, i) => {
      const openedAt =
        typeof opts.openedAt === "function"
          ? opts.openedAt(i)
          : (opts.openedAt ?? new Date(base - i * 1000));
      const resolvedAt =
        typeof opts.resolvedAt === "function"
          ? opts.resolvedAt(i)
          : opts.resolvedAt === undefined
            ? opts.status === TicketStatus.resolved ||
              opts.status === TicketStatus.closed
              ? new Date(base - i * 500)
              : null
            : opts.resolvedAt;
      return {
        locationId,
        title: `${prefix}-${String(i).padStart(4, "0")}`,
        // Omit issueOptionId so bulk open tickets do not collide with the
        // active-option partial unique index (pagination needs many actives).
        issueOptionId: null as string | null,
        maintenanceCategoryId: categoryId,
        categoryKey: "test",
        categoryLabelBg: "Тест",
        categoryLabelEn: "Test",
        priority: Priority.normal,
        blocksRoom: opts.blocksRoom ?? i % 2 === 0,
        status: opts.status ?? TicketStatus.new,
        openedAt,
        resolvedAt,
        dueAt: opts.dueAt === undefined ? null : opts.dueAt,
        assigneeId: opts.assigneeId === undefined ? null : opts.assigneeId,
        reportedByEmployeeId: world.owner.employeeId,
        commandId: randomUUID(),
        duplicateIdentityKey: `custom:${categoryId}:${prefix}-${i}`,
      };
    });
    // Bulk insert keeps 500/1000 cases within a reasonable runtime.
    for (let offset = 0; offset < rows.length; offset += 200) {
      await prisma.maintenanceTicket.createMany({
        data: rows.slice(offset, offset + 200),
      });
    }
  }

  async function drain(
    token: string,
    query: Record<string, string>,
    limit = 50,
  ): Promise<{ ids: string[]; totals: number[]; pages: PageBody[] }> {
    const ids: string[] = [];
    const totals: number[] = [];
    const pages: PageBody[] = [];
    let cursor: string | null = null;
    let guard = 0;
    do {
      const qs = new URLSearchParams({
        paginated: "1",
        limit: String(limit),
        locationId: world.locationAId,
        ...query,
      });
      if (cursor) qs.set("cursor", cursor);
      const res = await getJson(api, token, `/maintenance/tickets?${qs}`);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const body = res.body as PageBody;
      pages.push(body);
      totals.push(body.total);
      for (const row of body.items) {
        assert.equal(ids.includes(row.id), false, `duplicate ${row.id}`);
        ids.push(row.id);
      }
      cursor = body.nextCursor;
      guard += 1;
      assert.ok(guard < 80, "pagination must terminate");
    } while (cursor);
    return { ids, totals, pages };
  }

  describe("TEST A: exact page boundaries", () => {
    for (const count of [0, 1, 49, 50, 51, 58, 100, 101, 500, 1000]) {
      it(`drains ${count} tickets at page size 50 without dupes/gaps`, async () => {
        await seedTickets(count);
        const { ids, totals, pages } = await drain(ownerToken, { status: "open" }, 50);
        assert.equal(ids.length, count);
        if (count === 0) {
          assert.equal(pages.length, 1);
          assert.equal(pages[0]!.items.length, 0);
          assert.equal(pages[0]!.nextCursor, null);
          assert.equal(pages[0]!.total, 0);
          return;
        }
        assert.ok(totals.every((t) => t === count));
        const expectedPages = Math.ceil(count / 50);
        assert.equal(pages.length, expectedPages);
        assert.equal(pages[0]!.items.length, Math.min(50, count));
        if (count > 50) {
          assert.equal(pages.at(-1)!.items.length, count % 50 === 0 ? 50 : count % 50);
        }
        assert.equal(pages.at(-1)!.nextCursor, null);
      });
    }

    it("58 tickets → 50 then 8 then stop", async () => {
      await seedTickets(58);
      const first = await getJson(
        api,
        ownerToken,
        `/maintenance/tickets?status=open&paginated=1&limit=50&locationId=${world.locationAId}`,
      );
      assert.equal(first.status, 200);
      const page1 = first.body as PageBody;
      assert.equal(page1.items.length, 50);
      assert.equal(page1.total, 58);
      assert.ok(page1.nextCursor);

      const second = await getJson(
        api,
        ownerToken,
        `/maintenance/tickets?status=open&paginated=1&limit=50&locationId=${world.locationAId}&cursor=${encodeURIComponent(page1.nextCursor!)}`,
      );
      assert.equal(second.status, 200);
      const page2 = second.body as PageBody;
      assert.equal(page2.items.length, 8);
      assert.equal(page2.total, 58);
      assert.equal(page2.nextCursor, null);

      const ids = [...page1.items, ...page2.items].map((r) => r.id);
      assert.equal(new Set(ids).size, 58);
    });
  });

  describe("TEST B: cursor correctness", () => {
    it("orders by openedAt desc with id tie-break on identical timestamps", async () => {
      const same = new Date("2026-01-15T12:00:00.000Z");
      await seedTickets(12, {
        openedAt: same,
        titlePrefix: "tie",
      });
      const { ids, pages } = await drain(ownerToken, { status: "open" }, 5);
      assert.equal(ids.length, 12);
      const rows = await prisma.maintenanceTicket.findMany({
        where: { id: { in: ids } },
        select: { id: true, openedAt: true },
      });
      assert.ok(rows.every((r) => r.openedAt.getTime() === same.getTime()));
      // Lexicographic id desc across the drain.
      const expected = [...ids].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
      assert.deepEqual(ids, expected);
      assert.equal(pages.at(-1)!.nextCursor, null);
    });

    it("orders resolved views by resolvedAt desc", async () => {
      const base = Date.now();
      await seedTickets(7, {
        status: TicketStatus.resolved,
        resolvedAt: (i) => new Date(base - i * 10_000),
        titlePrefix: "res",
      });
      const { pages } = await drain(ownerToken, { status: "resolved" }, 3);
      const stamps = pages.flatMap((p) =>
        p.items.map((r) => new Date(r.resolvedAt!).getTime()),
      );
      for (let i = 1; i < stamps.length; i++) {
        assert.ok(stamps[i]! <= stamps[i - 1]!);
      }
      const cursor = decodeTicketListCursor(pages[0]!.nextCursor!);
      assert.equal(cursor.sort, "resolvedAt");
    });

    it("rejects malformed and oversized cursors with 400", async () => {
      await seedTickets(2);
      for (const bad of [
        "not-a-cursor",
        "%%%",
        Buffer.from("[]").toString("base64url"),
        Buffer.from(JSON.stringify(["openedAt", "nope", ""])).toString("base64url"),
        "a".repeat(3000),
      ]) {
        const res = await getJson(
          api,
          ownerToken,
          `/maintenance/tickets?status=open&paginated=1&limit=2&locationId=${world.locationAId}&cursor=${encodeURIComponent(bad)}`,
        );
        assert.equal(res.status, 400, bad.slice(0, 32));
      }
    });

    it("rejects openedAt cursor when listing resolved (sort mismatch)", async () => {
      await seedTickets(5);
      await seedTickets(3, { status: TicketStatus.resolved, titlePrefix: "done" });
      const openPage = (
        await getJson(
          api,
          ownerToken,
          `/maintenance/tickets?status=open&paginated=1&limit=2&locationId=${world.locationAId}`,
        )
      ).body as PageBody;
      assert.ok(openPage.nextCursor);
      const mismatched = await getJson(
        api,
        ownerToken,
        `/maintenance/tickets?status=resolved&paginated=1&limit=2&locationId=${world.locationAId}&cursor=${encodeURIComponent(openPage.nextCursor!)}`,
      );
      assert.equal(mismatched.status, 400);
    });

    it("cursor past the end returns an empty final page with null nextCursor", async () => {
      await seedTickets(3);
      const forged = encodeTicketListCursor({
        sort: "openedAt",
        at: new Date(0),
        id: "zzzz",
      });
      const res = await getJson(
        api,
        ownerToken,
        `/maintenance/tickets?status=open&paginated=1&limit=50&locationId=${world.locationAId}&cursor=${encodeURIComponent(forged)}`,
      );
      assert.equal(res.status, 200);
      const body = res.body as PageBody;
      assert.equal(body.items.length, 0);
      assert.equal(body.nextCursor, null);
      assert.equal(body.total, 3);
    });
  });

  describe("TEST C: filters", () => {
    it("paginates open / all / resolved / assigned / in_progress / waiting", async () => {
      await seedTickets(4, { status: TicketStatus.new, titlePrefix: "new" });
      await seedTickets(4, {
        status: TicketStatus.assigned,
        assigneeId: world.technician.employeeId,
        titlePrefix: "asg",
      });
      await seedTickets(4, {
        status: TicketStatus.in_progress,
        assigneeId: world.technician.employeeId,
        titlePrefix: "ip",
      });
      await seedTickets(4, {
        status: TicketStatus.waiting,
        assigneeId: world.technician.employeeId,
        titlePrefix: "wait",
      });
      await seedTickets(4, { status: TicketStatus.resolved, titlePrefix: "res" });
      await seedTickets(2, { status: TicketStatus.closed, titlePrefix: "cls" });

      const open = await drain(ownerToken, { status: "open" }, 5);
      assert.equal(open.ids.length, 16);
      const all = await drain(ownerToken, { status: "all" }, 5);
      assert.equal(all.ids.length, 22);
      const resolved = await drain(ownerToken, { status: "resolved" }, 5);
      // status=resolved means statuses=[resolved] only (not closed).
      assert.equal(resolved.ids.length, 4);
      const assigned = await drain(ownerToken, { status: "assigned" }, 3);
      assert.equal(assigned.ids.length, 4);
      const inProgress = await drain(ownerToken, { status: "in_progress" }, 3);
      assert.equal(inProgress.ids.length, 4);
      const waiting = await drain(ownerToken, { status: "waiting" }, 3);
      assert.equal(waiting.ids.length, 4);
    });

    it("filters by assigneeId and mine", async () => {
      await seedTickets(6, {
        status: TicketStatus.assigned,
        assigneeId: world.technician.employeeId,
        titlePrefix: "t1",
      });
      await seedTickets(3, {
        status: TicketStatus.assigned,
        assigneeId: world.technician2.employeeId,
        titlePrefix: "t2",
      });
      const byAssignee = await drain(
        ownerToken,
        { status: "open", assigneeId: world.technician.employeeId },
        4,
      );
      assert.equal(byAssignee.ids.length, 6);
      assert.ok(byAssignee.totals.every((t) => t === 6));
      const mine = await drain(techToken, { status: "open", mine: "1" }, 4);
      assert.equal(mine.ids.length, 6);
    });

    it("filters slaBreached and blocksRoom across pages", async () => {
      const past = new Date(Date.now() - 60_000);
      await seedTickets(12, {
        blocksRoom: true,
        dueAt: past,
        titlePrefix: "breach",
      });
      await seedTickets(5, {
        blocksRoom: false,
        dueAt: new Date(Date.now() + 3600_000),
        titlePrefix: "ok",
      });
      const breached = await drain(
        ownerToken,
        { status: "open", slaBreached: "1" },
        5,
      );
      assert.equal(breached.ids.length, 12);
      assert.ok(breached.pages.flatMap((p) => p.items).every((r) => r.slaBreached));
      const blocking = await drain(
        ownerToken,
        { status: "open", blocksRoom: "1" },
        5,
      );
      assert.equal(blocking.ids.length, 12);
    });

    it("includes archived-location history on status=all and hides them from open", async () => {
      const archived = await prisma.location.create({
        data: {
          floorId: world.floorId,
          number: `ARC-${Date.now()}`.slice(0, 24),
          kind: "room",
          catalogStatus: "archived",
          cleaningStatus: "dirty",
          occupancy: "vacant",
          serviceStatus: "in_service",
        },
      });
      try {
        await seedTickets(3, {
          locationId: archived.id,
          titlePrefix: "arch",
        });
        await seedTickets(2, { titlePrefix: "live" });
        const open = await getJson(
          api,
          ownerToken,
          `/maintenance/tickets?status=open&paginated=1&limit=50`,
        );
        const openBody = open.body as PageBody;
        assert.ok(!openBody.items.some((r) => r.title.startsWith("arch-")));
        const all = await getJson(
          api,
          ownerToken,
          `/maintenance/tickets?status=all&paginated=1&limit=50&locationId=${archived.id}`,
        );
        const allBody = all.body as PageBody;
        assert.equal(allBody.total, 3);
        assert.equal(allBody.items.length, 3);
      } finally {
        await prisma.maintenanceTicket.deleteMany({ where: { locationId: archived.id } });
        await prisma.location.delete({ where: { id: archived.id } });
      }
    });
  });

  describe("TEST D: authorization / data scope", () => {
    it("technician assigned_tickets scope never sees another assignee's tickets", async () => {
      await seedTickets(8, {
        status: TicketStatus.assigned,
        assigneeId: world.technician.employeeId,
        titlePrefix: "own",
      });
      await seedTickets(8, {
        status: TicketStatus.assigned,
        assigneeId: world.technician2.employeeId,
        locationId: world.locationBId,
        titlePrefix: "oth",
      });
      const tech = await drain(techToken, { status: "open" }, 5);
      // Technician scope is assignee-based; locationId is still honored when passed.
      const techAll = await getJson(
        api,
        techToken,
        `/maintenance/tickets?status=open&paginated=1&limit=50`,
      );
      assert.equal(techAll.status, 200);
      const body = techAll.body as PageBody;
      assert.ok(body.items.every((r) => r.assignee?.id === world.technician.employeeId));
      assert.equal(body.total, tech.ids.length);
      assert.ok(body.total <= 8);
      assert.ok(!body.items.some((r) => r.title.startsWith("oth-")));
    });

    it("housekeeper does not see technician tickets on an unassigned location", async () => {
      await seedTickets(10, {
        status: TicketStatus.assigned,
        assigneeId: world.technician.employeeId,
        locationId: world.locationBId,
        titlePrefix: "scoped",
      });
      const res = await getJson(
        api,
        hkToken,
        `/maintenance/tickets?status=open&paginated=1&limit=50`,
      );
      assert.equal(res.status, 200);
      const body = res.body as PageBody;
      assert.ok(
        !body.items.some((r) => r.title.startsWith("scoped-")),
        "housekeeper leaked location-B technician tickets",
      );
    });

    it("reception (hotel-wide) and owner/manager paginate the full fixture set", async () => {
      await seedTickets(60, { titlePrefix: "mgmt" });
      for (const [label, token] of [
        ["owner", ownerToken],
        ["manager", managerToken],
        ["reception", receptionToken],
      ] as const) {
        const drained = await drain(token, { status: "open" }, 50);
        assert.equal(drained.ids.length, 60, label);
        assert.ok(drained.totals.every((t) => t === 60), label);
      }
    });

    it("supervisor with no sectors does not leak totals for out-of-scope tickets", async () => {
      await seedTickets(20, { titlePrefix: "sup" });
      const res = await getJson(
        api,
        supervisorToken,
        `/maintenance/tickets?status=open&paginated=1&limit=50&locationId=${world.locationAId}`,
      );
      assert.equal(res.status, 200);
      const body = res.body as PageBody;
      assert.equal(body.total, 0);
      assert.equal(body.items.length, 0);
      assert.equal(body.nextCursor, null);
    });

    it("forged cursor cannot widen technician scope beyond assignee filter", async () => {
      await seedTickets(5, {
        status: TicketStatus.assigned,
        assigneeId: world.technician.employeeId,
        titlePrefix: "vis",
      });
      await seedTickets(5, {
        status: TicketStatus.assigned,
        assigneeId: world.technician2.employeeId,
        titlePrefix: "hid",
      });
      const first = (
        await getJson(
          api,
          techToken,
          `/maintenance/tickets?status=open&paginated=1&limit=2`,
        )
      ).body as PageBody;
      assert.ok(first.nextCursor);
      const next = await getJson(
        api,
        techToken,
        `/maintenance/tickets?status=open&paginated=1&limit=50&cursor=${encodeURIComponent(first.nextCursor!)}`,
      );
      const body = next.body as PageBody;
      assert.ok(body.items.every((r) => r.assignee?.id === world.technician.employeeId));
      assert.ok(!body.items.some((r) => r.title.startsWith("hid-")));
    });
  });

  describe("TEST E: concurrent modifications", () => {
    it("inserts that sort before the cursor stay off page-2 until refresh", async () => {
      const base = Date.now();
      await seedTickets(55, {
        openedAt: (i) => new Date(base - (i + 10) * 1000),
        titlePrefix: "old",
      });
      const first = (
        await getJson(
          api,
          ownerToken,
          `/maintenance/tickets?status=open&paginated=1&limit=50&locationId=${world.locationAId}`,
        )
      ).body as PageBody;
      assert.equal(first.items.length, 50);
      assert.ok(first.nextCursor);

      // Newer than every seeded row → sorts before cursor; keyset page-2 ignores it.
      await seedTickets(1, {
        openedAt: new Date(base + 60_000),
        titlePrefix: "newish",
      });

      const second = (
        await getJson(
          api,
          ownerToken,
          `/maintenance/tickets?status=open&paginated=1&limit=50&locationId=${world.locationAId}&cursor=${encodeURIComponent(first.nextCursor!)}`,
        )
      ).body as PageBody;
      assert.equal(second.items.length, 5);
      assert.ok(!second.items.some((r) => r.title.startsWith("newish-")));
      assert.equal(second.total, 56);

      const refreshed = (
        await getJson(
          api,
          ownerToken,
          `/maintenance/tickets?status=open&paginated=1&limit=50&locationId=${world.locationAId}`,
        )
      ).body as PageBody;
      assert.equal(refreshed.items[0]!.title.startsWith("newish-"), true);
      const drainIds = new Set([
        ...first.items.map((r) => r.id),
        ...second.items.map((r) => r.id),
      ]);
      assert.equal(drainIds.size, 55);
    });

    it("resolving a later-page ticket omits it without duplicating earlier ids", async () => {
      await seedTickets(58, { titlePrefix: "mut" });
      const first = (
        await getJson(
          api,
          ownerToken,
          `/maintenance/tickets?status=open&paginated=1&limit=50&locationId=${world.locationAId}`,
        )
      ).body as PageBody;
      const pending = await prisma.maintenanceTicket.findMany({
        where: {
          locationId: world.locationAId,
          id: { notIn: first.items.map((r) => r.id) },
        },
        select: { id: true },
        take: 1,
      });
      assert.equal(pending.length, 1);
      await prisma.maintenanceTicket.update({
        where: { id: pending[0]!.id },
        data: {
          status: TicketStatus.resolved,
          resolvedAt: new Date(),
        },
      });
      const second = (
        await getJson(
          api,
          ownerToken,
          `/maintenance/tickets?status=open&paginated=1&limit=50&locationId=${world.locationAId}&cursor=${encodeURIComponent(first.nextCursor!)}`,
        )
      ).body as PageBody;
      const ids = [...first.items, ...second.items].map((r) => r.id);
      assert.equal(new Set(ids).size, ids.length);
      assert.ok(!ids.includes(pending[0]!.id));
      assert.equal(ids.length, 57);
    });
  });

  describe("TEST F: API compatibility", () => {
    it("legacy array response remains the default without paginated/cursor", async () => {
      await seedTickets(3);
      const res = await getJson(
        api,
        ownerToken,
        `/maintenance/tickets?status=open&limit=2&locationId=${world.locationAId}`,
      );
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
      assert.equal((res.body as TicketRow[]).length, 2);
    });

    it("paginated=1 returns envelope even without cursor", async () => {
      await seedTickets(2);
      const res = await getJson(
        api,
        ownerToken,
        `/maintenance/tickets?status=open&paginated=1&limit=50&locationId=${world.locationAId}`,
      );
      assert.equal(res.status, 200);
      const body = res.body as PageBody;
      assert.ok(Array.isArray(body.items));
      assert.equal(body.total, 2);
      assert.equal(body.nextCursor, null);
    });

    it("caps limit at 100", async () => {
      await seedTickets(120);
      const res = await getJson(
        api,
        ownerToken,
        `/maintenance/tickets?status=open&paginated=1&limit=500&locationId=${world.locationAId}`,
      );
      assert.equal(res.status, 200);
      const body = res.body as PageBody;
      assert.equal(body.items.length, 100);
      assert.ok(body.nextCursor);
      assert.equal(body.total, 120);
    });
  });
});
