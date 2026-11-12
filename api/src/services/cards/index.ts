/**
 * Access-card issuance and revocation. Guest cards bind to a room; staff cards
 * bind to an employee; master cards are property-wide. Issuance is idempotent
 * on `commandId` (including P2002 races).
 */
import {
  CardStatus,
  CardType,
  LocationKind,
  Prisma,
// Support the surrounding control flow.
} from "@prisma/client";
// Shared Prisma client singleton.
import { prisma } from "../../db";
// Runtime import from ../../errors.
import { AppError } from "../../errors";
// Runtime import from ../db/prismaErrors.
import { isP2002 } from "../db/prismaErrors";
// Runtime import from ../audit.
import { recordAudit } from "../audit";
// Runtime import from ../commandIdempotency.
import { assertCommandPayloadMatch } from "../commandIdempotency";

/** Card types that bind to a staff employee (not guest). */
const STAFF_CARD_TYPES: CardType[] = [
  // Support the surrounding control flow.
  CardType.housekeeper,
  // Support the surrounding control flow.
  CardType.maintenance,
  // Support the surrounding control flow.
  CardType.manager,
  // Support the surrounding control flow.
  CardType.master,
];

/** Standard relations for card list/issue/revoke API payloads. */
const cardInclude = {
  // Holder employee (null for guest cards).
  employee: true,
  // Who issued the card.
  issuedBy: true,
  // Grants newest-first with location/building for the cards panel.
  grants: {
    // Include relations for labels/checks.
    include: {
      // Field location on this type/payload.
      location: { include: { floor: { include: { building: true } } } },
      // Field issuedBy on this type/payload.
      issuedBy: true,
    },
    // Stable sort for paging.
    orderBy: { createdAt: "desc" as const },
  },
// Support the surrounding control flow.
} satisfies Prisma.AccessCardInclude;

// Public type CardWithRelations for callers of this service.
export type CardWithRelations = Prisma.AccessCardGetPayload<{
  // Include relations for labels/checks.
  include: typeof cardInclude;
// Support the surrounding control flow.
}>;

/** Ensure the grant window is a positive open interval (until after from). */
function assertValidity(validFrom: Date, validUntil: Date) {
  // Equal or reversed windows are rejected as invalid input.
  if (!(validUntil.getTime() > validFrom.getTime())) {
    // Throw typed AppError for HTTP mapping.
    throw new AppError(
      400,
      "invalid_input",
      "validUntil must be after validFrom",
    );
  }
}

/** Normalize nullable ids so undefined and null compare equal. */
function nullNorm(id: string | null | undefined): string | null {
  // Return computed result.
  return id ?? null;
}

/**
 * Chronologically first grant (initial issue grant). Used for commandId
 * fingerprinting; grants include may be newest-first.
 */
function firstGrant(card: CardWithRelations) {
  // Guard missing required data.
  if (!card.grants.length) return null;
  // Return computed result.
  return [...card.grants].sort(
    // Support the surrounding control flow.
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  // Support the surrounding control flow.
  )[0]!;
}

/**
 * P1-83: same commandId must replay the same cardType / holder / location /
 * validity window; otherwise 409 conflict (not silent idempotent success).
 */
function assertIssueFingerprintMatch(
  // Param card required by this function.
  card: CardWithRelations,
  // Param input required by this function.
  input: {
    // Param cardType required by this function.
    cardType: CardType;
    // Param employeeId required by this function.
    employeeId?: string | null;
    // Param locationId required by this function.
    locationId?: string | null;
    // Param validFrom required by this function.
    validFrom: Date;
    // Param validUntil required by this function.
    validUntil: Date;
  },
) {
  // Local grant used below.
  const grant = firstGrant(card);
  // Local locationId used below.
  const locationId = grant?.locationId ?? null;
  // Invoke assertCommandPayloadMatch.
  assertCommandPayloadMatch(
    // Additional clause in this boolean decision.
    card.cardType === input.cardType &&
      // Additional clause in this boolean decision.
      nullNorm(card.employeeId) === nullNorm(input.employeeId) &&
      // Additional clause in this boolean decision.
      nullNorm(locationId) === nullNorm(input.locationId) &&
      // Additional clause in this boolean decision.
      grant != null &&
      // Additional clause in this boolean decision.
      grant.validFrom.getTime() === input.validFrom.getTime() &&
      // Support the surrounding control flow.
      grant.validUntil.getTime() === input.validUntil.getTime(),
  );
}

