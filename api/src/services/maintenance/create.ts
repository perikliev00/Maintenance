/**
 * Open a new maintenance ticket: validation, duplicate prevention, category
 * snapshot, SLA dueAt, event, notifications.
 */
import { Priority, TicketStatus } from "@prisma/client";
// Import module ../../db for this service.
import { prisma } from "../../db";
// Import module ../../errors for this service.
import { AppError } from "../../errors";
// Import module ../audit for this service.
import { recordAudit } from "../audit";
// Import module ../notifications for this service.
import { recipientsForLocationOps } from "../notifications";
// Import module ../slaPolicies for this service.
import { resolveSlaForPriority } from "../slaPolicies";
// Import module dependency for this service.
import {
  // Run next step: createPayloadFingerprint,
  createPayloadFingerprint,
  // Run next step: replayCreateCommand,
  replayCreateCommand,
  // Declare type CreateCommandKey for callers and internals.
  type CreateCommandKey,
// Run next step: } from "./commands";
} from "./commands";
// Import module dependency for this service.
import {
  // Run next step: detectDuplicates,
  detectDuplicates,
  // Run next step: duplicateLockKey,
  duplicateLockKey,
  // Run next step: lockDuplicateIdentity,
  lockDuplicateIdentity,
  // Run next step: storedDuplicateIdentityKey,
  storedDuplicateIdentityKey,
  // Declare type ExistingTicketSummary for callers and internals.
  type ExistingTicketSummary,
// Run next step: } from "./duplicateDetection";
} from "./duplicateDetection";
// Import module ./events for this service.
import { writeTicketEvent } from "./events";
// Import module dependency for this service.
import {
  // Run next step: formatMaintenanceTicket,
  formatMaintenanceTicket,
  // Declare type FormattedMaintenanceTicket for callers and internals.
  type FormattedMaintenanceTicket,
// Run next step: } from "./format";
} from "./format";
// Import module ./notify for this service.
import { notifyTicketEvent, publishTicketChanged } from "./notify";
// Import module ./prismaConflicts for this service.
import { isP2002 } from "./prismaConflicts";
// Import module dependency for this service.
import {
  // Run next step: ticketInclude,
  ticketInclude,
  // Declare type CreateMaintenanceTicketInput for callers and internals.
  type CreateMaintenanceTicketInput,
  // Declare type TicketWithRelations for callers and internals.
  type TicketWithRelations,
// Run next step: } from "./types";
} from "./types";
// Import module ./validation/report for this service.
import { validateMaintenanceReport } from "./validation/report";

// Define duplicateDetails — core behavior for this module.
function duplicateDetails(
  // Set existing on the structure being built.
  existing: ExistingTicketSummary,
  // Set match on the structure being built.
  match: { kind: "exact" | "probable"; identityKey: string; reason: string },
  // Run next step: suggestReopenTicketId?: string | null,
  suggestReopenTicketId?: string | null,
// Run next step: ) {
) {
  // Return the computed result to the caller.
  return {
    // Set existingTicket on the structure being built.
    existingTicket: {
      // Set id on the structure being built.
      id: existing.id,
      // Set status on the structure being built.
      status: existing.status,
      // Set title on the structure being built.
      title: existing.title,
      // Set description on the structure being built.
      description: existing.description,
      // Set locationId on the structure being built.
      locationId: existing.locationId,
      // Set priority on the structure being built.
      priority: existing.priority,
      // Set blocksRoom on the structure being built.
      blocksRoom: existing.blocksRoom,
      // Set assigneeId on the structure being built.
      assigneeId: existing.assigneeId,
      // Set reportedByEmployeeId on the structure being built.
      reportedByEmployeeId: existing.reportedByEmployeeId,
      // Set openedAt on the structure being built.
      openedAt: existing.openedAt.toISOString(),
    },
    // Run next step: match,
    match,
    // Run next step: ...(suggestReopenTicketId
    ...(suggestReopenTicketId
      // Complete the ternary or optional chain started above.
      ? { suggestReopenTicketId }
      // Complete the ternary or optional chain started above.
      : {}),
  };
}

