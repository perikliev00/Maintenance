/**
 * Open a new maintenance ticket: category snapshot, SLA dueAt, event, notifications.
 */
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
import {
  createPayloadFingerprint,
  replayCreateCommand,
  type CreateCommandKey,
} from "./commands";
import { writeTicketEvent } from "./events";
import { formatMaintenanceTicket } from "./format";
import { notifyTicketEvent, publishTicketChanged } from "./notify";
import { isP2002 } from "./prismaConflicts";
import { ticketInclude, type CreateMaintenanceTicketInput } from "./types";

/**
 * Creates a ticket (or returns the existing one for the same commandId).
 * Category labels are snapshotted at create so later catalog edits do not rewrite history.
 *
 * @param input.locationId - Room/common-area catalog id.
 * @param input.issueOptionId - Preset option (mutually exclusive with categoryId).
 * @param input.categoryId - Bare category when no issue option is selected.
 * @param input.commandId - Offline sync idempotency key (optional).
 * @param input.reportedByEmployeeId - Reporter stamped on the ticket row.
 * @param input.now - Optional clock for deterministic dueAt (tests).
 */
export async function createMaintenanceTicket(input: CreateMaintenanceTicketInput) {
  const now = input.now ?? new Date();

  // Exactly one of issueOptionId / categoryId is required (validated before replay
  // so contradictory payloads still 400 even when commandId is present).
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

  // Mutable defaults filled from issue option when present.
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

  const createKey: CreateCommandKey = {
    kind: "create",
    locationId: input.locationId,
    reportedByEmployeeId: input.reportedByEmployeeId,
    issueOptionId: input.issueOptionId ?? null,
    categoryId: input.categoryId ?? null,
    title,
    priority,
    blocksRoom,
  };

  // Offline sync: same commandId → same ticket (fingerprint must match).
  const replayed = await replayCreateCommand(input.commandId, createKey);
  if (replayed) return replayed;

  // Location must exist (archived rooms may still open tickets).
  const location = await prisma.location.findUnique({
    where: { id: input.locationId },
  });
  if (!location) {
    throw new AppError(404, "not_found", "Room not found");
  }

  const sla = await resolveSlaForPriority(priority);
  let dueAt = input.dueAt ?? null;
  if (!dueAt) {
    dueAt = new Date(now.getTime() + sla.hours * 60 * 60 * 1000);
  }

  try {
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

      // Initial timeline event carries commandId + create fingerprint for P1-45/46.
      await writeTicketEvent(tx, {
        ticketId: created.id,
        locationId: created.locationId,
        fromStatus: null,
        toStatus: TicketStatus.new,
        actorEmployeeId: input.reportedByEmployeeId,
        commandId: input.commandId,
        payload: {
          priority,
          blocksRoom,
          _commandFingerprint: createPayloadFingerprint(createKey),
        },
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
  } catch (err) {
    // Concurrent first-writes of the same commandId: treat as idempotent replay.
    if (input.commandId && isP2002(err)) {
      const again = await replayCreateCommand(input.commandId, createKey);
      if (again) return again;
    }
    throw err;
  }
}