/** List access cards with optional filters; newest first. */
export async function listCards(filters: {
  // Param employeeId required by this function.
  employeeId?: string;
  // Param status required by this function.
  status?: CardStatus;
  // Param cardType required by this function.
  cardType?: CardType;
  // Param q required by this function.
  q?: string;
  // Param staffOnly required by this function.
  staffOnly?: boolean;
// Support the surrounding control flow.
}) {
  // Build AND clauses only for filters the caller actually set.
  const and: Prisma.AccessCardWhereInput[] = [];

  // Filter by card holder employee id.
  if (filters.employeeId) {
    // Support the surrounding control flow.
    and.push({ employeeId: filters.employeeId });
  }
  // Filter by active / revoked status.
  if (filters.status) {
    // Support the surrounding control flow.
    and.push({ status: filters.status });
  }
  // Filter by exact card type (guest, housekeeper, master, …).
  if (filters.cardType) {
    // Support the surrounding control flow.
    and.push({ cardType: filters.cardType });
  }
  // Conditional path for this guard.
  if (filters.staffOnly) {
    // Intersect with staff types + non-null holder. Incompatible with guest
    // (or any non-staff cardType) → empty result via AND, not a wider set.
    and.push({
      // Param cardType required by this function.
      cardType: { in: STAFF_CARD_TYPES },
      // Param employeeId required by this function.
      employeeId: { not: null },
    });
  }
  // Free-text search across label, holder name, and employee number.
  if (filters.q) {
    // Support the surrounding control flow.
    and.push({
      // Param OR required by this function.
      OR: [
        // Support the surrounding control flow.
        { label: { contains: filters.q, mode: "insensitive" } },
        // Support the surrounding control flow.
        {
          // Param employee required by this function.
          employee: {
            // Param fullName required by this function.
            fullName: { contains: filters.q, mode: "insensitive" },
          },
        },
        // Support the surrounding control flow.
        {
          // Param employee required by this function.
          employee: {
            // Param employeeNumber required by this function.
            employeeNumber: { contains: filters.q, mode: "insensitive" },
          },
        },
      ],
    });
  }

  // Empty AND → unfiltered list; otherwise combine all clauses.
  const where: Prisma.AccessCardWhereInput =
    // Support the surrounding control flow.
    and.length > 0 ? { AND: and } : {};

  // Newest-first with grants + employee joins for the cards panel.
  return prisma.accessCard.findMany({
    where,
    // Include relations for labels/checks.
    include: cardInclude,
    // Stable sort for paging.
    orderBy: [{ createdAt: "desc" }],
  });
}

/** Active employees for card-holder pickers (capped at 200). */
export async function listCardEmployees(q?: string) {
  // Active users only; optional name/number search; hard cap for picker UX.
  return prisma.employee.findMany({
    // Filter matching rows.
    where: {
      // Param user required by this function.
      user: { isActive: true },
      // Spread additional fields/filters.
      ...(q
        // Support the surrounding control flow.
        ? {
            // Param OR required by this function.
            OR: [
              // Support the surrounding control flow.
              { fullName: { contains: q, mode: "insensitive" } },
              // Support the surrounding control flow.
              { employeeNumber: { contains: q, mode: "insensitive" } },
            ],
          }
        // Support the surrounding control flow.
        : {}),
    },
    // Select only needed columns.
    select: {
      // Param id required by this function.
      id: true,
      // Param fullName required by this function.
      fullName: true,
      // Param employeeNumber required by this function.
      employeeNumber: true,
      // Param department required by this function.
      department: true,
    },
    // Stable sort for paging.
    orderBy: { fullName: "asc" },
    // Page size limit.
    take: 200,
  });
}

/**
 * Issue a card + initial grant. Safe to retry with the same `commandId`:
 * returns the existing card with `idempotent: true` (including unique races).
 */