// Declare type PersistNewTicketArgs for callers and internals.
type PersistNewTicketArgs = {
  // Set input on the structure being built.
  input: CreateMaintenanceTicketInput;
  // Set createKey on the structure being built.
  createKey: CreateCommandKey;
  // Set identityKey on the structure being built.
  identityKey: string;
  // Set dupIdentityStored on the structure being built.
  dupIdentityStored: string | null;
  // Set title on the structure being built.
  title: string;
  // Set description on the structure being built.
  description: string | null;
  // Set priority on the structure being built.
  priority: Priority;
  // Set blocksRoom on the structure being built.
  blocksRoom: boolean;
  // Set issueOptionId on the structure being built.
  issueOptionId: string | null;
  // Set categoryId on the structure being built.
  categoryId: string;
  // Set snapshot on the structure being built.
  snapshot: {
    // Set maintenanceCategoryId on the structure being built.
    maintenanceCategoryId: string;
    // Set categoryKey on the structure being built.
    categoryKey: string;
    // Set categoryLabelBg on the structure being built.
    categoryLabelBg: string;
    // Set categoryLabelEn on the structure being built.
    categoryLabelEn: string;
  };
  // Set allowDuplicate on the structure being built.
  allowDuplicate: boolean;
  // Set duplicateOverrideReason on the structure being built.
  duplicateOverrideReason: string | null | undefined;
  // Set confirmSimilar on the structure being built.
  confirmSimilar: boolean;
  // Set dueAt on the structure being built.
  dueAt: Date;
  // Set sla on the structure being built.
  sla: { policyId: string | null; hours: number };
};

// Declare type PersistNewTicketResult for callers and internals.
type PersistNewTicketResult = {
  // Set created on the structure being built.
  created: TicketWithRelations;
  // Set suggestReopenId on the structure being built.
  suggestReopenId: string | null;
  // Set idempotent on the structure being built.
  idempotent: boolean;
};

// Declare type PersistOutcome for callers and internals.
type PersistOutcome =
  // Run next step: | PersistNewTicketResult
  | PersistNewTicketResult
  // Run next step: | {
  | {
      // Set kind on the structure being built.
      kind: "replayed";
      // Set value on the structure being built.
      value: { ticket: FormattedMaintenanceTicket; idempotent: true };
    };

