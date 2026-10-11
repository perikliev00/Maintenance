import { Priority, TicketStatus } from "@prisma/client";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import {
  getActiveIssueOption,
  resolveCategorySnapshot,
  snapshotFromCategory,
} from "../issueCatalog";
import { recipientsForLocationOps } from "../notifications";
import { resolveSlaForPriority } from "../slaPolicies";
import { writeTicketEvent } from "./events";
import { formatMaintenanceTicket } from "./format";
import { notifyTicketEvent, publishTicketChanged } from "./notify";
import { ticketInclude, type CreateMaintenanceTicketInput } from "./types";

export async function createMaintenanceTicket(input: CreateMaintenanceTicketInput) {
  if (input.commandId) {
    const existing = await prisma.maintenanceTicket.findUnique({
      where: { commandId: input.commandId },
      include: ticketInclude,
    });
    if (existing) {
      return { ticket: formatMaintenanceTicket(existing), idempotent: true };
    }
  }

  const location = await prisma.location.findUnique({
    where: { id: input.locationId },
  });
  if (!location) {
    throw new AppError(404, "not_found", "Room not found");
  }

  if (input.issueOptionId && input.categoryId) {
    throw new AppError(
      400,
      "validation",
      "Provide either issueOptionId or categoryId, not both",
    );
  }
  if (!input.issueOptionId && !input.categoryId) {
    throw new AppError(
      400,
      "validation",
      "issueOptionId or categoryId is required",
    );
  }

  let title = input.title?.trim() ?? "";
  let priority = input.priority ?? Priority.normal;
  const blocksRoom = input.blocksRoom;
  let issueOptionId: string | null = null;
  let snapshot;

  if (input.issueOptionId) {
    const option = await getActiveIssueOption(input.issueOptionId);
    issueOptionId = option.id;
    snapshot = snapshotFromCategory(option.maintenanceCategory);
    if (!title) {
      title = option.nameBg;
    }
    if (input.priority === undefined && option.defaultPriority) {
      priority = option.defaultPriority;
    }
  } else {
    snapshot = await resolveCategorySnapshot(input.categoryId!, true);
  }

  if (!title) {
    throw new AppError(400, "validation", "title is required");
  }

  const sla = await resolveSlaForPriority(priority);
  let dueAt = input.dueAt ?? null;
  if (!dueAt) {
    dueAt = new Date(Date.now() + sla.hours * 60 * 60 * 1000);
  }

  const ticket = await prisma.$transaction(async (tx) => {
    const created = await tx.maintenanceTicket.create({
      data: {
        locationId: input.locationId,
        title,
        issueOptionId,
        maintenanceCategoryId: snapshot.maintenanceCategoryId,
        categoryKey: snapshot.categoryKey,
        categoryLabelBg: snapshot.categoryLabelBg,
        categoryLabelEn: snapshot.categoryLabelEn,
        priority,
        blocksRoom,
        status: TicketStatus.new,
        reportedByEmployeeId: input.reportedByEmployeeId,
        commandId: input.commandId,
        dueAt,
        slaPolicyId: sla.policyId,
        slaHoursSnapshot: sla.hours,
      },
      include: ticketInclude,
    });

    await writeTicketEvent(tx, {
      ticketId: created.id,
      locationId: created.locationId,
      fromStatus: null,
      toStatus: TicketStatus.new,
      actorEmployeeId: input.reportedByEmployeeId,
      payload: { priority, blocksRoom },
    });

    return created;
  });

  publishTicketChanged(ticket);
  {
    const opsRecipients = await recipientsForLocationOps(
      ticket.locationId,
      "tickets.assign",
    );
    const liveRecipients =
      priority === Priority.urgent || blocksRoom
        ? await recipientsForLocationOps(
            ticket.locationId,
            "operations.view_live",
          )
        : [];
    const recipients = [...new Set([...opsRecipients, ...liveRecipients])];
    const locNum = ticket.location?.number ?? "?";
    const urgency =
      priority === Priority.urgent || blocksRoom
        ? priority === Priority.urgent && blocksRoom
          ? "Urgent blocking ticket"
          : priority === Priority.urgent
            ? "Urgent ticket"
            : "Blocking ticket"
        : "New ticket";
    await notifyTicketEvent({
      type: "ticket.created",
      title: urgency,
      body: `${locNum}: ${ticket.title}`,
      ticket,
      actorEmployeeId: input.reportedByEmployeeId,
      recipientEmployeeIds: recipients,
      dedupeKey: `ticket.created:${ticket.id}`,
    });
  }
  return { ticket: formatMaintenanceTicket(ticket), idempotent: false };
}
