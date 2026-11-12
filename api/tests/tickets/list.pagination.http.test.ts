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
// Import bindings from crypto.
import { randomUUID } from "crypto";
// Node test runner and strict assertions for API suite checks.
import { after, before, beforeEach, describe, it } from "node:test";
// Import bindings from node:path.
import path from "node:path";
// Prisma client types/runtime for DB setup and assertions.
import { PrismaClient, Priority, TicketStatus } from "@prisma/client";
// Import bindings from dotenv.
import dotenv from "dotenv";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  cleanupTicketsWorld,
  // Execute the next setup or assertion step for this scenario.
  createTicketsWorld,
  // Execute the next setup or assertion step for this scenario.
  CLN_PASSWORD,
  // Execute the next setup or assertion step for this scenario.
  listenApp,
  // Start or stop the in-process API server for this suite.
  closeServer,
  // Session/CSRF step exercising auth lifecycle.
  loginBearer,
  // Execute the next setup or assertion step for this scenario.
  getJson,
  // Execute the next setup or assertion step for this scenario.
  findActiveIssueOption,
  // Shape TicketsWorld documents the fixture/response fields this suite touches.
  type TicketsWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "./fixtures";
// Import module bindings used by this suite.
import {
  // Pagination step for list/contract coverage.
  decodeTicketListCursor,
  // Pagination step for list/contract coverage.
  encodeTicketListCursor,
// Pagination step for list/contract coverage.
} from "../../src/services/maintenance/ticketListCursor";

// Execute the next setup or assertion step for this scenario.
dotenv.config({
  // Execute the next setup or assertion step for this scenario.
  path: path.resolve(__dirname, "../../.env"),
  // Execute the next setup or assertion step for this scenario.
  override: true,
});

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Shape TicketRow documents the fixture/response fields this suite touches.
type TicketRow = {
  // Execute the next setup or assertion step for this scenario.
  id: string;
  // Execute the next setup or assertion step for this scenario.
  title: string;
  // Fixture field status for the seeded actor/entity.
  status: string;
  // Concurrency/isolation step for the race under test.
  blocksRoom: boolean;
  // Execute the next setup or assertion step for this scenario.
  assignee?: { id: string } | null;
  // Execute the next setup or assertion step for this scenario.
  openedAt?: string;
  // Execute the next setup or assertion step for this scenario.
  resolvedAt?: string | null;
  // Execute the next setup or assertion step for this scenario.
  slaBreached?: boolean;
};
// Shape PageBody documents the fixture/response fields this suite touches.
type PageBody = {
  // Execute the next setup or assertion step for this scenario.
  items: TicketRow[];
  // Pagination step for list/contract coverage.
  nextCursor: string | null;
  // Execute the next setup or assertion step for this scenario.
  total: number;
};

