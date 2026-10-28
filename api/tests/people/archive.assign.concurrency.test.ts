/**
 * Archive vs cleaning/ticket assignment: whichever commits first must make the
 * other refuse — never archived-with-open-work or assign-to-archived.
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient, Role, TaskStatus, TicketStatus } from "@prisma/client";
import { assertTestDatabase } from "../assertTestDatabase";
import { withDatabaseBarrier } from "../dbBarrier";
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

describe("archive × assign concurrency", () => {
  const fixtureIds: string[] = [];
  let actor: Awaited<ReturnType<typeof createEmployeeWithUser>>;
  let locationId: string;

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
    const location = await prisma.location.findFirst({
      where: { catalogStatus: "active" },
    });
    assert.ok(location);
    locationId = location.id;
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
      where: { assignedEmployeeId: { in: fixtureIds } },
    });
    await cleanupEmployeeGraph(prisma, fixtureIds);
    await prisma.$disconnect();
  });

  it("cleaning assign vs archive — coherent winner", async () => {
    const stamp = Date.now();
    const worker = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-AA-W1-${stamp}`,
      email: `t-aa-w1-${stamp}@test.local`,
      role: Role.housekeeper,
      fullName: "T Archive Assign Worker1",
    });
    fixtureIds.push(worker.employeeId);
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

    const emp = await prisma.employee.findUniqueOrThrow({
      where: { id: worker.employeeId },
    });
    const open = await prisma.cleaningTask.count({
      where: {
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
      const rejected = settled.find((s) => s.status === "rejected");
      assert.ok(rejected);
    } else {
      assert.ok(open >= 1);
      const rejected = settled.find((s) => s.status === "rejected");
      assert.ok(rejected && rejected.status === "rejected");
      const reason = rejected.reason;
      assert.ok(reason instanceof AppError);
      assert.equal(reason.code, "unfinished_work");
    }
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

  it("ticket assign races with archive — winner leaves coherent state", async () => {
    const stamp = Date.now();
    const tech = await createEmployeeWithUser(prisma, {
      employeeNumber: `T-AA-T1-${stamp}`,
      email: `t-aa-t1-${stamp}@test.local`,
      role: Role.technician,
      fullName: "T Archive Assign Tech1",
    });
    fixtureIds.push(tech.employeeId);
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
      const rejected = settled.find((s) => s.status === "rejected");
      assert.ok(rejected && rejected.status === "rejected");
      assert.ok(rejected.reason instanceof AppError);
      assert.equal(
        (rejected.reason as AppError).code,
        "unfinished_work",
      );
    }
  });
});
