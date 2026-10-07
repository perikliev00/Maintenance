/**
 * Smoke checks for atomic maintenance ticket transitions (close/reopen race).
 * Requires DB + seeded employees. Does not need the HTTP API.
 */
import { Priority, PrismaClient, TicketStatus } from "@prisma/client";
import { AppError } from "../src/errors";
import {
  closeMaintenanceTicket,
  reopenMaintenanceTicket,
} from "../src/services/maintenance";

const prisma = new PrismaClient();

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function errCode(err: unknown): string | null {
  if (err instanceof AppError) return err.code;
  return null;
}

async function createResolvedBlockingTicket(input: {
  locationId: string;
  reporterId: string;
  resolverId: string;
}) {
  const option = await prisma.issueOption.findFirst({
    where: { isActive: true },
    include: { maintenanceCategory: true },
    orderBy: { sortOrder: "asc" },
  });
  assert(option, "no active issue option");
  assert(option.maintenanceCategory, "issue option missing category");

  return prisma.maintenanceTicket.create({
    data: {
      locationId: input.locationId,
      title: `Smoke close/reopen race ${Date.now()}`,
      issueOptionId: option.id,
      maintenanceCategoryId: option.maintenanceCategoryId,
      categoryKey: option.maintenanceCategory.key,
      categoryLabelBg: option.maintenanceCategory.nameBg,
      categoryLabelEn: option.maintenanceCategory.nameEn,
      priority: Priority.high,
      blocksRoom: true,
      status: TicketStatus.resolved,
      reportedByEmployeeId: input.reporterId,
      assigneeId: input.resolverId,
      resolvedAt: new Date(),
      resolvedByEmployeeId: input.resolverId,
      resolutionNotes: "smoke resolved",
    },
  });
}

async function main() {
  const owner = await prisma.user.findUniqueOrThrow({
    where: { email: "owner@meridian.local" },
  });
  const tech = await prisma.user.findUniqueOrThrow({
    where: { email: "technician@meridian.local" },
  });
  assert(owner.employeeId, "owner has no employeeId");
  assert(tech.employeeId, "technician has no employeeId");

  const room = await prisma.location.findFirst({
    where: { catalogStatus: "active", kind: "room" },
    orderBy: { number: "asc" },
  });
  assert(room, "no active room");

  const ticket = await createResolvedBlockingTicket({
    locationId: room.id,
    reporterId: owner.employeeId,
    resolverId: tech.employeeId,
  });
  console.log("ticket", ticket.id, ticket.status);

  const settled = await Promise.allSettled([
    closeMaintenanceTicket({
      ticketId: ticket.id,
      closedByEmployeeId: owner.employeeId,
    }),
    reopenMaintenanceTicket({
      ticketId: ticket.id,
      reopenedByEmployeeId: tech.employeeId,
      reason: "smoke concurrent reopen",
    }),
  ]);

  const closeResult = settled[0]!;
  const reopenResult = settled[1]!;
  console.log(
    "concurrent_close_reopen",
    {
      close: closeResult.status,
      closeCode:
        closeResult.status === "rejected"
          ? errCode(closeResult.reason)
          : "ok",
      reopen: reopenResult.status,
      reopenCode:
        reopenResult.status === "rejected"
          ? errCode(reopenResult.reason)
          : "ok",
    },
  );

  const final = await prisma.maintenanceTicket.findUniqueOrThrow({
    where: { id: ticket.id },
  });
  console.log("final_status", final.status);

  const reopenFulfilled = reopenResult.status === "fulfilled";
  const closeFulfilled = closeResult.status === "fulfilled";

  if (reopenFulfilled) {
    assert(
      final.status === TicketStatus.in_progress,
      `successful reopen must leave ticket in_progress, got ${final.status}`,
    );
  }

  assert(
    !(closeFulfilled && reopenFulfilled && final.status === TicketStatus.closed),
    "delayed close must not overwrite a successful reopen",
  );

  if (closeResult.status === "rejected") {
    const code = errCode(closeResult.reason);
    assert(
      code === "invalid_state",
      `losing close should be invalid_state, got ${code}`,
    );
  }

  if (reopenResult.status === "rejected") {
    const code = errCode(reopenResult.reason);
    assert(
      code === "invalid_state",
      `losing reopen should be invalid_state, got ${code}`,
    );
    // Close won first; reopen from closed should still have succeeded under lock.
    // A rejected reopen means close didn't leave a reopenable state — unexpected for this race.
    assert(
      false,
      "reopen should succeed against resolved or closed; concurrent reopen must not lose to close",
    );
  }

  const latestEvent = await prisma.ticketEvent.findFirst({
    where: { ticketId: ticket.id },
    orderBy: { occurredAt: "desc" },
  });
  assert(latestEvent, "expected ticket events");
  assert(
    latestEvent.toStatus === final.status,
    `latest event toStatus ${latestEvent.toStatus} must match final ${final.status}`,
  );

  const reopenEvents = await prisma.ticketReopenEvent.count({
    where: { ticketId: ticket.id },
  });
  assert(reopenEvents >= 1, `expected reopen event, got ${reopenEvents}`);

  // Second race: reopen already in_progress — delayed close must 409 and stay open.
  const settled2 = await Promise.allSettled([
    closeMaintenanceTicket({
      ticketId: ticket.id,
      closedByEmployeeId: owner.employeeId,
    }),
    reopenMaintenanceTicket({
      ticketId: ticket.id,
      reopenedByEmployeeId: tech.employeeId,
      reason: "smoke reopen while open",
    }),
  ]);
  const close2 = settled2[0]!;
  const reopen2 = settled2[1]!;
  assert(close2.status === "rejected", "close on in_progress must fail");
  assert(
    close2.status === "rejected" &&
      errCode(close2.reason) === "invalid_state",
    "close on in_progress must be invalid_state",
  );
  assert(reopen2.status === "rejected", "reopen on in_progress must fail");
  const afterSecond = await prisma.maintenanceTicket.findUniqueOrThrow({
    where: { id: ticket.id },
  });
  assert(
    afterSecond.status === TicketStatus.in_progress,
    `second race must leave in_progress, got ${afterSecond.status}`,
  );
  console.log("second_race_ok", afterSecond.status);

  await prisma.ticketEvent.deleteMany({ where: { ticketId: ticket.id } });
  await prisma.ticketReopenEvent.deleteMany({ where: { ticketId: ticket.id } });
  await prisma.maintenanceTicket.delete({ where: { id: ticket.id } });

  console.log("smoke-maintenance-atomic: ok");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