/** Transactional create + side effects (events, audit, notify, publish). */
async function persistNewTicket(
  // Set args on the structure being built.
  args: PersistNewTicketArgs,
// Run next step: ): Promise<PersistOutcome> {
): Promise<PersistOutcome> {
  // Destructure value fields needed locally.
  const {
    // Run next step: input,
    input,
    // Run next step: createKey,
    createKey,
    // Run next step: identityKey,
    identityKey,
    // Run next step: dupIdentityStored,
    dupIdentityStored,
    // Run next step: title,
    title,
    // Run next step: description,
    description,
    // Run next step: priority,
    priority,
    // Run next step: blocksRoom,
    blocksRoom,
    // Run next step: issueOptionId,
    issueOptionId,
    // Run next step: categoryId,
    categoryId,
    // Run next step: snapshot,
    snapshot,
    // Run next step: allowDuplicate,
    allowDuplicate,
    // Run next step: duplicateOverrideReason,
    duplicateOverrideReason,
    // Run next step: confirmSimilar,
    confirmSimilar,
    // Run next step: dueAt,
    dueAt,
    // Run next step: sla,
    sla,
  // Run next step: } = args;
  } = args;

  // Attempt the fallible work so errors can be handled below.
  try {
    // Load ticket asynchronously for the next steps.
    const ticket = await prisma.$transaction(async (tx) => {
      // Wait for the async step before continuing.
      await lockDuplicateIdentity(tx, identityKey);

      // Peer may have committed the same commandId while we waited for the lock.
      if (input.commandId) {
        // Load by command asynchronously for the next steps.
        const byCommand = await tx.maintenanceTicket.findUnique({
          // Set where on the structure being built.
          where: { commandId: input.commandId },
          // Set include on the structure being built.
          include: ticketInclude,
        });
        // Branch when this condition holds so the right path runs.
        if (byCommand) {
          // Return the computed result to the caller.
          return {
            // Set created on the structure being built.
            created: byCommand,
            // Set suggestReopenId on the structure being built.
            suggestReopenId: null,
            // Set idempotent on the structure being built.
            idempotent: true as const,
          };
        }
      }

      // Load under lock asynchronously for the next steps.
      const underLock = await detectDuplicates(
        // Run next step: {
        {
          // Set locationId on the structure being built.
          locationId: input.locationId,
          // Run next step: issueOptionId,
          issueOptionId,
          // Run next step: categoryId,
          categoryId,
          // Run next step: title,
          title,
          // Run next step: description,
          description,
        },
        // Run next step: tx,
        tx,
      );

      // Branch when this condition holds so the right path runs.
      if (underLock.exactActive && !allowDuplicate) {
        // Abort with an error so callers can react.
        throw new AppError(
          // Run next step: 409,
          409,
          // Run next step: "duplicate_active",
          "duplicate_active",
          // Run next step: underLock.match?.reason ??
          underLock.match?.reason ??
            // Run next step: "An active duplicate ticket already exists",
            "An active duplicate ticket already exists",
          // Run next step: duplicateDetails(underLock.exactActive, underLock.match!),
          duplicateDetails(underLock.exactActive, underLock.match!),
        );
      }

      // Branch when this condition holds so the right path runs.
      if (
        // Run next step: underLock.probableActive &&
        underLock.probableActive &&
        // Run next step: !confirmSimilar &&
        !confirmSimilar &&
        // Run next step: !allowDuplicate
        !allowDuplicate
      // Run next step: ) {
      ) {
        // Abort with an error so callers can react.
        throw new AppError(
          // Run next step: 409,
          409,
          // Run next step: "probable_duplicate",
          "probable_duplicate",
          // Run next step: underLock.match?.reason ??
          underLock.match?.reason ??
            // Run next step: "A related open ticket exists; confirm to create anyway",
            "A related open ticket exists; confirm to create anyway",
          // Run next step: duplicateDetails(
          duplicateDetails(
            // Run next step: underLock.probableActive,
            underLock.probableActive,
            // Run next step: underLock.match!,
            underLock.match!,
            // Run next step: underLock.suggestReopen?.id,
            underLock.suggestReopen?.id,
          ),
        );
      }

      // Load created asynchronously for the next steps.
      const created = await tx.maintenanceTicket.create({
        // Set data on the structure being built.
        data: {
          // Set locationId on the structure being built.
          locationId: input.locationId,
          // Run next step: title,
          title,
          // Run next step: description,
          description,
          // Run next step: issueOptionId,
          issueOptionId,
          // Set maintenanceCategoryId on the structure being built.
          maintenanceCategoryId: snapshot.maintenanceCategoryId,
          // Set categoryKey on the structure being built.
          categoryKey: snapshot.categoryKey,
          // Set categoryLabelBg on the structure being built.
          categoryLabelBg: snapshot.categoryLabelBg,
          // Set categoryLabelEn on the structure being built.
          categoryLabelEn: snapshot.categoryLabelEn,
          // Run next step: priority,
          priority,
          // Run next step: blocksRoom,
          blocksRoom,
          // Set status on the structure being built.
          status: TicketStatus.new,
          // Set reportedByEmployeeId on the structure being built.
          reportedByEmployeeId: input.reportedByEmployeeId,
          // Set commandId on the structure being built.
          commandId: input.commandId,
          // Set duplicateIdentityKey on the structure being built.
          duplicateIdentityKey: dupIdentityStored,
          // Run next step: dueAt,
          dueAt,
          // Set slaPolicyId on the structure being built.
          slaPolicyId: sla.policyId,
          // Set slaHoursSnapshot on the structure being built.
          slaHoursSnapshot: sla.hours,
        },
        // Set include on the structure being built.
        include: ticketInclude,
      });

      // Wait for the async step before continuing.
      await writeTicketEvent(tx, {
        // Set ticketId on the structure being built.
        ticketId: created.id,
        // Set locationId on the structure being built.
        locationId: created.locationId,
        // Set fromStatus on the structure being built.
        fromStatus: null,
        // Set toStatus on the structure being built.
        toStatus: TicketStatus.new,
        // Set actorEmployeeId on the structure being built.
        actorEmployeeId: input.reportedByEmployeeId,
        // Set commandId on the structure being built.
        commandId: input.commandId,
        // Set payload on the structure being built.
        payload: {
          // Run next step: priority,
          priority,
          // Run next step: blocksRoom,
          blocksRoom,
          // Run next step: description,
          description,
          // Set duplicateOverride on the structure being built.
          duplicateOverride: allowDuplicate
            // Complete the ternary or optional chain started above.
            ? {
                // Set reason on the structure being built.
                reason: duplicateOverrideReason,
                // Set existingTicketId on the structure being built.
                existingTicketId: underLock.exactActive?.id ?? null,
              }
            // Complete the ternary or optional chain started above.
            : null,
          // Set confirmSimilar on the structure being built.
          confirmSimilar: confirmSimilar || null,
          // Set suggestReopenTicketId on the structure being built.
          suggestReopenTicketId: underLock.suggestReopen?.id ?? null,
          // Set _commandFingerprint on the structure being built.
          _commandFingerprint: createPayloadFingerprint(createKey),
        },
      });

      // Branch when this condition holds so the right path runs.
      if (allowDuplicate) {
        // Wait for the async step before continuing.
        await recordAudit(
          // Run next step: {
          {
            // Set actorEmployeeId on the structure being built.
            actorEmployeeId: input.reportedByEmployeeId,
            // Set action on the structure being built.
            action: "ticket.duplicate_override",
            // Set entityType on the structure being built.
            entityType: "ticket",
            // Set entityId on the structure being built.
            entityId: created.id,
            // Set locationId on the structure being built.
            locationId: created.locationId,
            // Set reason on the structure being built.
            reason: duplicateOverrideReason,
            // Set after on the structure being built.
            after: {
              // Set existingTicketId on the structure being built.
              existingTicketId:
                // Run next step: underLock.exactActive?.id ?? underLock.probableActive?.id ??…
                underLock.exactActive?.id ?? underLock.probableActive?.id ?? null,
              // Run next step: identityKey,
              identityKey,
            },
            // Set summary on the structure being built.
            summary: `Duplicate override: ${duplicateOverrideReason}`,
          },
          // Run next step: tx,
          tx,
        );
      }

      // Return the computed result to the caller.
      return {
        // Run next step: created,
        created,
        // Set suggestReopenId on the structure being built.
        suggestReopenId: underLock.suggestReopen?.id ?? null,
        // Set idempotent on the structure being built.
        idempotent: false as const,
      };
    });

    // Branch when this condition holds so the right path runs.
    if (!ticket.idempotent) {
      // Run next step: publishTicketChanged(ticket.created);
      publishTicketChanged(ticket.created);
      // Load ops recipients asynchronously for the next steps.
      const opsRecipients = await recipientsForLocationOps(
        // Run next step: ticket.created.locationId,
        ticket.created.locationId,
        // Run next step: "tickets.assign",
        "tickets.assign",
      );
      // Capture live recipients for use in this scope.
      const liveRecipients =
        // Update priority as control flow progresses.
        priority === Priority.urgent || blocksRoom
          // Complete the ternary or optional chain started above.
          ? await recipientsForLocationOps(
              // Run next step: ticket.created.locationId,
              ticket.created.locationId,
              // Run next step: "operations.view_live",
              "operations.view_live",
            )
          // Complete the ternary or optional chain started above.
          : [];
      // Collect recipients list for later processing.
      const recipients = [...new Set([...opsRecipients, ...liveRecipients])];
      // Capture loc num for use in this scope.
      const locNum = ticket.created.location?.number ?? "?";
      // Capture urgency for use in this scope.
      const urgency =
        // Update priority as control flow progresses.
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
      // Wait for the async step before continuing.
      await notifyTicketEvent({
        // Set type on the structure being built.
        type: "ticket.created",
        // Set title on the structure being built.
        title: urgency,
        // Set body on the structure being built.
        body: `${locNum}: ${ticket.created.title}`,
        // Set ticket on the structure being built.
        ticket: ticket.created,
        // Set actorEmployeeId on the structure being built.
        actorEmployeeId: input.reportedByEmployeeId,
        // Set recipientEmployeeIds on the structure being built.
        recipientEmployeeIds: recipients,
        // Set dedupeKey on the structure being built.
        dedupeKey: `ticket.created:${ticket.created.id}`,
      });
    }

    // Return the computed result to the caller.
    return ticket;
  // Run next step: } catch (err) {
  } catch (err) {
    // Branch when this condition holds so the right path runs.
    if (err instanceof AppError) throw err;

    // Concurrent first-writes of the same commandId: treat as idempotent replay.
    if (input.commandId && isP2002(err)) {
      // Define targets as a callable used by this flow.
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
        // Run next step: targetList.includes("commandId") ||
        targetList.includes("commandId") ||
        // Run next step: targetList.some((t) => String(t).includes("commandId"));
        targetList.some((t) => String(t).includes("commandId"));

      // Branch when this condition holds so the right path runs.
      if (isCommandId) {
        // Load again asynchronously for the next steps.
        const again = await replayCreateCommand(input.commandId, createKey);
        // Branch when this condition holds so the right path runs.
        if (again) return { kind: "replayed" as const, value: again };
      }

      // Partial unique active-option index — concurrent exact duplicate.
      const existing = await detectDuplicates({
        // Set locationId on the structure being built.
        locationId: input.locationId,
        // Run next step: issueOptionId,
        issueOptionId,
        // Run next step: categoryId,
        categoryId,
        // Run next step: title,
        title,
        // Run next step: description,
        description,
      });
      // Branch when this condition holds so the right path runs.
      if (existing.exactActive) {
        // Abort with an error so callers can react.
        throw new AppError(
          // Run next step: 409,
          409,
          // Run next step: "duplicate_active",
          "duplicate_active",
          // Run next step: existing.match?.reason ??
          existing.match?.reason ??
            // Run next step: "An active duplicate ticket already exists",
            "An active duplicate ticket already exists",
          // Run next step: duplicateDetails(existing.exactActive, existing.match!),
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
  // Capture formatted for use in this scope.
  const formatted = formatMaintenanceTicket(result.created);
  // Return the computed result to the caller.
  return {
    // Set ticket on the structure being built.
    ticket: result.suggestReopenId
      // Complete the ternary or optional chain started above.
      ? { ...formatted, suggestReopenTicketId: result.suggestReopenId }
      // Complete the ternary or optional chain started above.
      : formatted,
    // Set idempotent on the structure being built.
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
  // Set input on the structure being built.
  input: CreateMaintenanceTicketInput,
// Run next step: ): Promise<{
): Promise<{
  // Set ticket on the structure being built.
  ticket: FormattedMaintenanceTicket & { suggestReopenTicketId?: string };
  // Set idempotent on the structure being built.
  idempotent: boolean;
// Run next step: }> {
}> {
  // Capture now for use in this scope.
  const now = input.now ?? new Date();

  // Load validated asynchronously for the next steps.
  const validated = await validateMaintenanceReport({
    // Set locationId on the structure being built.
    locationId: input.locationId,
    // Set title on the structure being built.
    title: input.title,
    // Set description on the structure being built.
    description: input.description,
    // Set issueOptionId on the structure being built.
    issueOptionId: input.issueOptionId,
    // Set categoryId on the structure being built.
    categoryId: input.categoryId,
    // Set priority on the structure being built.
    priority: input.priority,
    // Set blocksRoom on the structure being built.
    blocksRoom: input.blocksRoom,
    // Set allowDuplicate on the structure being built.
    allowDuplicate: input.allowDuplicate,
    // Set duplicateOverrideReason on the structure being built.
    duplicateOverrideReason: input.duplicateOverrideReason,
    // Set confirmSimilar on the structure being built.
    confirmSimilar: input.confirmSimilar,
  });

  // Destructure value fields needed locally.
  const {
    // Run next step: title,
    title,
    // Run next step: description,
    description,
    // Run next step: priority,
    priority,
    // Run next step: blocksRoom,
    blocksRoom,
    // Run next step: issueOptionId,
    issueOptionId,
    // Run next step: categoryId,
    categoryId,
    // Run next step: snapshot,
    snapshot,
    // Run next step: allowDuplicate,
    allowDuplicate,
    // Run next step: duplicateOverrideReason,
    duplicateOverrideReason,
    // Run next step: confirmSimilar,
    confirmSimilar,
  // Run next step: } = validated;
  } = validated;

  // For fingerprint / duplicate identity, categoryId is the catalog category id.
  const createCategoryId = input.categoryId ?? null;

  // Capture create key for use in this scope.
  const createKey: CreateCommandKey = {
    // Set kind on the structure being built.
    kind: "create",
    // Set locationId on the structure being built.
    locationId: input.locationId,
    // Set reportedByEmployeeId on the structure being built.
    reportedByEmployeeId: input.reportedByEmployeeId,
    // Set issueOptionId on the structure being built.
    issueOptionId: input.issueOptionId ?? null,
    // Set categoryId on the structure being built.
    categoryId: createCategoryId,
    // Run next step: title,
    title,
    // Run next step: description,
    description,
    // Run next step: priority,
    priority,
    // Run next step: blocksRoom,
    blocksRoom,
  };

  // Offline sync: same commandId → same ticket (fingerprint must match).
  const replayed = await replayCreateCommand(input.commandId, createKey);
  // Branch when this condition holds so the right path runs.
  if (replayed) return replayed;

  // Capture identity key for use in this scope.
  const identityKey = duplicateLockKey({
    // Set locationId on the structure being built.
    locationId: input.locationId,
    // Run next step: issueOptionId,
    issueOptionId,
    // Set categoryId on the structure being built.
    categoryId: categoryId!,
    // Run next step: title,
    title,
  });

  // Capture dup identity stored for use in this scope.
  const dupIdentityStored = storedDuplicateIdentityKey({
    // Run next step: issueOptionId,
    issueOptionId,
    // Set categoryId on the structure being built.
    categoryId: categoryId!,
    // Run next step: title,
    title,
  });

  // Pre-check outside the lock for fast rejection (rechecked under lock).
  const pre = await detectDuplicates({
    // Set locationId on the structure being built.
    locationId: input.locationId,
    // Run next step: issueOptionId,
    issueOptionId,
    // Set categoryId on the structure being built.
    categoryId: categoryId!,
    // Run next step: title,
    title,
    // Run next step: description,
    description,
  });

  // Branch when this condition holds so the right path runs.
  if (pre.exactActive && !allowDuplicate) {
    // Abort with an error so callers can react.
    throw new AppError(
      // Run next step: 409,
      409,
      // Run next step: "duplicate_active",
      "duplicate_active",
      // Run next step: pre.match?.reason ?? "An active duplicate ticket already exi…
      pre.match?.reason ?? "An active duplicate ticket already exists",
      // Run next step: duplicateDetails(pre.exactActive, pre.match!),
      duplicateDetails(pre.exactActive, pre.match!),
    );
  }

  // Branch when this condition holds so the right path runs.
  if (pre.probableActive && !confirmSimilar && !allowDuplicate) {
    // Abort with an error so callers can react.
    throw new AppError(
      // Run next step: 409,
      409,
      // Run next step: "probable_duplicate",
      "probable_duplicate",
      // Run next step: pre.match?.reason ??
      pre.match?.reason ??
        // Run next step: "A related open ticket exists; confirm to create anyway",
        "A related open ticket exists; confirm to create anyway",
      // Run next step: duplicateDetails(
      duplicateDetails(
        // Run next step: pre.probableActive,
        pre.probableActive,
        // Run next step: pre.match!,
        pre.match!,
        // Run next step: pre.suggestReopen?.id,
        pre.suggestReopen?.id,
      ),
    );
  }

  // Load sla asynchronously for the next steps.
  const sla = await resolveSlaForPriority(priority);
  // Capture due at for use in this scope.
  const dueAt =
    // Run next step: input.dueAt ?? new Date(now.getTime() + sla.hours * 60 * 60 …
    input.dueAt ?? new Date(now.getTime() + sla.hours * 60 * 60 * 1000);

  // Load persisted asynchronously for the next steps.
  const persisted = await persistNewTicket({
    // Run next step: input,
    input,
    // Run next step: createKey,
    createKey,
    // Run next step: identityKey,
    identityKey,
    // Run next step: dupIdentityStored,
    dupIdentityStored,
    // Run next step: title,
    title,
    // Run next step: description,
    description,
    // Run next step: priority,
    priority,
    // Run next step: blocksRoom,
    blocksRoom,
    // Run next step: issueOptionId,
    issueOptionId,
    // Set categoryId on the structure being built.
    categoryId: categoryId!,
    // Run next step: snapshot,
    snapshot,
    // Run next step: allowDuplicate,
    allowDuplicate,
    // Run next step: duplicateOverrideReason,
    duplicateOverrideReason,
    // Run next step: confirmSimilar,
    confirmSimilar,
    // Run next step: dueAt,
    dueAt,
    // Run next step: sla,
    sla,
  });

  // Branch when this condition holds so the right path runs.
  if ("kind" in persisted) {
    // Return the computed result to the caller.
    return persisted.value;
  }
  // Return the computed result to the caller.
  return buildCreateDto(persisted);
}
