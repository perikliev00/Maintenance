/**
 * Exact and probable duplicate detection for maintenance reports.
 */
import { TicketStatus, type Priority } from "@prisma/client";
// Import module ../../../constants for this service.
import { OPEN_TICKET_STATUSES } from "../../../constants";
// Import module ../../../db for this service.
import { prisma } from "../../../db";
// Import type(s) Tx for typing without runtime cost.
import type { Tx } from "../types";
// Import module dependency for this service.
import {
  // Run next step: customDuplicateIdentityKey,
  customDuplicateIdentityKey,
// Run next step: } from "./identity";
} from "./identity";
// Import module ./synonyms for this service.
import { labelsAreSimilar, synonymGroupForLabel } from "./synonyms";

// Declare type ExistingTicketSummary for callers and internals.
export type ExistingTicketSummary = {
  // Set id on the structure being built.
  id: string;
  // Set status on the structure being built.
  status: TicketStatus;
  // Set title on the structure being built.
  title: string;
  // Set description on the structure being built.
  description: string | null;
  // Set locationId on the structure being built.
  locationId: string;
  // Set priority on the structure being built.
  priority: Priority;
  // Set blocksRoom on the structure being built.
  blocksRoom: boolean;
  // Set issueOptionId on the structure being built.
  issueOptionId: string | null;
  // Set assigneeId on the structure being built.
  assigneeId: string | null;
  // Set reportedByEmployeeId on the structure being built.
  reportedByEmployeeId: string;
  // Set openedAt on the structure being built.
  openedAt: Date;
};

// Declare type DuplicateMatch for callers and internals.
export type DuplicateMatch = {
  // Set kind on the structure being built.
  kind: "exact" | "probable";
  // Set identityKey on the structure being built.
  identityKey: string;
  // Set reason on the structure being built.
  reason: string;
};

// Declare type DuplicateDetectionResult for callers and internals.
export type DuplicateDetectionResult = {
  // Set exactActive on the structure being built.
  exactActive: ExistingTicketSummary | null;
  // Set probableActive on the structure being built.
  probableActive: ExistingTicketSummary | null;
  // Set match on the structure being built.
  match: DuplicateMatch | null;
  /** Most recent resolved/closed ticket with the same exact identity (reopen hint). */
  suggestReopen: ExistingTicketSummary | null;
};

// Build summary select object holding related fields.
const summarySelect = {
  // Set id on the structure being built.
  id: true,
  // Set status on the structure being built.
  status: true,
  // Set title on the structure being built.
  title: true,
  // Set description on the structure being built.
  description: true,
  // Set locationId on the structure being built.
  locationId: true,
  // Set priority on the structure being built.
  priority: true,
  // Set blocksRoom on the structure being built.
  blocksRoom: true,
  // Set issueOptionId on the structure being built.
  issueOptionId: true,
  // Set duplicateIdentityKey on the structure being built.
  duplicateIdentityKey: true,
  // Set assigneeId on the structure being built.
  assigneeId: true,
  // Set reportedByEmployeeId on the structure being built.
  reportedByEmployeeId: true,
  // Set openedAt on the structure being built.
  openedAt: true,
// Run next step: } as const;
} as const;

// Declare type Db for callers and internals.
type Db = typeof prisma | Tx;

// Define toSummary — core behavior for this module.
function toSummary(row: {
  // Set id on the structure being built.
  id: string;
  // Set status on the structure being built.
  status: TicketStatus;
  // Set title on the structure being built.
  title: string;
  // Set description on the structure being built.
  description: string | null;
  // Set locationId on the structure being built.
  locationId: string;
  // Set priority on the structure being built.
  priority: Priority;
  // Set blocksRoom on the structure being built.
  blocksRoom: boolean;
  // Set issueOptionId on the structure being built.
  issueOptionId: string | null;
  // Set assigneeId on the structure being built.
  assigneeId: string | null;
  // Set reportedByEmployeeId on the structure being built.
  reportedByEmployeeId: string;
  // Set openedAt on the structure being built.
  openedAt: Date;
// Run next step: }): ExistingTicketSummary {
}): ExistingTicketSummary {
  // Return the computed result to the caller.
  return row;
}

// Declare type DetectDuplicatesInput for callers and internals.
export type DetectDuplicatesInput = {
  // Set locationId on the structure being built.
  locationId: string;
  // Run next step: issueOptionId?: string | null;
  issueOptionId?: string | null;
  // Run next step: categoryId?: string | null;
  categoryId?: string | null;
  // Set title on the structure being built.
  title: string;
  /** Optional free-text used only for similar matching. */
  description?: string | null;
};

