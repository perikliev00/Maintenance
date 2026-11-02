/**
 * Open a new maintenance ticket: validation, duplicate prevention, category
 * snapshot, SLA dueAt, event, notifications.
 */
import { Priority, TicketStatus } from "@prisma/client";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { recordAudit } from "../audit";
import { recipientsForLocationOps } from "../notifications";
import { resolveSlaForPriority } from "../slaPolicies";
import {
  createPayloadFingerprint,
  replayCreateCommand,
  type CreateCommandKey,
} from "./commands";
import {
  detectDuplicates,
  duplicateLockKey,
  lockDuplicateIdentity,
  storedDuplicateIdentityKey,
  type ExistingTicketSummary,
} from "./duplicateDetection";
import { writeTicketEvent } from "./events";
import { formatMaintenanceTicket } from "./format";
import { notifyTicketEvent, publishTicketChanged } from "./notify";
import { isP2002 } from "./prismaConflicts";
import {
  ticketInclude,
  type CreateMaintenanceTicketInput,
  type TicketWithRelations,
} from "./types";
import { validateMaintenanceReport } from "./validation/report";

function duplicateDetails(
  existing: ExistingTicketSummary,
  match: { kind: "exact" | "probable"; identityKey: string; reason: string },
  suggestReopenTicketId?: string | null,
) {
  return {
    existingTicket: {
      id: existing.id,
      status: existing.status,
      title: existing.title,
      description: existing.description,
      locationId: existing.locationId,
      priority: existing.priority,
      blocksRoom: existing.blocksRoom,
      assigneeId: existing.assigneeId,
      reportedByEmployeeId: existing.reportedByEmployeeId,
      openedAt: existing.openedAt.toISOString(),
    },
    match,
    ...(suggestReopenTicketId
      ? { suggestReopenTicketId }
      : {}),
  };
}

type PersistNewTicketArgs = {
  input: CreateMaintenanceTicketInput;
  createKey: CreateCommandKey;
  identityKey: string;
  dupIdentityStored: string | null;
  title: string;
  description: string | null;
  priority: Priority;
  blocksRoom: boolean;
  issueOptionId: string | null;
  categoryId: string;
  snapshot: {
    maintenanceCategoryId: string;
    categoryKey: string;
    categoryLabelBg: string;
    categoryLabelEn: string;
  };
  allowDuplicate: boolean;
  duplicateOverrideReason: string | null | undefined;
  confirmSimilar: boolean;
  dueAt: Date;
  sla: { policyId: string | null; hours: number };
};

type PersistNewTicketResult = {
  created: TicketWithRelations;
  suggestReopenId: string | null;
  idempotent: boolean;
};

type PersistOutcome =
  | PersistNewTicketResult
  | {
      kind: "replayed";
      value: { ticket: ReturnType<typeof formatMaintenanceTicket>; idempotent: true };
    };

