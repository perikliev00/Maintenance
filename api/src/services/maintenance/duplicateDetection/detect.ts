/**
 * Exact and probable duplicate detection for maintenance reports.
 */
import { TicketStatus, type Priority } from "@prisma/client";
import { OPEN_TICKET_STATUSES } from "../../../constants";
import { prisma } from "../../../db";
import type { Tx } from "../types";
import {
  customDuplicateIdentityKey,
} from "./identity";
import { labelsAreSimilar, synonymGroupForLabel } from "./synonyms";

export type ExistingTicketSummary = {
  id: string;
  status: TicketStatus;
  title: string;
  description: string | null;
  locationId: string;
  priority: Priority;
  blocksRoom: boolean;
  issueOptionId: string | null;
  assigneeId: string | null;
  reportedByEmployeeId: string;
  openedAt: Date;
};

export type DuplicateMatch = {
  kind: "exact" | "probable";
  identityKey: string;
  reason: string;
};

export type DuplicateDetectionResult = {
  exactActive: ExistingTicketSummary | null;
  probableActive: ExistingTicketSummary | null;
  match: DuplicateMatch | null;
  /** Most recent resolved/closed ticket with the same exact identity (reopen hint). */
  suggestReopen: ExistingTicketSummary | null;
};

const summarySelect = {
  id: true,
  status: true,
  title: true,
  description: true,
  locationId: true,
  priority: true,
  blocksRoom: true,
  issueOptionId: true,
  duplicateIdentityKey: true,
  assigneeId: true,
  reportedByEmployeeId: true,
  openedAt: true,
} as const;

type Db = typeof prisma | Tx;

function toSummary(row: {
  id: string;
  status: TicketStatus;
  title: string;
  description: string | null;
  locationId: string;
  priority: Priority;
  blocksRoom: boolean;
  issueOptionId: string | null;
  assigneeId: string | null;
  reportedByEmployeeId: string;
  openedAt: Date;
}): ExistingTicketSummary {
  return row;
}

export type DetectDuplicatesInput = {
  locationId: string;
  issueOptionId?: string | null;
  categoryId?: string | null;
  title: string;
  /** Optional free-text used only for similar matching. */
  description?: string | null;
};

/**
 * Find exact active duplicates and soft similar matches at a location.
 * Call again under the advisory lock before INSERT.
 */