// Suite: ticket list pagination HTTP.
describe("ticket list pagination HTTP", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: TicketsWorld;
  // Execute the next setup or assertion step for this scenario.
  let api: string;
  // Execute the next setup or assertion step for this scenario.
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  // Execute the next setup or assertion step for this scenario.
  let ownerToken: string;
  // Execute the next setup or assertion step for this scenario.
  let managerToken: string;
  // Execute the next setup or assertion step for this scenario.
  let supervisorToken: string;
  // Execute the next setup or assertion step for this scenario.
  let techToken: string;
  // Execute the next setup or assertion step for this scenario.
  let receptionToken: string;
  // Execute the next setup or assertion step for this scenario.
  let hkToken: string;
  // Execute the next setup or assertion step for this scenario.
  let optionId: string;
  // Execute the next setup or assertion step for this scenario.
  let categoryId: string;

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Assert the observed value matches the intended post-condition.
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createTicketsWorld(prisma);
    // Start or stop the in-process API server for this suite.
    ({ server, api } = await listenApp());
    // Await async work before asserting or releasing locks.
    ownerToken = (await loginBearer(api, world.owner.email, CLN_PASSWORD)).token;
    // Await async work before asserting or releasing locks.
    managerToken = (await loginBearer(api, world.manager.email, CLN_PASSWORD)).token;
    // Execute the next setup or assertion step for this scenario.
    supervisorToken = (
      // Await async work before asserting or releasing locks.
      await loginBearer(api, world.supervisor.email, CLN_PASSWORD)
    // Execute the next setup or assertion step for this scenario.
    ).token;
    // Execute the next setup or assertion step for this scenario.
    techToken = (
      // Await async work before asserting or releasing locks.
      await loginBearer(api, world.technician.email, CLN_PASSWORD)
    // Execute the next setup or assertion step for this scenario.
    ).token;
    // Execute the next setup or assertion step for this scenario.
    receptionToken = (
      // Await async work before asserting or releasing locks.
      await loginBearer(api, world.reception.email, CLN_PASSWORD)
    // Execute the next setup or assertion step for this scenario.
    ).token;
    // Await async work before asserting or releasing locks.
    hkToken = (await loginBearer(api, world.hk1.email, CLN_PASSWORD)).token;
    // option: synchronize actors so the race window is observable.
    const option = await findActiveIssueOption(prisma);
    // Execute the next setup or assertion step for this scenario.
    optionId = option.id;
    // Execute the next setup or assertion step for this scenario.
    categoryId = option.maintenanceCategoryId;
  });

  // Arrange shared preconditions before cases run.
  beforeEach(async () => {
    // Await async work before asserting or releasing locks.
    await prisma.ticketEvent.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { ticket: { locationId: { in: [world.locationAId, world.locationBId] } } },
    });
    // Await async work before asserting or releasing locks.
    await prisma.maintenanceTicket.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { locationId: { in: [world.locationAId, world.locationBId] } },
    });
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Guard optional cleanup or alternate assertion paths.
    if (server) await closeServer(server);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) await cleanupTicketsWorld(prisma, world);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Helper seedTickets: arrange fixture data for the case.
  async function seedTickets(
    // Execute the next setup or assertion step for this scenario.
    count: number,
    // Execute the next setup or assertion step for this scenario.
    opts: {
      // Concurrency/isolation step for the race under test.
      blocksRoom?: boolean;
      // Execute the next setup or assertion step for this scenario.
      status?: TicketStatus;
      // Execute the next setup or assertion step for this scenario.
      assigneeId?: string | null;
      // Execute the next setup or assertion step for this scenario.
      locationId?: string;
      // Execute the next setup or assertion step for this scenario.
      openedAt?: Date | ((i: number) => Date);
      // Execute the next setup or assertion step for this scenario.
      resolvedAt?: Date | null | ((i: number) => Date);
      // Execute the next setup or assertion step for this scenario.
      dueAt?: Date | null;
      // Execute the next setup or assertion step for this scenario.
      titlePrefix?: string;
    // Execute the next setup or assertion step for this scenario.
    } = {},
  // Execute the next setup or assertion step for this scenario.
  ) {
    // Bind base for later setup or assertions in this scope.
    const base = Date.now();
    // locationId: unique stamp so parallel runs do not collide.
    const locationId = opts.locationId ?? world.locationAId;
    // Bind prefix for later setup or assertions in this scope.
    const prefix = opts.titlePrefix ?? "page";
    // Bind rows for later setup or assertions in this scope.
    const rows = Array.from({ length: count }, (_, i) => {
      // Bind openedAt for later setup or assertions in this scope.
      const openedAt =
        // Execute the next setup or assertion step for this scenario.
        typeof opts.openedAt === "function"
          ? opts.openedAt(i)
          : (opts.openedAt ?? new Date(base - i * 1000));
      // Bind resolvedAt for later setup or assertions in this scope.
      const resolvedAt =
        // Execute the next setup or assertion step for this scenario.
        typeof opts.resolvedAt === "function"
          ? opts.resolvedAt(i)
          : opts.resolvedAt === undefined
            ? opts.status === TicketStatus.resolved ||
              // Execute the next setup or assertion step for this scenario.
              opts.status === TicketStatus.closed
              ? new Date(base - i * 500)
              : null
            : opts.resolvedAt;
      // Return the arranged value/result to the caller.
      return {
        // Execute the next setup or assertion step for this scenario.
        locationId,
        // Execute the next setup or assertion step for this scenario.
        title: `${prefix}-${String(i).padStart(4, "0")}`,
        // Omit issueOptionId so bulk open tickets do not collide with the
        // active-option partial unique index (pagination needs many actives).
        issueOptionId: null as string | null,
        // Execute the next setup or assertion step for this scenario.
        maintenanceCategoryId: categoryId,
        // Execute the next setup or assertion step for this scenario.
        categoryKey: "test",
        // Execute the next setup or assertion step for this scenario.
        categoryLabelBg: "Тест",
        // Execute the next setup or assertion step for this scenario.
        categoryLabelEn: "Test",
        // Execute the next setup or assertion step for this scenario.
        priority: Priority.normal,
        // Concurrency/isolation step for the race under test.
        blocksRoom: opts.blocksRoom ?? i % 2 === 0,
        // Fixture field status for the seeded actor/entity.
        status: opts.status ?? TicketStatus.new,
        // Execute the next setup or assertion step for this scenario.
        openedAt,
        // Execute the next setup or assertion step for this scenario.
        resolvedAt,
        // Execute the next setup or assertion step for this scenario.
        dueAt: opts.dueAt === undefined ? null : opts.dueAt,
        // Execute the next setup or assertion step for this scenario.
        assigneeId: opts.assigneeId === undefined ? null : opts.assigneeId,
        // Execute the next setup or assertion step for this scenario.
        reportedByEmployeeId: world.owner.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId: randomUUID(),
        // Execute the next setup or assertion step for this scenario.
        duplicateIdentityKey: `custom:${categoryId}:${prefix}-${i}`,
      };
    });
    // Bulk insert keeps 500/1000 cases within a reasonable runtime.
    for (let offset = 0; offset < rows.length; offset += 200) {
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await prisma.maintenanceTicket.createMany({
        // Pagination step for list/contract coverage.
        data: rows.slice(offset, offset + 200),
      });
    }
  }

  // Local helper drain used by cases in this file.
  async function drain(
    // Execute the next setup or assertion step for this scenario.
    token: string,
    // Execute the next setup or assertion step for this scenario.
    query: Record<string, string>,
    // Pagination step for list/contract coverage.
    limit = 50,
  // Execute the next setup or assertion step for this scenario.
  ): Promise<{ ids: string[]; totals: number[]; pages: PageBody[] }> {
    // Execute the next setup or assertion step for this scenario.
    const ids: string[] = [];
    // Execute the next setup or assertion step for this scenario.
    const totals: number[] = [];
    // Execute the next setup or assertion step for this scenario.
    const pages: PageBody[] = [];
    // Pagination step for list/contract coverage.
    let cursor: string | null = null;
    // Bind guard for later setup or assertions in this scope.
    let guard = 0;
    // Execute the next setup or assertion step for this scenario.
    do {
      // Bind qs for later setup or assertions in this scope.
      const qs = new URLSearchParams({
        // Pagination step for list/contract coverage.
        paginated: "1",
        // Pagination step for list/contract coverage.
        limit: String(limit),
        // Execute the next setup or assertion step for this scenario.
        locationId: world.locationAId,
        // Continue the call chain for setup or assertion detail.
        ...query,
      });
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (cursor) qs.set("cursor", cursor);
      // res: HTTP response captured for status/body checks.
      const res = await getJson(api, token, `/maintenance/tickets?${qs}`);
      // Assert HTTP status matches the contract for this path.
      assert.equal(res.status, 200, JSON.stringify(res.body));
      // Bind body for later setup or assertions in this scope.
      const body = res.body as PageBody;
      // Execute the next setup or assertion step for this scenario.
      pages.push(body);
      // Execute the next setup or assertion step for this scenario.
      totals.push(body.total);
      // Iterate to cover variants or wait until a condition holds.
      for (const row of body.items) {
        // Assert the observed value matches the intended post-condition.
        assert.equal(ids.includes(row.id), false, `duplicate ${row.id}`);
        // Execute the next setup or assertion step for this scenario.
        ids.push(row.id);
      }
      // Pagination step for list/contract coverage.
      cursor = body.nextCursor;
      // Execute the next setup or assertion step for this scenario.
      guard += 1;
      // Assert the observed value matches the intended post-condition.
      assert.ok(guard < 80, "pagination must terminate");
    // Pagination step for list/contract coverage.
    } while (cursor);
    // Return the arranged value/result to the caller.
    return { ids, totals, pages };
  }

  // Suite: TEST A: exact page boundaries.
  describe("TEST A: exact page boundaries", () => {
    // Iterate to cover variants or wait until a condition holds.
    for (const count of [0, 1, 49, 50, 51, 58, 100, 101, 500, 1000]) {
      // Case: drains ${count} tickets at page size 50 without dupes/gaps.
      it(`drains ${count} tickets at page size 50 without dupes/gaps`, async () => {
        // Seed prerequisite rows so the mutation under test has a realistic baseline.
        await seedTickets(count);
        // Await async work before asserting or releasing locks.
        const { ids, totals, pages } = await drain(ownerToken, { status: "open" }, 50);
        // Assert collection size matches the expected post-condition.
        assert.equal(ids.length, count);
        // Conditional path for setup, cleanup, or alternate outcomes.
        if (count === 0) {
          // Assert collection size matches the expected post-condition.
          assert.equal(pages.length, 1);
          // Assert collection size matches the expected post-condition.
          assert.equal(pages[0]!.items.length, 0);
          // Assert the observed value matches the intended post-condition.
          assert.equal(pages[0]!.nextCursor, null);
          // Assert the observed value matches the intended post-condition.
          assert.equal(pages[0]!.total, 0);
          // Execute the next setup or assertion step for this scenario.
          return;
        }
        // Assert collection size matches the expected post-condition.
        assert.ok(totals.every((t) => t === count));
        // Bind expectedPages for later setup or assertions in this scope.
        const expectedPages = Math.ceil(count / 50);
        // Assert we are on the isolated test DB, not a seed/prod database.
        assert.equal(pages.length, expectedPages);
        // Assert collection size matches the expected post-condition.
        assert.equal(pages[0]!.items.length, Math.min(50, count));
        // Conditional path for setup, cleanup, or alternate outcomes.
        if (count > 50) {
          // Assert collection size matches the expected post-condition.
          assert.equal(pages.at(-1)!.items.length, count % 50 === 0 ? 50 : count % 50);
        }
        // Assert the observed value matches the intended post-condition.
        assert.equal(pages.at(-1)!.nextCursor, null);
      });
    }

    // Case: 58 tickets → 50 then 8 then stop.
    it("58 tickets → 50 then 8 then stop", async () => {
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await seedTickets(58);
      // first: HTTP response captured for status/body checks.
      const first = await getJson(
        // Execute the next setup or assertion step for this scenario.
        api,
        // Execute the next setup or assertion step for this scenario.
        ownerToken,
        // Pagination step for list/contract coverage.
        `/maintenance/tickets?status=open&paginated=1&limit=50&locationId=${world.locationAId}`,
      );
      // Assert HTTP status matches the contract for this path.
      assert.equal(first.status, 200);
      // Bind page1 for later setup or assertions in this scope.
      const page1 = first.body as PageBody;
      // Assert collection size matches the expected post-condition.
      assert.equal(page1.items.length, 50);
      // Assert the observed value matches the intended post-condition.
      assert.equal(page1.total, 58);
      // Assert the observed value matches the intended post-condition.
      assert.ok(page1.nextCursor);

      // second: HTTP response captured for status/body checks.
      const second = await getJson(
        // Execute the next setup or assertion step for this scenario.
        api,
        // Execute the next setup or assertion step for this scenario.
        ownerToken,
        // Pagination step for list/contract coverage.
        `/maintenance/tickets?status=open&paginated=1&limit=50&locationId=${world.locationAId}&cursor=${encodeURIComponent(page1.nextCursor!)}`,
      );
      // Assert HTTP status matches the contract for this path.
      assert.equal(second.status, 200);
      // Bind page2 for later setup or assertions in this scope.
      const page2 = second.body as PageBody;
      // Assert collection size matches the expected post-condition.
      assert.equal(page2.items.length, 8);
      // Assert the observed value matches the intended post-condition.
      assert.equal(page2.total, 58);
      // Assert the observed value matches the intended post-condition.
      assert.equal(page2.nextCursor, null);

      // Bind ids for later setup or assertions in this scope.
      const ids = [...page1.items, ...page2.items].map((r) => r.id);
      // Assert the observed value matches the intended post-condition.
      assert.equal(new Set(ids).size, 58);
    });
  });

  // Suite: TEST B: cursor correctness.
  describe("TEST B: cursor correctness", () => {
    // Case: orders by openedAt desc with id tie-break on identical timestamps.
    it("orders by openedAt desc with id tie-break on identical timestamps", async () => {
      // Bind same for later setup or assertions in this scope.
      const same = new Date("2026-01-15T12:00:00.000Z");
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await seedTickets(12, {
        // Execute the next setup or assertion step for this scenario.
        openedAt: same,
        // Execute the next setup or assertion step for this scenario.
        titlePrefix: "tie",
      });
      // Await async work before asserting or releasing locks.
      const { ids, pages } = await drain(ownerToken, { status: "open" }, 5);
      // Assert collection size matches the expected post-condition.
      assert.equal(ids.length, 12);
      // rows: synchronize actors so the race window is observable.
      const rows = await prisma.maintenanceTicket.findMany({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: { in: ids } },
        // SQL fragment used to observe locks or assert DB state.
        select: { id: true, openedAt: true },
      });
      // Assert replay/idempotent path did not create duplicates.
      assert.ok(rows.every((r) => r.openedAt.getTime() === same.getTime()));
      // Lexicographic id desc across the drain.
      const expected = [...ids].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.deepEqual(ids, expected);
      // Assert the observed value matches the intended post-condition.
      assert.equal(pages.at(-1)!.nextCursor, null);
    });

    // Case: orders resolved views by resolvedAt desc.
    it("orders resolved views by resolvedAt desc", async () => {
      // Bind base for later setup or assertions in this scope.
      const base = Date.now();
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await seedTickets(7, {
        // Fixture field status for the seeded actor/entity.
        status: TicketStatus.resolved,
        // Execute the next setup or assertion step for this scenario.
        resolvedAt: (i) => new Date(base - i * 10_000),
        // Execute the next setup or assertion step for this scenario.
        titlePrefix: "res",
      });
      // Await async work before asserting or releasing locks.
      const { pages } = await drain(ownerToken, { status: "resolved" }, 3);
      // stamps: unique stamp so parallel runs do not collide.
      const stamps = pages.flatMap((p) =>
        // Execute the next setup or assertion step for this scenario.
        p.items.map((r) => new Date(r.resolvedAt!).getTime()),
      );
      // Repeat/poll to widen the race window or wait for lock waiters.
      for (let i = 1; i < stamps.length; i++) {
        // Assert the observed value matches the intended post-condition.
        assert.ok(stamps[i]! <= stamps[i - 1]!);
      }
      // Bind cursor for later setup or assertions in this scope.
      const cursor = decodeTicketListCursor(pages[0]!.nextCursor!);
      // Assert the observed value matches the intended post-condition.
      assert.equal(cursor.sort, "resolvedAt");
    });

    // Case: rejects malformed and oversized cursors with 400.
    it("rejects malformed and oversized cursors with 400", async () => {
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await seedTickets(2);
      // Iterate to cover variants or wait until a condition holds.
      for (const bad of [
        // Pagination step for list/contract coverage.
        "not-a-cursor",
        // Execute the next setup or assertion step for this scenario.
        "%%%",
        // Execute the next setup or assertion step for this scenario.
        Buffer.from("[]").toString("base64url"),
        // Execute the next setup or assertion step for this scenario.
        Buffer.from(JSON.stringify(["openedAt", "nope", ""])).toString("base64url"),
        // Execute the next setup or assertion step for this scenario.
        "a".repeat(3000),
      // Execute the next setup or assertion step for this scenario.
      ]) {
        // res: HTTP response captured for status/body checks.
        const res = await getJson(
          // Execute the next setup or assertion step for this scenario.
          api,
          // Execute the next setup or assertion step for this scenario.
          ownerToken,
          // Pagination step for list/contract coverage.
          `/maintenance/tickets?status=open&paginated=1&limit=2&locationId=${world.locationAId}&cursor=${encodeURIComponent(bad)}`,
        );
        // Assert HTTP status matches the contract for this path.
        assert.equal(res.status, 400, bad.slice(0, 32));
      }
    });

    // Case: rejects openedAt cursor when listing resolved (sort mismatch).
    it("rejects openedAt cursor when listing resolved (sort mismatch)", async () => {
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await seedTickets(5);
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await seedTickets(3, { status: TicketStatus.resolved, titlePrefix: "done" });
      // Bind openPage for later setup or assertions in this scope.
      const openPage = (
        // Await async work before asserting or releasing locks.
        await getJson(
          // Execute the next setup or assertion step for this scenario.
          api,
          // Execute the next setup or assertion step for this scenario.
          ownerToken,
          // Pagination step for list/contract coverage.
          `/maintenance/tickets?status=open&paginated=1&limit=2&locationId=${world.locationAId}`,
        )
      // Execute the next setup or assertion step for this scenario.
      ).body as PageBody;
      // Assert the observed value matches the intended post-condition.
      assert.ok(openPage.nextCursor);
      // mismatched: HTTP response captured for status/body checks.
      const mismatched = await getJson(
        // Execute the next setup or assertion step for this scenario.
        api,
        // Execute the next setup or assertion step for this scenario.
        ownerToken,
        // Pagination step for list/contract coverage.
        `/maintenance/tickets?status=resolved&paginated=1&limit=2&locationId=${world.locationAId}&cursor=${encodeURIComponent(openPage.nextCursor!)}`,
      );
      // Assert HTTP status matches the contract for this path.
      assert.equal(mismatched.status, 400);
    });

    // Case: cursor past the end returns an empty final page with null nextCursor.
    it("cursor past the end returns an empty final page with null nextCursor", async () => {
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await seedTickets(3);
      // Bind forged for later setup or assertions in this scope.
      const forged = encodeTicketListCursor({
        // Execute the next setup or assertion step for this scenario.
        sort: "openedAt",
        // Execute the next setup or assertion step for this scenario.
        at: new Date(0),
        // Execute the next setup or assertion step for this scenario.
        id: "zzzz",
      });
      // res: HTTP response captured for status/body checks.
      const res = await getJson(
        // Execute the next setup or assertion step for this scenario.
        api,
        // Execute the next setup or assertion step for this scenario.
        ownerToken,
        // Pagination step for list/contract coverage.
        `/maintenance/tickets?status=open&paginated=1&limit=50&locationId=${world.locationAId}&cursor=${encodeURIComponent(forged)}`,
      );
      // Assert HTTP status matches the contract for this path.
      assert.equal(res.status, 200);
      // Bind body for later setup or assertions in this scope.
      const body = res.body as PageBody;
      // Assert collection size matches the expected post-condition.
      assert.equal(body.items.length, 0);
      // Assert the observed value matches the intended post-condition.
      assert.equal(body.nextCursor, null);
      // Assert the observed value matches the intended post-condition.
      assert.equal(body.total, 3);
    });
  });

  // Suite: TEST C: filters.
  describe("TEST C: filters", () => {
    // Case: paginates open / all / resolved / assigned / in_progress / waiting.
    it("paginates open / all / resolved / assigned / in_progress / waiting", async () => {
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await seedTickets(4, { status: TicketStatus.new, titlePrefix: "new" });
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await seedTickets(4, {
        // Fixture field status for the seeded actor/entity.
        status: TicketStatus.assigned,
        // Execute the next setup or assertion step for this scenario.
        assigneeId: world.technician.employeeId,
        // Execute the next setup or assertion step for this scenario.
        titlePrefix: "asg",
      });
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await seedTickets(4, {
        // Fixture field status for the seeded actor/entity.
        status: TicketStatus.in_progress,
        // Execute the next setup or assertion step for this scenario.
        assigneeId: world.technician.employeeId,
        // Execute the next setup or assertion step for this scenario.
        titlePrefix: "ip",
      });
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await seedTickets(4, {
        // Fixture field status for the seeded actor/entity.
        status: TicketStatus.waiting,
        // Execute the next setup or assertion step for this scenario.
        assigneeId: world.technician.employeeId,
        // Execute the next setup or assertion step for this scenario.
        titlePrefix: "wait",
      });
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await seedTickets(4, { status: TicketStatus.resolved, titlePrefix: "res" });
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await seedTickets(2, { status: TicketStatus.closed, titlePrefix: "cls" });

      // open: synchronize actors so the race window is observable.
      const open = await drain(ownerToken, { status: "open" }, 5);
      // Assert collection size matches the expected post-condition.
      assert.equal(open.ids.length, 16);
      // all: synchronize actors so the race window is observable.
      const all = await drain(ownerToken, { status: "all" }, 5);
      // Assert collection size matches the expected post-condition.
      assert.equal(all.ids.length, 22);
      // resolved: synchronize actors so the race window is observable.
      const resolved = await drain(ownerToken, { status: "resolved" }, 5);
      // status=resolved means statuses=[resolved] only (not closed).
      assert.equal(resolved.ids.length, 4);
      // assigned: synchronize actors so the race window is observable.
      const assigned = await drain(ownerToken, { status: "assigned" }, 3);
      // Assert collection size matches the expected post-condition.
      assert.equal(assigned.ids.length, 4);
      // inProgress: synchronize actors so the race window is observable.
      const inProgress = await drain(ownerToken, { status: "in_progress" }, 3);
      // Assert collection size matches the expected post-condition.
      assert.equal(inProgress.ids.length, 4);
      // waiting: synchronize actors so the race window is observable.
      const waiting = await drain(ownerToken, { status: "waiting" }, 3);
      // Assert collection size matches the expected post-condition.
      assert.equal(waiting.ids.length, 4);
    });

    // Case: filters by assigneeId and mine.
    it("filters by assigneeId and mine", async () => {
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await seedTickets(6, {
        // Fixture field status for the seeded actor/entity.
        status: TicketStatus.assigned,
        // Execute the next setup or assertion step for this scenario.
        assigneeId: world.technician.employeeId,
        // Execute the next setup or assertion step for this scenario.
        titlePrefix: "t1",
      });
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await seedTickets(3, {
        // Fixture field status for the seeded actor/entity.
        status: TicketStatus.assigned,
        // Execute the next setup or assertion step for this scenario.
        assigneeId: world.technician2.employeeId,
        // Execute the next setup or assertion step for this scenario.
        titlePrefix: "t2",
      });
      // byAssignee: synchronize actors so the race window is observable.
      const byAssignee = await drain(
        // Execute the next setup or assertion step for this scenario.
        ownerToken,
        // Execute the next setup or assertion step for this scenario.
        { status: "open", assigneeId: world.technician.employeeId },
        4,
      );
      // Assert collection size matches the expected post-condition.
      assert.equal(byAssignee.ids.length, 6);
      // Assert the observed value matches the intended post-condition.
      assert.ok(byAssignee.totals.every((t) => t === 6));
      // mine: synchronize actors so the race window is observable.
      const mine = await drain(techToken, { status: "open", mine: "1" }, 4);
      // Assert collection size matches the expected post-condition.
      assert.equal(mine.ids.length, 6);
    });

    // Case probes concurrency/isolation: filters slaBreached and blocksRoom across pages.
    it("filters slaBreached and blocksRoom across pages", async () => {
      // Bind past for later setup or assertions in this scope.
      const past = new Date(Date.now() - 60_000);
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await seedTickets(12, {
        // Concurrency/isolation step for the race under test.
        blocksRoom: true,
        // Execute the next setup or assertion step for this scenario.
        dueAt: past,
        // Execute the next setup or assertion step for this scenario.
        titlePrefix: "breach",
      });
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await seedTickets(5, {
        // Concurrency/isolation step for the race under test.
        blocksRoom: false,
        // Execute the next setup or assertion step for this scenario.
        dueAt: new Date(Date.now() + 3600_000),
        // Execute the next setup or assertion step for this scenario.
        titlePrefix: "ok",
      });
      // breached: synchronize actors so the race window is observable.
      const breached = await drain(
        // Execute the next setup or assertion step for this scenario.
        ownerToken,
        // Execute the next setup or assertion step for this scenario.
        { status: "open", slaBreached: "1" },
        5,
      );
      // Assert collection size matches the expected post-condition.
      assert.equal(breached.ids.length, 12);
      // Assert the observed value matches the intended post-condition.
      assert.ok(breached.pages.flatMap((p) => p.items).every((r) => r.slaBreached));
      // blocking: synchronize actors so the race window is observable.
      const blocking = await drain(
        // Execute the next setup or assertion step for this scenario.
        ownerToken,
        // Concurrency/isolation step for the race under test.
        { status: "open", blocksRoom: "1" },
        5,
      );
      // Assert collection size matches the expected post-condition.
      assert.equal(blocking.ids.length, 12);
    });

    // Case: includes archived-location history on status=all and hides them from open.
    it("includes archived-location history on status=all and hides them from open", async () => {
      // archived: seeded entity required before the mutation under test.
      const archived = await prisma.location.create({
        // Execute the next setup or assertion step for this scenario.
        data: {
          // Execute the next setup or assertion step for this scenario.
          floorId: world.floorId,
          // Execute the next setup or assertion step for this scenario.
          number: `ARC-${Date.now()}`.slice(0, 24),
          // Execute the next setup or assertion step for this scenario.
          kind: "room",
          // Execute the next setup or assertion step for this scenario.
          catalogStatus: "archived",
          // Execute the next setup or assertion step for this scenario.
          cleaningStatus: "dirty",
          // Execute the next setup or assertion step for this scenario.
          occupancy: "vacant",
          // Execute the next setup or assertion step for this scenario.
          serviceStatus: "in_service",
        },
      });
      // Try path where partial failure must not leak suite state.
      try {
        // Seed prerequisite rows so the mutation under test has a realistic baseline.
        await seedTickets(3, {
          // Execute the next setup or assertion step for this scenario.
          locationId: archived.id,
          // Execute the next setup or assertion step for this scenario.
          titlePrefix: "arch",
        });
        // Seed prerequisite rows so the mutation under test has a realistic baseline.
        await seedTickets(2, { titlePrefix: "live" });
        // open: HTTP response captured for status/body checks.
        const open = await getJson(
          // Execute the next setup or assertion step for this scenario.
          api,
          // Execute the next setup or assertion step for this scenario.
          ownerToken,
          // Pagination step for list/contract coverage.
          `/maintenance/tickets?status=open&paginated=1&limit=50`,
        );
        // Bind openBody for later setup or assertions in this scope.
        const openBody = open.body as PageBody;
        // Assert the observed value matches the intended post-condition.
        assert.ok(!openBody.items.some((r) => r.title.startsWith("arch-")));
        // all: HTTP response captured for status/body checks.
        const all = await getJson(
          // Execute the next setup or assertion step for this scenario.
          api,
          // Execute the next setup or assertion step for this scenario.
          ownerToken,
          // Pagination step for list/contract coverage.
          `/maintenance/tickets?status=all&paginated=1&limit=50&locationId=${archived.id}`,
        );
        // Bind allBody for later setup or assertions in this scope.
        const allBody = all.body as PageBody;
        // Assert the observed value matches the intended post-condition.
        assert.equal(allBody.total, 3);
        // Assert collection size matches the expected post-condition.
        assert.equal(allBody.items.length, 3);
      // Execute the next setup or assertion step for this scenario.
      } finally {
        // Await async work before asserting or releasing locks.
        await prisma.maintenanceTicket.deleteMany({ where: { locationId: archived.id } });
        // Await async work before asserting or releasing locks.
        await prisma.location.delete({ where: { id: archived.id } });
      }
    });
  });

  // Suite: TEST D: authorization / data scope.
  describe("TEST D: authorization / data scope", () => {
    // Case: technician assigned_tickets scope never sees another assignee.
    it("technician assigned_tickets scope never sees another assignee's tickets", async () => {
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await seedTickets(8, {
        // Fixture field status for the seeded actor/entity.
        status: TicketStatus.assigned,
        // Execute the next setup or assertion step for this scenario.
        assigneeId: world.technician.employeeId,
        // Execute the next setup or assertion step for this scenario.
        titlePrefix: "own",
      });
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await seedTickets(8, {
        // Fixture field status for the seeded actor/entity.
        status: TicketStatus.assigned,
        // Execute the next setup or assertion step for this scenario.
        assigneeId: world.technician2.employeeId,
        // Execute the next setup or assertion step for this scenario.
        locationId: world.locationBId,
        // Execute the next setup or assertion step for this scenario.
        titlePrefix: "oth",
      });
      // tech: synchronize actors so the race window is observable.
      const tech = await drain(techToken, { status: "open" }, 5);
      // Technician scope is assignee-based; locationId is still honored when passed.
      const techAll = await getJson(
        // Execute the next setup or assertion step for this scenario.
        api,
        // Execute the next setup or assertion step for this scenario.
        techToken,
        // Pagination step for list/contract coverage.
        `/maintenance/tickets?status=open&paginated=1&limit=50`,
      );
      // Assert HTTP status matches the contract for this path.
      assert.equal(techAll.status, 200);
      // Bind body for later setup or assertions in this scope.
      const body = techAll.body as PageBody;
      // Assert the observed value matches the intended post-condition.
      assert.ok(body.items.every((r) => r.assignee?.id === world.technician.employeeId));
      // Assert collection size matches the expected post-condition.
      assert.equal(body.total, tech.ids.length);
      // Assert the observed value matches the intended post-condition.
      assert.ok(body.total <= 8);
      // Assert the observed value matches the intended post-condition.
      assert.ok(!body.items.some((r) => r.title.startsWith("oth-")));
    });

    // Case: housekeeper does not see technician tickets on an unassigned location.
    it("housekeeper does not see technician tickets on an unassigned location", async () => {
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await seedTickets(10, {
        // Fixture field status for the seeded actor/entity.
        status: TicketStatus.assigned,
        // Execute the next setup or assertion step for this scenario.
        assigneeId: world.technician.employeeId,
        // Execute the next setup or assertion step for this scenario.
        locationId: world.locationBId,
        // Execute the next setup or assertion step for this scenario.
        titlePrefix: "scoped",
      });
      // res: HTTP response captured for status/body checks.
      const res = await getJson(
        // Execute the next setup or assertion step for this scenario.
        api,
        // Execute the next setup or assertion step for this scenario.
        hkToken,
        // Pagination step for list/contract coverage.
        `/maintenance/tickets?status=open&paginated=1&limit=50`,
      );
      // Assert HTTP status matches the contract for this path.
      assert.equal(res.status, 200);
      // Bind body for later setup or assertions in this scope.
      const body = res.body as PageBody;
      // Assert the observed value matches the intended post-condition.
      assert.ok(
        // Execute the next setup or assertion step for this scenario.
        !body.items.some((r) => r.title.startsWith("scoped-")),
        // Execute the next setup or assertion step for this scenario.
        "housekeeper leaked location-B technician tickets",
      );
    });

    // Case: reception (hotel-wide) and owner/manager paginate the full fixture set.
    it("reception (hotel-wide) and owner/manager paginate the full fixture set", async () => {
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await seedTickets(60, { titlePrefix: "mgmt" });
      // Iterate to cover variants or wait until a condition holds.
      for (const [label, token] of [
        // Execute the next setup or assertion step for this scenario.
        ["owner", ownerToken],
        // Execute the next setup or assertion step for this scenario.
        ["manager", managerToken],
        // Execute the next setup or assertion step for this scenario.
        ["reception", receptionToken],
      // Execute the next setup or assertion step for this scenario.
      ] as const) {
        // drained: synchronize actors so the race window is observable.
        const drained = await drain(token, { status: "open" }, 50);
        // Assert collection size matches the expected post-condition.
        assert.equal(drained.ids.length, 60, label);
        // Assert the observed value matches the intended post-condition.
        assert.ok(drained.totals.every((t) => t === 60), label);
      }
    });

    // Case: supervisor with no sectors does not leak totals for out-of-scope tickets.
    it("supervisor with no sectors does not leak totals for out-of-scope tickets", async () => {
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await seedTickets(20, { titlePrefix: "sup" });
      // res: HTTP response captured for status/body checks.
      const res = await getJson(
        // Execute the next setup or assertion step for this scenario.
        api,
        // Execute the next setup or assertion step for this scenario.
        supervisorToken,
        // Pagination step for list/contract coverage.
        `/maintenance/tickets?status=open&paginated=1&limit=50&locationId=${world.locationAId}`,
      );
      // Assert HTTP status matches the contract for this path.
      assert.equal(res.status, 200);
      // Bind body for later setup or assertions in this scope.
      const body = res.body as PageBody;
      // Assert the observed value matches the intended post-condition.
      assert.equal(body.total, 0);
      // Assert collection size matches the expected post-condition.
      assert.equal(body.items.length, 0);
      // Assert the observed value matches the intended post-condition.
      assert.equal(body.nextCursor, null);
    });

    // Case: forged cursor cannot widen technician scope beyond assignee filter.
    it("forged cursor cannot widen technician scope beyond assignee filter", async () => {
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await seedTickets(5, {
        // Fixture field status for the seeded actor/entity.
        status: TicketStatus.assigned,
        // Execute the next setup or assertion step for this scenario.
        assigneeId: world.technician.employeeId,
        // Execute the next setup or assertion step for this scenario.
        titlePrefix: "vis",
      });
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await seedTickets(5, {
        // Fixture field status for the seeded actor/entity.
        status: TicketStatus.assigned,
        // Execute the next setup or assertion step for this scenario.
        assigneeId: world.technician2.employeeId,
        // Execute the next setup or assertion step for this scenario.
        titlePrefix: "hid",
      });
      // Bind first for later setup or assertions in this scope.
      const first = (
        // Await async work before asserting or releasing locks.
        await getJson(
          // Execute the next setup or assertion step for this scenario.
          api,
          // Execute the next setup or assertion step for this scenario.
          techToken,
          // Pagination step for list/contract coverage.
          `/maintenance/tickets?status=open&paginated=1&limit=2`,
        )
      // Execute the next setup or assertion step for this scenario.
      ).body as PageBody;
      // Assert the observed value matches the intended post-condition.
      assert.ok(first.nextCursor);
      // next: HTTP response captured for status/body checks.
      const next = await getJson(
        // Execute the next setup or assertion step for this scenario.
        api,
        // Execute the next setup or assertion step for this scenario.
        techToken,
        // Pagination step for list/contract coverage.
        `/maintenance/tickets?status=open&paginated=1&limit=50&cursor=${encodeURIComponent(first.nextCursor!)}`,
      );
      // Bind body for later setup or assertions in this scope.
      const body = next.body as PageBody;
      // Assert the observed value matches the intended post-condition.
      assert.ok(body.items.every((r) => r.assignee?.id === world.technician.employeeId));
      // Assert the observed value matches the intended post-condition.
      assert.ok(!body.items.some((r) => r.title.startsWith("hid-")));
    });
  });

  // Suite: TEST E: concurrent modifications.
  describe("TEST E: concurrent modifications", () => {
    // Case: inserts that sort before the cursor stay off page-2 until refresh.
    it("inserts that sort before the cursor stay off page-2 until refresh", async () => {
      // Bind base for later setup or assertions in this scope.
      const base = Date.now();
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await seedTickets(55, {
        // Execute the next setup or assertion step for this scenario.
        openedAt: (i) => new Date(base - (i + 10) * 1000),
        // Execute the next setup or assertion step for this scenario.
        titlePrefix: "old",
      });
      // Bind first for later setup or assertions in this scope.
      const first = (
        // Await async work before asserting or releasing locks.
        await getJson(
          // Execute the next setup or assertion step for this scenario.
          api,
          // Execute the next setup or assertion step for this scenario.
          ownerToken,
          // Pagination step for list/contract coverage.
          `/maintenance/tickets?status=open&paginated=1&limit=50&locationId=${world.locationAId}`,
        )
      // Execute the next setup or assertion step for this scenario.
      ).body as PageBody;
      // Assert collection size matches the expected post-condition.
      assert.equal(first.items.length, 50);
      // Assert the observed value matches the intended post-condition.
      assert.ok(first.nextCursor);

      // Newer than every seeded row → sorts before cursor; keyset page-2 ignores it.
      await seedTickets(1, {
        // Execute the next setup or assertion step for this scenario.
        openedAt: new Date(base + 60_000),
        // Execute the next setup or assertion step for this scenario.
        titlePrefix: "newish",
      });

      // Bind second for later setup or assertions in this scope.
      const second = (
        // Await async work before asserting or releasing locks.
        await getJson(
          // Execute the next setup or assertion step for this scenario.
          api,
          // Execute the next setup or assertion step for this scenario.
          ownerToken,
          // Pagination step for list/contract coverage.
          `/maintenance/tickets?status=open&paginated=1&limit=50&locationId=${world.locationAId}&cursor=${encodeURIComponent(first.nextCursor!)}`,
        )
      // Execute the next setup or assertion step for this scenario.
      ).body as PageBody;
      // Assert collection size matches the expected post-condition.
      assert.equal(second.items.length, 5);
      // Assert the observed value matches the intended post-condition.
      assert.ok(!second.items.some((r) => r.title.startsWith("newish-")));
      // Assert the observed value matches the intended post-condition.
      assert.equal(second.total, 56);

      // Bind refreshed for later setup or assertions in this scope.
      const refreshed = (
        // Await async work before asserting or releasing locks.
        await getJson(
          // Execute the next setup or assertion step for this scenario.
          api,
          // Execute the next setup or assertion step for this scenario.
          ownerToken,
          // Pagination step for list/contract coverage.
          `/maintenance/tickets?status=open&paginated=1&limit=50&locationId=${world.locationAId}`,
        )
      // Execute the next setup or assertion step for this scenario.
      ).body as PageBody;
      // Assert the observed value matches the intended post-condition.
      assert.equal(refreshed.items[0]!.title.startsWith("newish-"), true);
      // Bind drainIds for later setup or assertions in this scope.
      const drainIds = new Set([
        // Continue the call chain for setup or assertion detail.
        ...first.items.map((r) => r.id),
        // Continue the call chain for setup or assertion detail.
        ...second.items.map((r) => r.id),
      ]);
      // Assert the observed value matches the intended post-condition.
      assert.equal(drainIds.size, 55);
    });

    // Case: resolving a later-page ticket omits it without duplicating earlier ids.
    it("resolving a later-page ticket omits it without duplicating earlier ids", async () => {
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await seedTickets(58, { titlePrefix: "mut" });
      // Bind first for later setup or assertions in this scope.
      const first = (
        // Await async work before asserting or releasing locks.
        await getJson(
          // Execute the next setup or assertion step for this scenario.
          api,
          // Execute the next setup or assertion step for this scenario.
          ownerToken,
          // Pagination step for list/contract coverage.
          `/maintenance/tickets?status=open&paginated=1&limit=50&locationId=${world.locationAId}`,
        )
      // Execute the next setup or assertion step for this scenario.
      ).body as PageBody;
      // pending: synchronize actors so the race window is observable.
      const pending = await prisma.maintenanceTicket.findMany({
        // SQL fragment used to observe locks or assert DB state.
        where: {
          // Execute the next setup or assertion step for this scenario.
          locationId: world.locationAId,
          // Execute the next setup or assertion step for this scenario.
          id: { notIn: first.items.map((r) => r.id) },
        },
        // SQL fragment used to observe locks or assert DB state.
        select: { id: true },
        // Execute the next setup or assertion step for this scenario.
        take: 1,
      });
      // Assert collection size matches the expected post-condition.
      assert.equal(pending.length, 1);
      // Await async work before asserting or releasing locks.
      await prisma.maintenanceTicket.update({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: pending[0]!.id },
        // Execute the next setup or assertion step for this scenario.
        data: {
          // Fixture field status for the seeded actor/entity.
          status: TicketStatus.resolved,
          // Execute the next setup or assertion step for this scenario.
          resolvedAt: new Date(),
        },
      });
      // Bind second for later setup or assertions in this scope.
      const second = (
        // Await async work before asserting or releasing locks.
        await getJson(
          // Execute the next setup or assertion step for this scenario.
          api,
          // Execute the next setup or assertion step for this scenario.
          ownerToken,
          // Pagination step for list/contract coverage.
          `/maintenance/tickets?status=open&paginated=1&limit=50&locationId=${world.locationAId}&cursor=${encodeURIComponent(first.nextCursor!)}`,
        )
      // Execute the next setup or assertion step for this scenario.
      ).body as PageBody;
      // Bind ids for later setup or assertions in this scope.
      const ids = [...first.items, ...second.items].map((r) => r.id);
      // Assert collection size matches the expected post-condition.
      assert.equal(new Set(ids).size, ids.length);
      // Assert the observed value matches the intended post-condition.
      assert.ok(!ids.includes(pending[0]!.id));
      // Assert collection size matches the expected post-condition.
      assert.equal(ids.length, 57);
    });
  });

  // Suite: TEST F: API compatibility.
  describe("TEST F: API compatibility", () => {
    // Case: legacy array response remains the default without paginated/cursor.
    it("legacy array response remains the default without paginated/cursor", async () => {
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await seedTickets(3);
      // res: HTTP response captured for status/body checks.
      const res = await getJson(
        // Execute the next setup or assertion step for this scenario.
        api,
        // Execute the next setup or assertion step for this scenario.
        ownerToken,
        // Pagination step for list/contract coverage.
        `/maintenance/tickets?status=open&limit=2&locationId=${world.locationAId}`,
      );
      // Assert HTTP status matches the contract for this path.
      assert.equal(res.status, 200);
      // Assert the observed value matches the intended post-condition.
      assert.ok(Array.isArray(res.body));
      // Assert collection size matches the expected post-condition.
      assert.equal((res.body as TicketRow[]).length, 2);
    });

    // Case: paginated=1 returns envelope even without cursor.
    it("paginated=1 returns envelope even without cursor", async () => {
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await seedTickets(2);
      // res: HTTP response captured for status/body checks.
      const res = await getJson(
        // Execute the next setup or assertion step for this scenario.
        api,
        // Execute the next setup or assertion step for this scenario.
        ownerToken,
        // Pagination step for list/contract coverage.
        `/maintenance/tickets?status=open&paginated=1&limit=50&locationId=${world.locationAId}`,
      );
      // Assert HTTP status matches the contract for this path.
      assert.equal(res.status, 200);
      // Bind body for later setup or assertions in this scope.
      const body = res.body as PageBody;
      // Assert the observed value matches the intended post-condition.
      assert.ok(Array.isArray(body.items));
      // Assert the observed value matches the intended post-condition.
      assert.equal(body.total, 2);
      // Assert the observed value matches the intended post-condition.
      assert.equal(body.nextCursor, null);
    });

    // Case: caps limit at 100.
    it("caps limit at 100", async () => {
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await seedTickets(120);
      // res: HTTP response captured for status/body checks.
      const res = await getJson(
        // Execute the next setup or assertion step for this scenario.
        api,
        // Execute the next setup or assertion step for this scenario.
        ownerToken,
        // Pagination step for list/contract coverage.
        `/maintenance/tickets?status=open&paginated=1&limit=500&locationId=${world.locationAId}`,
      );
      // Assert HTTP status matches the contract for this path.
      assert.equal(res.status, 200);
      // Bind body for later setup or assertions in this scope.
      const body = res.body as PageBody;
      // Assert collection size matches the expected post-condition.
      assert.equal(body.items.length, 100);
      // Assert the observed value matches the intended post-condition.
      assert.ok(body.nextCursor);
      // Assert the observed value matches the intended post-condition.
      assert.equal(body.total, 120);
    });
  });
});
