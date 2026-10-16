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
import { writeTicketEvent } from "./events";
import { formatMaintenanceTicket } from "./format";
import { notifyTicketEvent, publishTicketChanged } from "./notify";
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
 */
export async function createMaintenanceTicket(input: CreateMaintenanceTicketInput) {
  // Offline sync: same commandId → same ticket (no double-create).
  if (input.commandId) {
    // Await async query or service call.
    const existing = await prisma.maintenanceTicket.findUnique({
      where: { commandId: input.commandId },
      include: ticketInclude,
    });
    // Replay: prior successful create with this commandId.
    if (existing) {
      // Same offline commandId — return prior ticket without side effects.
      return { ticket: formatMaintenanceTicket(existing), idempotent: true };
    }
  }

  // Location must exist (archived rooms may still open tickets).
  const location = await prisma.location.findUnique({
    where: { id: input.locationId },
  });
  // Guard / branch on preconditions.
  if (!location) {
    // locationId must reference a catalog row (archived still allowed).
    throw new AppError(404, "not_found", "Room not found");
  }

  // Exactly one of issueOptionId / categoryId is required.
  if (input.issueOptionId && input.categoryId) {
    // Mutually exclusive catalog selectors.
    throw new AppError(
      400,
      "validation",
      "Provide either issueOptionId or categoryId, not both",
    );
  }
  // Guard / branch on preconditions.
  if (!input.issueOptionId && !input.categoryId) {
    // At least one catalog anchor is required.
    throw new AppError(
      400,
      "validation",
      "issueOptionId or categoryId is required",
    );
  }

  // Mutable defaults filled from issue option when present.
  let title = input.title?.trim() ?? "";
  // Local binding for this step.
  let priority = input.priority ?? Priority.normal;
  // Local binding for this step.
  const blocksRoom = input.blocksRoom;
  // Local binding for this step.
  let issueOptionId: string | null = null;
  // Category labels snapshotted onto the ticket row at create.
  let snapshot;

  // Prefer issue option preset (title/priority defaults) over bare category.
  if (input.issueOptionId) {
    // Await async query or service call.
    const option = await getActiveIssueOption(input.issueOptionId);
    issueOptionId = option.id;
    // Snapshot category labels from the option's linked category row.
    snapshot = snapshotFromCategory(option.maintenanceCategory);
    // Default title from the option's Bulgarian name when omitted.
    if (!title) {
      title = option.nameBg;
    }
    // Default priority from the option when the caller did not override.
    if (input.priority === undefined && option.defaultPriority) {
      priority = option.defaultPriority;
    }
  } else {
    // Bare category path — must resolve an active category snapshot.
    snapshot = await resolveCategorySnapshot(input.categoryId!, true);
  }

  // Title is required after option defaults are applied.
  if (!title) {
    // Option default may still leave title empty if nameBg missing.
    throw new AppError(400, "validation", "title is required");
  }

  // Snapshot SLA hours/policy onto the ticket at create time.
  const sla = await resolveSlaForPriority(priority);
  // Local binding for this step.
  let dueAt = input.dueAt ?? null;
  // Compute dueAt from SLA hours when the caller did not supply one.
  if (!dueAt) {
    // Relative deadline from create time + snapshotted SLA hours.
    dueAt = new Date(Date.now() + sla.hours * 60 * 60 * 1000);
  }

  // Ticket row + initial timeline event commit atomically.
  const ticket = await prisma.$transaction(async (tx) => {
    // Await async query or service call.
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

    // Initial timeline event (fromStatus null = created).
    await writeTicketEvent(tx, {
      ticketId: created.id,
      locationId: created.locationId,
      fromStatus: null,
      toStatus: TicketStatus.new,
      actorEmployeeId: input.reportedByEmployeeId,
      payload: { priority, blocksRoom },
    });

    // Return result to caller.
    return created;
  });

  // SSE / live board subscribers refresh open-ticket views.
  publishTicketChanged(ticket);
  {
    // Maintenance assignees for this location (permission tickets.assign).
    const opsRecipients = await recipientsForLocationOps(
      ticket.locationId,
      "tickets.assign",
    );
    // Urgent / room-blocking also alerts live-ops viewers for the location.
    const liveRecipients =
      priority === Priority.urgent || blocksRoom
        ? await recipientsForLocationOps(
            ticket.locationId,
            "operations.view_live",
          )
        : [];
    // Dedupe when an employee has both caps.
    const recipients = [...new Set([...opsRecipients, ...liveRecipients])];
    // Local binding for this step.
    const locNum = ticket.location?.number ?? "?";
    // Title reflects urgency so the inbox sorts visually.
    const urgency =
      priority === Priority.urgent || blocksRoom
        ? priority === Priority.urgent && blocksRoom
          ? "Urgent blocking ticket"
          : priority === Priority.urgent
            ? "Urgent ticket"
            : "Blocking ticket"
        : "New ticket";
    // In-app notification with dedupeKey so retries do not spam.
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
  // Fresh create (not a commandId replay).
  return { ticket: formatMaintenanceTicket(ticket), idempotent: false };
}