export async function issueCard(input: {
  // Param cardType required by this function.
  cardType: CardType;
  // Param employeeId required by this function.
  employeeId?: string | null;
  // Param locationId required by this function.
  locationId?: string | null;
  // Param validFrom required by this function.
  validFrom: Date;
  // Param validUntil required by this function.
  validUntil: Date;
  // Param label required by this function.
  label?: string | null;
  // Param commandId required by this function.
  commandId: string;
  // Param issuedByEmployeeId required by this function.
  issuedByEmployeeId: string;
// Support the surrounding control flow.
}): Promise<{ card: CardWithRelations; idempotent: boolean }> {
  // Idempotency: same commandId returns the same card when fingerprint matches.
  const existing = await prisma.accessCard.findUnique({
    // Filter matching rows.
    where: { commandId: input.commandId },
    // Include relations for labels/checks.
    include: cardInclude,
  });
  // Retry of a prior successful issue — fingerprint must match (P1-83).
  if (existing) {
    // Invoke assertIssueFingerprintMatch.
    assertIssueFingerprintMatch(existing, input);
    // Return response object.
    return { card: existing, idempotent: true };
  }

  // Validate the grant window before type-specific rules.
  assertValidity(input.validFrom, input.validUntil);

  // Branch validation on guest vs staff/master card rules.
  const isGuest = input.cardType === CardType.guest;
  // Local isMaster used below.
  const isMaster = input.cardType === CardType.master;

  // Conditional path for this guard.
  if (isGuest) {
    // Guest cards bind to a room, never to a staff employee.
    if (input.employeeId) {
      // Throw typed AppError for HTTP mapping.
      throw new AppError(
        400,
        "invalid_input",
        "Guest cards must not be linked to an employee",
      );
    }
    // Guest cards always require a room location grant.
    if (!input.locationId) {
      // Throw typed AppError for HTTP mapping.
      throw new AppError(
        400,
        "invalid_input",
        "Guest cards require a room location",
      );
    }
  // Support the surrounding control flow.
  } else {
    // Staff / master cards require a holder employee.
    if (!input.employeeId) {
      // Throw typed AppError for HTTP mapping.
      throw new AppError(
        400,
        "invalid_input",
        "Staff cards require an employee",
      );
    }
    // Master is property-wide — locationId must stay null.
    if (isMaster && input.locationId) {
      // Throw typed AppError for HTTP mapping.
      throw new AppError(
        400,
        "invalid_input",
        "Master cards are property-wide and must not set a location",
      );
    }
  }

  // Ensure the holder employee exists when provided.
  if (input.employeeId) {
    // Fetch employee by unique/first match.
    const employee = await prisma.employee.findUnique({
      // Filter matching rows.
      where: { id: input.employeeId },
    });
    // Conditional path for this guard.
    if (!employee) {
      // Throw typed AppError for HTTP mapping.
      throw new AppError(404, "not_found", "Employee not found");
    }
  }

  // Ensure the grant location exists; guest grants must be rooms.
  if (input.locationId) {
    // Fetch location by unique/first match.
    const location = await prisma.location.findUnique({
      // Filter matching rows.
      where: { id: input.locationId },
    });
    // Conditional path for this guard.
    if (!location) {
      // Throw typed AppError for HTTP mapping.
      throw new AppError(404, "not_found", "Location not found");
    }
    // Conditional path for this guard.
    if (isGuest && location.kind !== LocationKind.room) {
      // Throw typed AppError for HTTP mapping.
      throw new AppError(
        400,
        "invalid_input",
        "Guest cards require a room location",
      );
    }
  }

  // Catch locally so callers get mapped errors.
  try {
    // Create card + initial grant + audit in one transaction.
    const card = await prisma.$transaction(async (tx) => {
      // Await created before dependent work.
      const created = await tx.accessCard.create({
        // Mutation data payload.
        data: {
          // Param cardType required by this function.
          cardType: input.cardType,
          // Param status required by this function.
          status: CardStatus.active,
          // Param label required by this function.
          label: input.label?.trim() || null,
          // Param employeeId required by this function.
          employeeId: input.employeeId ?? null,
          // Param issuedByEmployeeId required by this function.
          issuedByEmployeeId: input.issuedByEmployeeId,
          // Param commandId required by this function.
          commandId: input.commandId,
          // Param grants required by this function.
          grants: {
            // Param create required by this function.
            create: {
              // Param locationId required by this function.
              locationId: input.locationId ?? null,
              // Param validFrom required by this function.
              validFrom: input.validFrom,
              // Param validUntil required by this function.
              validUntil: input.validUntil,
              // Param issuedByEmployeeId required by this function.
              issuedByEmployeeId: input.issuedByEmployeeId,
            },
          },
        },
        // Include relations for labels/checks.
        include: cardInclude,
      });
      // Audit the issue under the issuing employee.
      await recordAudit(
        // Support the surrounding control flow.
        {
          // Param actorEmployeeId required by this function.
          actorEmployeeId: input.issuedByEmployeeId,
          // Param action required by this function.
          action: "card.issue",
          // Param entityType required by this function.
          entityType: "card",
          // Param entityId required by this function.
          entityId: created.id,
          // Param locationId required by this function.
          locationId: input.locationId ?? null,
          // Param after required by this function.
          after: {
            // Param cardType required by this function.
            cardType: created.cardType,
            // Param employeeId required by this function.
            employeeId: created.employeeId,
            // Param locationId required by this function.
            locationId: input.locationId ?? null,
          },
          // Param summary required by this function.
          summary: `Issued ${created.cardType} card`,
        },
        tx,
      );
      // Return computed result.
      return created;
    });
    // Return response object.
    return { card, idempotent: false };
  // Support the surrounding control flow.
  } catch (err) {
    // Concurrent create with the same commandId → treat as idempotent success.
    if (isP2002(err)) {
      // Fetch raced by unique/first match.
      const raced = await prisma.accessCard.findUnique({
        // Filter matching rows.
        where: { commandId: input.commandId },
        // Include relations for labels/checks.
        include: cardInclude,
      });
      // P2002 loser must fingerprint too — otherwise concurrent mismatched
      // payloads with the same commandId would silently succeed (P1-83d).
      if (raced) {
        // Invoke assertIssueFingerprintMatch.
        assertIssueFingerprintMatch(raced, input);
        // Return response object.
        return { card: raced, idempotent: true };
      }
    }
    // Non-unique errors (or unique without a recoverable row) propagate.
    throw err;
  }
}

