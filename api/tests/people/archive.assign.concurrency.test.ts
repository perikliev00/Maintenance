/**
 * Archive vs cleaning/ticket assignment: whichever commits first must make the
 * other refuse — never archived-with-open-work or assign-to-archived.
 *
 * createCleaningTask takes Location FOR UPDATE before User FOR SHARE. If the
 * fixture location already has an active task for today's hotel date, create
 * returns conflict before reaching the User lock and the barrier never sees
 * two waiters. Each case therefore owns a fresh location with no active task.
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  CatalogStatus,
  LocationKind,
  PrismaClient,
  Role,
  TaskStatus,
  TicketStatus,
} from "@prisma/client";
import { assertTestDatabase } from "../assertTestDatabase";
import { orderedDatabaseRace, withDatabaseBarrier } from "../dbBarrier";
import {
  cleanupEmployeeGraph,
  createEmployeeWithUser,
} from "../fixtures";
import { createCleaningTask } from "../../src/services/cleaning";
import { archivePerson } from "../../src/services/people/lifecycle";
import { assignMaintenanceTicket } from "../../src/services/maintenance";
import { todayHotelDateYmd } from "../../src/services/hotelTime";
import { AppError } from "../../src/errors";

const prisma = new PrismaClient();

type Settled = PromiseSettledResult<unknown>;

function rejectedAppError(settled: Settled[]): AppError {
  const rejected = settled.find((s) => s.status === "rejected");
  assert.ok(rejected && rejected.status === "rejected", "expected a rejection");
  assert.ok(rejected.reason instanceof AppError, String(rejected.reason));
  return rejected.reason;
}

function fulfilledCount(settled: Settled[]): number {
  return settled.filter((s) => s.status === "fulfilled").length;
}

describe("archive × assign concurrency", () => {
  const fixtureIds: string[] = [];
  const locationIds: string[] = [];
  let actor: Awaited<ReturnType<typeof createEmployeeWithUser>>;
  let propertyId: string;
  let buildingId: string;
  let floorId: string;

  async function freshLocation(label: string): Promise<string> {
    const location = await prisma.location.create({
      data: {
        floorId,
        number: `AA-${label}-${Date.now()}`.slice(0, 24),
        kind: LocationKind.room,
        catalogStatus: CatalogStatus.active,
      },
    });
    locationIds.push(location.id);
    return location.id;
  }

  before(async () => {
    await assertTestDatabase(prisma);
    const stamp = Date.now();
    actor = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-AA-ACT-${stamp}`,
      email: `t-aa-act-${stamp}@test.local`,
      role: Role.manager,
      fullName: "T Archive Assign Actor",
    });
    fixtureIds.push(actor.employeeId);
    const property = await prisma.property.create({
      data: { name: `AA Property ${stamp}` },
    });
    propertyId = property.id;
    const building = await prisma.building.create({
      data: {
        propertyId: property.id,
        name: "AA Building",
        code: `AAB-${stamp}`.slice(0, 32),
      },
    });
    buildingId = building.id;
    const floor = await prisma.floor.create({
      data: {
        buildingId: building.id,
        number: 91,
        name: "AA Floor",
      },
    });
    floorId = floor.id;
  });

  after(async () => {
    const tickets = await prisma.maintenanceTicket.findMany({
      where: { reportedByEmployeeId: { in: fixtureIds } },
      select: { id: true },
    });
    const ticketIds = tickets.map((t) => t.id);
    if (ticketIds.length) {
      await prisma.ticketEvent.deleteMany({
        where: { ticketId: { in: ticketIds } },
      });
      await prisma.maintenanceTicket.deleteMany({
        where: { id: { in: ticketIds } },
      });
    }
    await prisma.cleaningTask.deleteMany({
      where: {
        OR: [
          { assignedEmployeeId: { in: fixtureIds } },
          { locationId: { in: locationIds } },
        ],
      },
    });
    if (locationIds.length) {
      await prisma.location.deleteMany({ where: { id: { in: locationIds } } });
    }
    if (floorId) await prisma.floor.deleteMany({ where: { id: floorId } });
    if (buildingId) {
      await prisma.building.deleteMany({ where: { id: buildingId } });
    }
    if (propertyId) {
      await prisma.property.deleteMany({ where: { id: propertyId } });
    }
    await cleanupEmployeeGraph(prisma, fixtureIds);
    await prisma.$disconnect();
  });

  it("cleaning assign vs archive — coherent winner (simultaneous)", async () => {
    const stamp = Date.now();
    const worker = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-AA-W1-${stamp}`,
      email: `t-aa-w1-${stamp}@test.local`,
      role: Role.housekeeper,
      fullName: "T Archive Assign Worker1",
    });
    fixtureIds.push(worker.employeeId);
    const locationId = await freshLocation("sim");
    const version = (
      await prisma.employee.findUniqueOrThrow({
        where: { id: worker.employeeId },
      })
    ).accessVersion;
    const hotelDate = await todayHotelDateYmd();

    const settled = await withDatabaseBarrier(
      prisma,
      (tx) =>
        tx.$queryRaw`
          SELECT id FROM "User" WHERE id = ${worker.userId} FOR UPDATE
        `,
      () =>
        Promise.allSettled([
          createCleaningTask({
            locationId,
            hotelDate,
            assignedEmployeeId: worker.employeeId,
            serviceType: "stayover",
          }),
          archivePerson(
            {
              userId: actor.userId,
              employeeId: actor.employeeId,
              role: Role.manager,
            },
            worker.employeeId,
            "active",
            version,
          ),
        ]),
    );

    assert.equal(fulfilledCount(settled), 1, JSON.stringify(settled, null, 2));
    const emp = await prisma.employee.findUniqueOrThrow({
      where: { id: worker.employeeId },
    });
    const open = await prisma.cleaningTask.count({
      where: {
        locationId,
        assignedEmployeeId: worker.employeeId,
        status: {
          in: [
            TaskStatus.assigned,
            TaskStatus.in_progress,
            TaskStatus.awaiting_inspection,
            TaskStatus.rework,
          ],
        },
      },
    });

    if (emp.archivedAt) {
      assert.equal(open, 0);
      const reason = rejectedAppError(settled);
      assert.ok(
        reason.code === "conflict" ||
          reason.code === "validation" ||
          reason.status === 400,
        `archive won; assign rejection=${reason.code}`,
      );
    } else {
      assert.ok(open >= 1);
      const reason = rejectedAppError(settled);
      assert.equal(reason.code, "unfinished_work");
    }
  });

  it("cleaning assign wins ordered race → archive unfinished_work", async () => {
    const stamp = Date.now();
    const worker = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-AA-W3-${stamp}`,
      email: `t-aa-w3-${stamp}@test.local`,
      role: Role.housekeeper,
      fullName: "T Archive Assign Worker3",
    });
    fixtureIds.push(worker.employeeId);
    const locationId = await freshLocation("aw");
    const version = (
      await prisma.employee.findUniqueOrThrow({
        where: { id: worker.employeeId },
      })
    ).accessVersion;
    const hotelDate = await todayHotelDateYmd();

    const settled = await orderedDatabaseRace(
      prisma,
      (tx) =>
        tx.$queryRaw`
          SELECT id FROM "User" WHERE id = ${worker.userId} FOR UPDATE
        `,
      () =>
        createCleaningTask({
          locationId,
          hotelDate,
          assignedEmployeeId: worker.employeeId,
          serviceType: "stayover",
        }),
      () =>
        archivePerson(
          {
            userId: actor.userId,
            employeeId: actor.employeeId,
            role: Role.manager,
          },
          worker.employeeId,
          "active",
          version,
        ),
    );

    assert.equal(settled[0]?.status, "fulfilled", JSON.stringify(settled));
    assert.equal(settled[1]?.status, "rejected", JSON.stringify(settled));
    const reason = rejectedAppError(settled);
    assert.equal(reason.code, "unfinished_work");

    const emp = await prisma.employee.findUniqueOrThrow({
      where: { id: worker.employeeId },
    });
    assert.equal(emp.archivedAt, null);
    const open = await prisma.cleaningTask.count({
      where: {
        locationId,
        assignedEmployeeId: worker.employeeId,
        status: TaskStatus.assigned,
      },
    });
    assert.equal(open, 1);
  });

  it("archive wins ordered race → cleaning assign refuses", async () => {
    const stamp = Date.now();
    const worker = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-AA-W4-${stamp}`,
      email: `t-aa-w4-${stamp}@test.local`,
      role: Role.housekeeper,
      fullName: "T Archive Assign Worker4",
    });
    fixtureIds.push(worker.employeeId);
    const locationId = await freshLocation("ar");
    const version = (
      await prisma.employee.findUniqueOrThrow({
        where: { id: worker.employeeId },
      })
    ).accessVersion;
    const hotelDate = await todayHotelDateYmd();

    const settled = await orderedDatabaseRace(
      prisma,
      (tx) =>
        tx.$queryRaw`
          SELECT id FROM "User" WHERE id = ${worker.userId} FOR UPDATE
        `,
      () =>
        archivePerson(
          {
            userId: actor.userId,
            employeeId: actor.employeeId,
            role: Role.manager,
          },
          worker.employeeId,
          "active",
          version,
        ),
      () =>
        createCleaningTask({
          locationId,
          hotelDate,
          assignedEmployeeId: worker.employeeId,
          serviceType: "stayover",
        }),
    );

    assert.equal(settled[0]?.status, "fulfilled", JSON.stringify(settled));
    assert.equal(settled[1]?.status, "rejected", JSON.stringify(settled));
    const reason = rejectedAppError(settled);
    assert.ok(
      reason.status === 400 || reason.code === "validation",
      `assign rejection=${reason.code}/${reason.status}`,
    );

    const emp = await prisma.employee.findUniqueOrThrow({
      where: { id: worker.employeeId },
    });
    assert.ok(emp.archivedAt);
    const open = await prisma.cleaningTask.count({
      where: {
        locationId,
        assignedEmployeeId: worker.employeeId,
        status: {
          in: [
            TaskStatus.assigned,
            TaskStatus.in_progress,
            TaskStatus.awaiting_inspection,
            TaskStatus.rework,
          ],
        },
      },
    });
    assert.equal(open, 0);
  });

  it("archive then assign sequentially refuses archived employee", async () => {
    const stamp = Date.now();
    const worker = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-AA-W2-${stamp}`,
      email: `t-aa-w2-${stamp}@test.local`,
      role: Role.housekeeper,
      fullName: "T Archive Assign Worker2",
    });
    fixtureIds.push(worker.employeeId);
    const locationId = await freshLocation("seq");
    const version = (
      await prisma.employee.findUniqueOrThrow({
        where: { id: worker.employeeId },
      })
    ).accessVersion;
    const hotelDate = await todayHotelDateYmd();

    await archivePerson(
      {
        userId: actor.userId,
        employeeId: actor.employeeId,
        role: Role.manager,
      },
      worker.employeeId,
      "active",
      version,
    );

    await assert.rejects(
      () =>
        createCleaningTask({
          locationId,
          hotelDate,
          assignedEmployeeId: worker.employeeId,
          serviceType: "stayover",
        }),
      (err: unknown) => err instanceof AppError && err.status === 400,
    );
  });

  it("assign then archive sequentially refuses unfinished_work", async () => {
    const stamp = Date.now();
    const worker = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-AA-W5-${stamp}`,
      email: `t-aa-w5-${stamp}@test.local`,
      role: Role.housekeeper,
      fullName: "T Archive Assign Worker5",
    });
    fixtureIds.push(worker.employeeId);
    const locationId = await freshLocation("sa");
    const version = (
      await prisma.employee.findUniqueOrThrow({
        where: { id: worker.employeeId },
      })
    ).accessVersion;
    const hotelDate = await todayHotelDateYmd();

    await createCleaningTask({
      locationId,
      hotelDate,
      assignedEmployeeId: worker.employeeId,
      serviceType: "stayover",
    });

    await assert.rejects(
      () =>
        archivePerson(
          {
            userId: actor.userId,
            employeeId: actor.employeeId,
            role: Role.manager,
          },
          worker.employeeId,
          "active",
          version,
        ),
      (err: unknown) =>
        err instanceof AppError && err.code === "unfinished_work",
    );
  });

  it("ticket assign races with archive — winner leaves coherent state", async () => {
    const stamp = Date.now();
    const tech = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-AA-T1-${stamp}`,
      email: `t-aa-t1-${stamp}@test.local`,
      role: Role.technician,
      fullName: "T Archive Assign Tech1",
    });
    fixtureIds.push(tech.employeeId);
    const locationId = await freshLocation("tk");
    const version = (
      await prisma.employee.findUniqueOrThrow({
        where: { id: tech.employeeId },
      })
    ).accessVersion;

    const ticket = await prisma.maintenanceTicket.create({
      data: {
        locationId,
        title: `AA-ticket-${stamp}`,
        categoryKey: "other",
        categoryLabelBg: "Друго",
        categoryLabelEn: "Other",
        reportedByEmployeeId: actor.employeeId,
        status: TicketStatus.new,
      },
    });

    const settled = await withDatabaseBarrier(
      prisma,
      (tx) =>
        tx.$queryRaw`
          SELECT id FROM "User" WHERE id = ${tech.userId} FOR UPDATE
        `,
      () =>
        Promise.allSettled([
          assignMaintenanceTicket({
            ticketId: ticket.id,
            assigneeId: tech.employeeId,
            actorEmployeeId: actor.employeeId,
          }),
          archivePerson(
            {
              userId: actor.userId,
              employeeId: actor.employeeId,
              role: Role.manager,
            },
            tech.employeeId,
            "active",
            version,
          ),
        ]),
    );

    const emp = await prisma.employee.findUniqueOrThrow({
      where: { id: tech.employeeId },
    });
    const assigned = await prisma.maintenanceTicket.findUniqueOrThrow({
      where: { id: ticket.id },
    });

    // Coherent outcomes only: never archived-with-this-assignee.
    if (emp.archivedAt) {
      assert.notEqual(assigned.assigneeId, tech.employeeId);
    } else {
      assert.equal(assigned.assigneeId, tech.employeeId);
      const reason = rejectedAppError(settled);
      assert.equal(reason.code, "unfinished_work");
    }
  });
});
