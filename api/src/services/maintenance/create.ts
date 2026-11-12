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
  // Declare type CreateCommandKey for callers and internals.
  type CreateCommandKey,
} from "./commands";
import {
  detectDuplicates,
  duplicateLockKey,
  lockDuplicateIdentity,
  storedDuplicateIdentityKey,
  // Declare type ExistingTicketSummary for callers and internals.
  type ExistingTicketSummary,
} from "./duplicateDetection";
import { writeTicketEvent } from "./events";
import {
  formatMaintenanceTicket,
  // Declare type FormattedMaintenanceTicket for callers and internals.
  type FormattedMaintenanceTicket,
} from "./format";
import { notifyTicketEvent, publishTicketChanged } from "./notify";
import { isP2002 } from "./prismaConflicts";
import {
  ticketInclude,
  // Declare type CreateMaintenanceTicketInput for callers and internals.
  type CreateMaintenanceTicketInput,
  // Declare type TicketWithRelations for callers and internals.
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
      // Complete the ternary or optional chain started above.
      ? { suggestReopenTicketId }
      // Complete the ternary or optional chain started above.
      : {}),
  };
}

// Declare type PersistNewTicketArgs for callers and internals.
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

// Declare type PersistNewTicketResult for callers and internals.
type PersistNewTicketResult = {
  created: TicketWithRelations;
  suggestReopenId: string | null;
  idempotent: boolean;
};

// Declare type PersistOutcome for callers and internals.
type PersistOutcome =
  | PersistNewTicketResult
  | {
      kind: "replayed";
      value: { ticket: FormattedMaintenanceTicket; idempotent: true };
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
        // Load by command asynchronously for the next steps.
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

      // Load under lock asynchronously for the next steps.
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
            // Complete the ternary or optional chain started above.
            ? {
                reason: duplicateOverrideReason,
                existingTicketId: underLock.exactActive?.id ?? null,
              }
            // Complete the ternary or optional chain started above.
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
      // Load ops recipients asynchronously for the next steps.
      const opsRecipients = await recipientsForLocationOps(
        ticket.created.locationId,
        "tickets.assign",
      );
      // Capture live recipients for use in this scope.
      const liveRecipients =
        priority === Priority.urgent || blocksRoom
          // Complete the ternary or optional chain started above.
          ? await recipientsForLocationOps(
              ticket.created.locationId,
              "operations.view_live",
            )
          // Complete the ternary or optional chain started above.
          : [];
      // Collect recipients list for later processing.
      const recipients = [...new Set([...opsRecipients, ...liveRecipients])];
      // Capture loc num for use in this scope.
      const locNum = ticket.created.location?.number ?? "?";
      const urgency =
        priority === Priority.urgent || blocksRoom
          // Complete the ternary or optional chain started above.
          ? priority === Priority.urgent && blocksRoom
            // Complete the ternary or optional chain started above.
            ? "Urgent blocking ticket"
            // Complete the ternary or optional chain started above.
            : priority === Priority.urgent
              // Complete the ternary or optional chain started above.
              ? "Urgent ticket"
              // Complete the ternary or optional chain started above.
              : "Blocking ticket"
          // Complete the ternary or optional chain started above.
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
        // Complete the ternary or optional chain started above.
        ?.target;
      // Capture target list for use in this scope.
      const targetList = Array.isArray(targets)
        // Complete the ternary or optional chain started above.
        ? targets
        // Complete the ternary or optional chain started above.
        : typeof targets === "string"
          // Complete the ternary or optional chain started above.
          ? [targets]
          // Complete the ternary or optional chain started above.
          : [];
      // Capture is command id for use in this scope.
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
        // Abort with an error so callers can react.
        throw new AppError(
          409,
          "duplicate_active",
          existing.match?.reason ??
            "An active duplicate ticket already exists",
          duplicateDetails(existing.exactActive, existing.match!),
        );
      }
    }
    // Abort with an error so callers can react.
    throw err;
  }
}

/** Shape the create API response from a persisted (or idempotent) ticket. */
function buildCreateDto(result: PersistNewTicketResult) {
  const formatted = formatMaintenanceTicket(result.created);
  return {
    ticket: result.suggestReopenId
      // Complete the ternary or optional chain started above.
      ? { ...formatted, suggestReopenTicketId: result.suggestReopenId }
      // Complete the ternary or optional chain started above.
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
export async function createMaintenanceTicket(
  input: CreateMaintenanceTicketInput,
): Promise<{
  ticket: FormattedMaintenanceTicket & { suggestReopenTicketId?: string };
  idempotent: boolean;
}> {
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

  // Capture create key for use in this scope.
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

  // Capture identity key for use in this scope.
  const identityKey = duplicateLockKey({
    locationId: input.locationId,
    issueOptionId,
    categoryId: categoryId!,
    title,
  });

  // Capture dup identity stored for use in this scope.
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
    // Abort with an error so callers can react.
    throw new AppError(
      409,
      "duplicate_active",
      pre.match?.reason ?? "An active duplicate ticket already exists",
      duplicateDetails(pre.exactActive, pre.match!),
    );
  }

  if (pre.probableActive && !confirmSimilar && !allowDuplicate) {
    // Abort with an error so callers can react.
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
  // Capture due at for use in this scope.
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