/** Mark a card revoked (409 if already revoked) and write an audit event. */
export async function revokeCard(input: {
  // Param cardId required by this function.
  cardId: string;
  // Param actorEmployeeId required by this function.
  actorEmployeeId?: string;
// Support the surrounding control flow.
}): Promise<CardWithRelations> {
  // Load for 404 / audit summary; CAS below is the concurrency authority.
  const card = await prisma.accessCard.findUnique({
    // Filter matching rows.
    where: { id: input.cardId },
  });
  // Missing card → 404.
  if (!card) {
    // Throw typed AppError for HTTP mapping.
    throw new AppError(404, "not_found", "Card not found");
  }

  // CAS status flip + at-most-one audit (P1-84).
  return prisma.$transaction(async (tx) => {
    // Await flipped before dependent work.
    const flipped = await tx.accessCard.updateMany({
      // Filter matching rows.
      where: { id: input.cardId, status: CardStatus.active },
      // Mutation data payload.
      data: { status: CardStatus.revoked },
    });
    // Already revoked (or raced loser) → conflict; do not audit.
    if (flipped.count === 0) {
      // Throw typed AppError for HTTP mapping.
      throw new AppError(409, "invalid_state", "Card already revoked");
    }
    // Audit only the successful CAS winner.
    await recordAudit(
      // Support the surrounding control flow.
      {
        // Param actorEmployeeId required by this function.
        actorEmployeeId: input.actorEmployeeId,
        // Param action required by this function.
        action: "card.revoke",
        // Param entityType required by this function.
        entityType: "card",
        // Param entityId required by this function.
        entityId: input.cardId,
        // Param before required by this function.
        before: { status: CardStatus.active },
        // Param after required by this function.
        after: { status: CardStatus.revoked },
        // Param summary required by this function.
        summary: `Revoked ${card.cardType} card`,
      },
      tx,
    );
    // Reload with standard includes for the API payload.
    return tx.accessCard.findUniqueOrThrow({
      // Filter matching rows.
      where: { id: input.cardId },
      // Include relations for labels/checks.
      include: cardInclude,
    });
  });
}