/**
 * Find exact active duplicates and soft similar matches at a location.
 * Call again under the advisory lock before INSERT.
 */
export async function detectDuplicates(
  // Set input on the structure being built.
  input: DetectDuplicatesInput,
  // Set db on the structure being built.
  db: Db = prisma,
// Run next step: ): Promise<DuplicateDetectionResult> {
): Promise<DuplicateDetectionResult> {
  // Collect open statuses list for later processing.
  const openStatuses = [...OPEN_TICKET_STATUSES];

  // Branch when this condition holds so the right path runs.
  if (input.issueOptionId) {
    // Capture identity key for use in this scope.
    const identityKey = `option:${input.locationId}:${input.issueOptionId}`;
    // Load exact active asynchronously for the next steps.
    const exactActive = await db.maintenanceTicket.findFirst({
      // Set where on the structure being built.
      where: {
        // Set locationId on the structure being built.
        locationId: input.locationId,
        // Set issueOptionId on the structure being built.
        issueOptionId: input.issueOptionId,
        // Set status on the structure being built.
        status: { in: openStatuses },
      },
      // Set orderBy on the structure being built.
      orderBy: [{ openedAt: "asc" }, { id: "asc" }],
      // Set select on the structure being built.
      select: summarySelect,
    });

    // Capture suggest reopen for use in this scope.
    const suggestReopen = exactActive
      // Complete the ternary or optional chain started above.
      ? null
      // Complete the ternary or optional chain started above.
      : await db.maintenanceTicket.findFirst({
          // Set where on the structure being built.
          where: {
            // Set locationId on the structure being built.
            locationId: input.locationId,
            // Set issueOptionId on the structure being built.
            issueOptionId: input.issueOptionId,
            // Set status on the structure being built.
            status: { in: [TicketStatus.resolved, TicketStatus.closed] },
          },
          // Set orderBy on the structure being built.
          orderBy: [{ openedAt: "desc" }, { id: "desc" }],
          // Set select on the structure being built.
          select: summarySelect,
        });

    // Branch when this condition holds so the right path runs.
    if (exactActive) {
      // Return the computed result to the caller.
      return {
        // Set exactActive on the structure being built.
        exactActive: toSummary(exactActive),
        // Set probableActive on the structure being built.
        probableActive: null,
        // Set match on the structure being built.
        match: {
          // Set kind on the structure being built.
          kind: "exact",
          // Run next step: identityKey,
          identityKey,
          // Set reason on the structure being built.
          reason: "An active ticket already exists for this room and issue option",
        },
        // Set suggestReopen on the structure being built.
        suggestReopen: null,
      };
    }

    // Probable: another open ticket at this location whose title shares a synonym group.
    const openAtLocation = await db.maintenanceTicket.findMany({
      // Set where on the structure being built.
      where: {
        // Set locationId on the structure being built.
        locationId: input.locationId,
        // Set status on the structure being built.
        status: { in: openStatuses },
        // Set NOT on the structure being built.
        NOT: { issueOptionId: input.issueOptionId },
      },
      // Set select on the structure being built.
      select: summarySelect,
      // Set take on the structure being built.
      take: 50,
      // Set orderBy on the structure being built.
      orderBy: [{ openedAt: "desc" }],
    });

    // Collect probe labels list for later processing.
    const probeLabels = [input.title, input.description ?? ""].filter(Boolean);
    // Capture probable for use in this scope.
    const probable = openAtLocation.find((row) =>
      // Run next step: probeLabels.some(
      probeLabels.some(
        // Run next step: (label) =>
        (label) =>
          // Run next step: labelsAreSimilar(label, row.title) ||
          labelsAreSimilar(label, row.title) ||
          // Run next step: (row.description ? labelsAreSimilar(label, row.description) …
          (row.description ? labelsAreSimilar(label, row.description) : false),
      ),
    );

    // Branch when this condition holds so the right path runs.
    if (probable) {
      // Return the computed result to the caller.
      return {
        // Set exactActive on the structure being built.
        exactActive: null,
        // Set probableActive on the structure being built.
        probableActive: toSummary(probable),
        // Set match on the structure being built.
        match: {
          // Set kind on the structure being built.
          kind: "probable",
          // Run next step: identityKey,
          identityKey,
          // Set reason on the structure being built.
          reason:
            // Run next step: "A related open ticket exists at this location (similar issu…
            "A related open ticket exists at this location (similar issue description)",
        },
        // Set suggestReopen on the structure being built.
        suggestReopen: suggestReopen ? toSummary(suggestReopen) : null,
      };
    }

    // Return the computed result to the caller.
    return {
      // Set exactActive on the structure being built.
      exactActive: null,
      // Set probableActive on the structure being built.
      probableActive: null,
      // Set match on the structure being built.
      match: null,
      // Set suggestReopen on the structure being built.
      suggestReopen: suggestReopen ? toSummary(suggestReopen) : null,
    };
  }

  // Custom category + title path.
  const categoryId = input.categoryId!;
  // Capture dup key for use in this scope.
  const dupKey = customDuplicateIdentityKey(categoryId, input.title);
  // Capture identity key for use in this scope.
  const identityKey = `custom:${input.locationId}:${dupKey}`;

  // Load exact active asynchronously for the next steps.
  const exactActive = await db.maintenanceTicket.findFirst({
    // Set where on the structure being built.
    where: {
      // Set locationId on the structure being built.
      locationId: input.locationId,
      // Set status on the structure being built.
      status: { in: openStatuses },
      // Set OR on the structure being built.
      OR: [
        // Run next step: { duplicateIdentityKey: dupKey },
        { duplicateIdentityKey: dupKey },
        // Legacy rows without duplicateIdentityKey: compare normalized titles in app below.
        {
          // Set maintenanceCategoryId on the structure being built.
          maintenanceCategoryId: categoryId,
          // Set issueOptionId on the structure being built.
          issueOptionId: null,
          // Set duplicateIdentityKey on the structure being built.
          duplicateIdentityKey: null,
        },
      ],
    },
    // Set orderBy on the structure being built.
    orderBy: [{ openedAt: "asc" }, { id: "asc" }],
    // Set select on the structure being built.
    select: summarySelect,
  });

  // Capture resolved exact for use in this scope.
  let resolvedExact = exactActive;
  // Branch when this condition holds so the right path runs.
  if (
    // Run next step: resolvedExact &&
    resolvedExact &&
    // Run next step: resolvedExact.duplicateIdentityKey !== dupKey &&
    resolvedExact.duplicateIdentityKey !== dupKey &&
    // Run next step: customDuplicateIdentityKey(categoryId, resolvedExact.title) …
    customDuplicateIdentityKey(categoryId, resolvedExact.title) !== dupKey
  // Run next step: ) {
  ) {
    // Broad query hit a legacy row with a different normalized title — keep searching.
    const legacyMatches = await db.maintenanceTicket.findMany({
      // Set where on the structure being built.
      where: {
        // Set locationId on the structure being built.
        locationId: input.locationId,
        // Set maintenanceCategoryId on the structure being built.
        maintenanceCategoryId: categoryId,
        // Set issueOptionId on the structure being built.
        issueOptionId: null,
        // Set status on the structure being built.
        status: { in: openStatuses },
        // Set duplicateIdentityKey on the structure being built.
        duplicateIdentityKey: null,
      },
      // Set select on the structure being built.
      select: summarySelect,
      // Set take on the structure being built.
      take: 50,
    });
    // Update resolved exact as control flow progresses.
    resolvedExact =
      // Run next step: legacyMatches.find(
      legacyMatches.find(
        // Run next step: (row) => customDuplicateIdentityKey(categoryId, row.title) =…
        (row) => customDuplicateIdentityKey(categoryId, row.title) === dupKey,
      // Run next step: ) ?? null;
      ) ?? null;
  // Run next step: } else if (resolvedExact?.duplicateIdentityKey === dupKey) {
  } else if (resolvedExact?.duplicateIdentityKey === dupKey) {
    // exact by stored key
  } else if (
    // Run next step: resolvedExact &&
    resolvedExact &&
    // Run next step: customDuplicateIdentityKey(categoryId, resolvedExact.title) …
    customDuplicateIdentityKey(categoryId, resolvedExact.title) === dupKey
  // Run next step: ) {
  ) {
    // exact by legacy title normalize
  }

  // Capture suggest reopen for use in this scope.
  const suggestReopen = resolvedExact
    // Complete the ternary or optional chain started above.
    ? null
    // Complete the ternary or optional chain started above.
    : await db.maintenanceTicket.findFirst({
        // Set where on the structure being built.
        where: {
          // Set locationId on the structure being built.
          locationId: input.locationId,
          // Set maintenanceCategoryId on the structure being built.
          maintenanceCategoryId: categoryId,
          // Set status on the structure being built.
          status: { in: [TicketStatus.resolved, TicketStatus.closed] },
          // Set OR on the structure being built.
          OR: [
            // Run next step: { duplicateIdentityKey: dupKey },
            { duplicateIdentityKey: dupKey },
            // Run next step: { duplicateIdentityKey: null, title: input.title },
            { duplicateIdentityKey: null, title: input.title },
          ],
        },
        // Set orderBy on the structure being built.
        orderBy: [{ openedAt: "desc" }, { id: "desc" }],
        // Set select on the structure being built.
        select: summarySelect,
      });

  // Branch when this condition holds so the right path runs.
  if (resolvedExact) {
    // Return the computed result to the caller.
    return {
      // Set exactActive on the structure being built.
      exactActive: toSummary(resolvedExact),
      // Set probableActive on the structure being built.
      probableActive: null,
      // Set match on the structure being built.
      match: {
        // Set kind on the structure being built.
        kind: "exact",
        // Run next step: identityKey,
        identityKey,
        // Set reason on the structure being built.
        reason:
          // Run next step: "An active ticket already exists for this room with the same…
          "An active ticket already exists for this room with the same normalized problem title",
      },
      // Set suggestReopen on the structure being built.
      suggestReopen: null,
    };
  }

  // Load open at location asynchronously for the next steps.
  const openAtLocation = await db.maintenanceTicket.findMany({
    // Set where on the structure being built.
    where: {
      // Set locationId on the structure being built.
      locationId: input.locationId,
      // Set status on the structure being built.
      status: { in: openStatuses },
    },
    // Set select on the structure being built.
    select: summarySelect,
    // Set take on the structure being built.
    take: 50,
    // Set orderBy on the structure being built.
    orderBy: [{ openedAt: "desc" }],
  });

  // Capture group for use in this scope.
  const group = synonymGroupForLabel(input.title);
  // Capture probable for use in this scope.
  const probable =
    // Update group as control flow progresses.
    group === null
      // Complete the ternary or optional chain started above.
      ? null
      // Complete the ternary or optional chain started above.
      : openAtLocation.find(
          // Run next step: (row) =>
          (row) =>
            // Run next step: labelsAreSimilar(input.title, row.title) ||
            labelsAreSimilar(input.title, row.title) ||
            // Run next step: (row.description
            (row.description
              // Complete the ternary or optional chain started above.
              ? labelsAreSimilar(input.title, row.description)
              // Complete the ternary or optional chain started above.
              : false),
        );

  // Branch when this condition holds so the right path runs.
  if (probable) {
    // Return the computed result to the caller.
    return {
      // Set exactActive on the structure being built.
      exactActive: null,
      // Set probableActive on the structure being built.
      probableActive: toSummary(probable),
      // Set match on the structure being built.
      match: {
        // Set kind on the structure being built.
        kind: "probable",
        // Run next step: identityKey,
        identityKey,
        // Set reason on the structure being built.
        reason:
          // Run next step: "A related open ticket exists at this location (similar issu…
          "A related open ticket exists at this location (similar issue description)",
      },
      // Set suggestReopen on the structure being built.
      suggestReopen: suggestReopen ? toSummary(suggestReopen) : null,
    };
  }

  // Return the computed result to the caller.
  return {
    // Set exactActive on the structure being built.
    exactActive: null,
    // Set probableActive on the structure being built.
    probableActive: null,
    // Set match on the structure being built.
    match: null,
    // Set suggestReopen on the structure being built.
    suggestReopen: suggestReopen ? toSummary(suggestReopen) : null,
  };
}

/** Identity key stored on the ticket row for custom reports (null for option path). */
export function storedDuplicateIdentityKey(input: {
  // Run next step: issueOptionId?: string | null;
  issueOptionId?: string | null;
  // Run next step: categoryId?: string | null;
  categoryId?: string | null;
  // Set title on the structure being built.
  title: string;
// Run next step: }): string | null {
}): string | null {
  // Branch when this condition holds so the right path runs.
  if (input.issueOptionId) return null;
  // Branch when this condition holds so the right path runs.
  if (!input.categoryId) return null;
  // Return the computed result to the caller.
  return customDuplicateIdentityKey(input.categoryId, input.title);
}