/** Transactional create + side effects (events, audit, notify, publish). */
async function persistNewTicket(
  args: PersistNewTicketArgs,
): Promise<PersistOutcome> {
  const {
    input,
    createKey,
    identityKey,
    dupIdentityStored,
    title,
    description,
    priority,
    blocksRoom,
    issueOptionId,
    categoryId,
    snapshot,
    allowDuplicate,
    duplicateOverrideReason,
    confirmSimilar,
    dueAt,
    sla,
  } = args;

  try {
    const ticket = await prisma.$transaction(async (tx) => {
      await lockDuplicateIdentity(tx, identityKey);

      // Peer may have committed the same commandId while we waited for the lock.
      if (input.commandId) {
        const byCommand = await tx.maintenanceTicket.findUnique({
          where: { commandId: input.commandId },
          include: ticketInclude,
        });
        if (byCommand) {
          return {
            created: byCommand,
            suggestReopenId: null,
            idempotent: true as const,
          };
        }
      }

      const underLock = await detectDuplicates(
        {
          locationId: input.locationId,
          issueOptionId,
          categoryId,
          title,
          description,
        },
        tx,
      );

      if (underLock.exactActive && !allowDuplicate) {
        throw new AppError(
          409,
          "duplicate_active",
          underLock.match?.reason ??
            "An active duplicate ticket already exists",
          duplicateDetails(underLock.exactActive, underLock.match!),
        );
      }

      if (
        underLock.probableActive &&
        !confirmSimilar &&
        !allowDuplicate
      ) {
        throw new AppError(
          409,
          "probable_duplicate",
          underLock.match?.reason ??
            "A related open ticket exists; confirm to create anyway",
          duplicateDetails(
            underLock.probableActive,
            underLock.match!,
            underLock.suggestReopen?.id,
          ),
        );
      }

      const created = await tx.maintenanceTicket.create({
        data: {
          locationId: input.locationId,
          title,
          description,
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
          duplicateIdentityKey: dupIdentityStored,
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
        commandId: input.commandId,
        payload: {
          priority,
          blocksRoom,
          description,
          duplicateOverride: allowDuplicate
            ? {
                reason: duplicateOverrideReason,
                existingTicketId: underLock.exactActive?.id ?? null,
              }
            : null,
          confirmSimilar: confirmSimilar || null,
          suggestReopenTicketId: underLock.suggestReopen?.id ?? null,
          _commandFingerprint: createPayloadFingerprint(createKey),
        },
      });

      if (allowDuplicate) {
        await recordAudit(
          {
            actorEmployeeId: input.reportedByEmployeeId,
            action: "ticket.duplicate_override",
            entityType: "ticket",
            entityId: created.id,
            locationId: created.locationId,
            reason: duplicateOverrideReason,
            after: {
              existingTicketId:
                underLock.exactActive?.id ?? underLock.probableActive?.id ?? null,
              identityKey,
            },
            summary: `Duplicate override: ${duplicateOverrideReason}`,
          },
          tx,
        );
      }

      return {
        created,
        suggestReopenId: underLock.suggestReopen?.id ?? null,
        idempotent: false as const,
      };
    });

    if (!ticket.idempotent) {
      publishTicketChanged(ticket.created);
      const opsRecipients = await recipientsForLocationOps(
        ticket.created.locationId,
        "tickets.assign",
      );
      const liveRecipients =
        priority === Priority.urgent || blocksRoom
          ? await recipientsForLocationOps(
              ticket.created.locationId,
              "operations.view_live",
            )
          : [];
      const recipients = [...new Set([...opsRecipients, ...liveRecipients])];
      const locNum = ticket.created.location?.number ?? "?";
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
        body: `${locNum}: ${ticket.created.title}`,
        ticket: ticket.created,
        actorEmployeeId: input.reportedByEmployeeId,
        recipientEmployeeIds: recipients,
        dedupeKey: `ticket.created:${ticket.created.id}`,
      });
    }

    return ticket;
  } catch (err) {
    if (err instanceof AppError) throw err;

    // Concurrent first-writes of the same commandId: treat as idempotent replay.
    if (input.commandId && isP2002(err)) {
      const targets = (err as { meta?: { target?: string | string[] } }).meta
        ?.target;
      const targetList = Array.isArray(targets)
        ? targets
        : typeof targets === "string"
          ? [targets]
          : [];
      const isCommandId =
        targetList.includes("commandId") ||
        targetList.some((t) => String(t).includes("commandId"));

      if (isCommandId) {
        const again = await replayCreateCommand(input.commandId, createKey);
        if (again) return { kind: "replayed" as const, value: again };
      }

      // Partial unique active-option index — concurrent exact duplicate.
      const existing = await detectDuplicates({
        locationId: input.locationId,
        issueOptionId,
        categoryId,
        title,
        description,
      });
      if (existing.exactActive) {
        throw new AppError(
          409,
          "duplicate_active",
          existing.match?.reason ??
            "An active duplicate ticket already exists",
          duplicateDetails(existing.exactActive, existing.match!),
        );
      }
    }
    throw err;
  }
}