export async function detectDuplicates(
  input: DetectDuplicatesInput,
  db: Db = prisma,
): Promise<DuplicateDetectionResult> {
  const openStatuses = [...OPEN_TICKET_STATUSES];

  if (input.issueOptionId) {
    const identityKey = `option:${input.locationId}:${input.issueOptionId}`;
    const exactActive = await db.maintenanceTicket.findFirst({
      where: {
        locationId: input.locationId,
        issueOptionId: input.issueOptionId,
        status: { in: openStatuses },
      },
      orderBy: [{ openedAt: "asc" }, { id: "asc" }],
      select: summarySelect,
    });

    const suggestReopen = exactActive
      ? null
      : await db.maintenanceTicket.findFirst({
          where: {
            locationId: input.locationId,
            issueOptionId: input.issueOptionId,
            status: { in: [TicketStatus.resolved, TicketStatus.closed] },
          },
          orderBy: [{ openedAt: "desc" }, { id: "desc" }],
          select: summarySelect,
        });

    if (exactActive) {
      return {
        exactActive: toSummary(exactActive),
        probableActive: null,
        match: {
          kind: "exact",
          identityKey,
          reason: "An active ticket already exists for this room and issue option",
        },
        suggestReopen: null,
      };
    }

    // Probable: another open ticket at this location whose title shares a synonym group.
    const openAtLocation = await db.maintenanceTicket.findMany({
      where: {
        locationId: input.locationId,
        status: { in: openStatuses },
        NOT: { issueOptionId: input.issueOptionId },
      },
      select: summarySelect,
      take: 50,
      orderBy: [{ openedAt: "desc" }],
    });

    const probeLabels = [input.title, input.description ?? ""].filter(Boolean);
    const probable = openAtLocation.find((row) =>
      probeLabels.some(
        (label) =>
          labelsAreSimilar(label, row.title) ||
          (row.description ? labelsAreSimilar(label, row.description) : false),
      ),
    );

    if (probable) {
      return {
        exactActive: null,
        probableActive: toSummary(probable),
        match: {
          kind: "probable",
          identityKey,
          reason:
            "A related open ticket exists at this location (similar issue description)",
        },
        suggestReopen: suggestReopen ? toSummary(suggestReopen) : null,
      };
    }

    return {
      exactActive: null,
      probableActive: null,
      match: null,
      suggestReopen: suggestReopen ? toSummary(suggestReopen) : null,
    };
  }

  // Custom category + title path.
  const categoryId = input.categoryId!;
  const dupKey = customDuplicateIdentityKey(categoryId, input.title);
  const identityKey = `custom:${input.locationId}:${dupKey}`;

  const exactActive = await db.maintenanceTicket.findFirst({
    where: {
      locationId: input.locationId,
      status: { in: openStatuses },
      OR: [
        { duplicateIdentityKey: dupKey },
        // Legacy rows without duplicateIdentityKey: compare normalized titles in app below.
        {
          maintenanceCategoryId: categoryId,
          issueOptionId: null,
          duplicateIdentityKey: null,
        },
      ],
    },
    orderBy: [{ openedAt: "asc" }, { id: "asc" }],
    select: summarySelect,
  });

  let resolvedExact = exactActive;
  if (
    resolvedExact &&
    resolvedExact.duplicateIdentityKey !== dupKey &&
    customDuplicateIdentityKey(categoryId, resolvedExact.title) !== dupKey
  ) {
    // Broad query hit a legacy row with a different normalized title — keep searching.
    const legacyMatches = await db.maintenanceTicket.findMany({
      where: {
        locationId: input.locationId,
        maintenanceCategoryId: categoryId,
        issueOptionId: null,
        status: { in: openStatuses },
        duplicateIdentityKey: null,
      },
      select: summarySelect,
      take: 50,
    });
    resolvedExact =
      legacyMatches.find(
        (row) => customDuplicateIdentityKey(categoryId, row.title) === dupKey,
      ) ?? null;
  } else if (resolvedExact?.duplicateIdentityKey === dupKey) {
    // exact by stored key
  } else if (
    resolvedExact &&
    customDuplicateIdentityKey(categoryId, resolvedExact.title) === dupKey
  ) {
    // exact by legacy title normalize
  }

  const suggestReopen = resolvedExact
    ? null
    : await db.maintenanceTicket.findFirst({
        where: {
          locationId: input.locationId,
          maintenanceCategoryId: categoryId,
          status: { in: [TicketStatus.resolved, TicketStatus.closed] },
          OR: [
            { duplicateIdentityKey: dupKey },
            { duplicateIdentityKey: null, title: input.title },
          ],
        },
        orderBy: [{ openedAt: "desc" }, { id: "desc" }],
        select: summarySelect,
      });

  if (resolvedExact) {
    return {
      exactActive: toSummary(resolvedExact),
      probableActive: null,
      match: {
        kind: "exact",
        identityKey,
        reason:
          "An active ticket already exists for this room with the same normalized problem title",
      },
      suggestReopen: null,
    };
  }

  const openAtLocation = await db.maintenanceTicket.findMany({
    where: {
      locationId: input.locationId,
      status: { in: openStatuses },
    },
    select: summarySelect,
    take: 50,
    orderBy: [{ openedAt: "desc" }],
  });

  const group = synonymGroupForLabel(input.title);
  const probable =
    group === null
      ? null
      : openAtLocation.find(
          (row) =>
            labelsAreSimilar(input.title, row.title) ||
            (row.description
              ? labelsAreSimilar(input.title, row.description)
              : false),
        );

  if (probable) {
    return {
      exactActive: null,
      probableActive: toSummary(probable),
      match: {
        kind: "probable",
        identityKey,
        reason:
          "A related open ticket exists at this location (similar issue description)",
      },
      suggestReopen: suggestReopen ? toSummary(suggestReopen) : null,
    };
  }

  return {
    exactActive: null,
    probableActive: null,
    match: null,
    suggestReopen: suggestReopen ? toSummary(suggestReopen) : null,
  };
}

/** Identity key stored on the ticket row for custom reports (null for option path). */
export function storedDuplicateIdentityKey(input: {
  issueOptionId?: string | null;
  categoryId?: string | null;
  title: string;
}): string | null {
  if (input.issueOptionId) return null;
  if (!input.categoryId) return null;
  return customDuplicateIdentityKey(input.categoryId, input.title);
}