/** Shape the create API response from a persisted (or idempotent) ticket. */
function buildCreateDto(result: PersistNewTicketResult) {
  const formatted = formatMaintenanceTicket(result.created);
  return {
    ticket: result.suggestReopenId
      ? { ...formatted, suggestReopenTicketId: result.suggestReopenId }
      : formatted,
    idempotent: result.idempotent,
  };
}

/**
 * Creates a ticket (or returns the existing one for the same commandId).
 * Category labels are snapshotted at create so later catalog edits do not rewrite history.
 *
 * Exact active duplicates are rejected unless `allowDuplicate` + reason.
 * Probable (similar) duplicates require `confirmSimilar`.
 */
export async function createMaintenanceTicket(input: CreateMaintenanceTicketInput) {
  const now = input.now ?? new Date();

  const validated = await validateMaintenanceReport({
    locationId: input.locationId,
    title: input.title,
    description: input.description,
    issueOptionId: input.issueOptionId,
    categoryId: input.categoryId,
    priority: input.priority,
    blocksRoom: input.blocksRoom,
    allowDuplicate: input.allowDuplicate,
    duplicateOverrideReason: input.duplicateOverrideReason,
    confirmSimilar: input.confirmSimilar,
  });

  const {
    title,
    description,
    priority,
    blocksRoom,
    issueOptionId,
    categoryId,
    snapshot,
    allowDuplicate,
    duplicateOverrideReason,
    confirmSimilar,
  } = validated;

  // For fingerprint / duplicate identity, categoryId is the catalog category id.
  const createCategoryId = input.categoryId ?? null;

  const createKey: CreateCommandKey = {
    kind: "create",
    locationId: input.locationId,
    reportedByEmployeeId: input.reportedByEmployeeId,
    issueOptionId: input.issueOptionId ?? null,
    categoryId: createCategoryId,
    title,
    description,
    priority,
    blocksRoom,
  };

  // Offline sync: same commandId → same ticket (fingerprint must match).
  const replayed = await replayCreateCommand(input.commandId, createKey);
  if (replayed) return replayed;

  const identityKey = duplicateLockKey({
    locationId: input.locationId,
    issueOptionId,
    categoryId: categoryId!,
    title,
  });

  const dupIdentityStored = storedDuplicateIdentityKey({
    issueOptionId,
    categoryId: categoryId!,
    title,
  });

  // Pre-check outside the lock for fast rejection (rechecked under lock).
  const pre = await detectDuplicates({
    locationId: input.locationId,
    issueOptionId,
    categoryId: categoryId!,
    title,
    description,
  });

  if (pre.exactActive && !allowDuplicate) {
    throw new AppError(
      409,
      "duplicate_active",
      pre.match?.reason ?? "An active duplicate ticket already exists",
      duplicateDetails(pre.exactActive, pre.match!),
    );
  }

  if (pre.probableActive && !confirmSimilar && !allowDuplicate) {
    throw new AppError(
      409,
      "probable_duplicate",
      pre.match?.reason ??
        "A related open ticket exists; confirm to create anyway",
      duplicateDetails(
        pre.probableActive,
        pre.match!,
        pre.suggestReopen?.id,
      ),
    );
  }

  const sla = await resolveSlaForPriority(priority);
  const dueAt =
    input.dueAt ?? new Date(now.getTime() + sla.hours * 60 * 60 * 1000);

  const persisted = await persistNewTicket({
    input,
    createKey,
    identityKey,
    dupIdentityStored,
    title,
    description,
    priority,
    blocksRoom,
    issueOptionId,
    categoryId: categoryId!,
    snapshot,
    allowDuplicate,
    duplicateOverrideReason,
    confirmSimilar,
    dueAt,
    sla,
  });

  if ("kind" in persisted) {
    return persisted.value;
  }
  return buildCreateDto(persisted);
}
