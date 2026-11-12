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
} from "@prisma/client";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { isP2002 } from "../db/prismaErrors";
import { recordAudit } from "../audit";
import { assertCommandPayloadMatch } from "../commandIdempotency";

/** Card types that bind to a staff employee (not guest). */
const STAFF_CARD_TYPES: CardType[] = [
  CardType.housekeeper,
  CardType.maintenance,
  CardType.manager,
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
    include: {
      location: { include: { floor: { include: { building: true } } } },
      issuedBy: true,
    },
    orderBy: { createdAt: "desc" as const },
  },
} satisfies Prisma.AccessCardInclude;

export type CardWithRelations = Prisma.AccessCardGetPayload<{
  include: typeof cardInclude;
}>;

/** Ensure the grant window is a positive open interval (until after from). */
function assertValidity(validFrom: Date, validUntil: Date) {
  // Equal or reversed windows are rejected as invalid input.
  if (!(validUntil.getTime() > validFrom.getTime())) {
    throw new AppError(
      400,
      "invalid_input",
      "validUntil must be after validFrom",
    );
  }
}

/** Normalize nullable ids so undefined and null compare equal. */
function nullNorm(id: string | null | undefined): string | null {
  return id ?? null;
}

/**
 * Chronologically first grant (initial issue grant). Used for commandId
 * fingerprinting; grants include may be newest-first.
 */
function firstGrant(card: CardWithRelations) {
  if (!card.grants.length) return null;
  return [...card.grants].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  )[0]!;
}

/**
 * P1-83: same commandId must replay the same cardType / holder / location /
 * validity window; otherwise 409 conflict (not silent idempotent success).
 */
function assertIssueFingerprintMatch(
  card: CardWithRelations,
  input: {
    cardType: CardType;
    employeeId?: string | null;
    locationId?: string | null;
    validFrom: Date;
    validUntil: Date;
  },
) {
  const grant = firstGrant(card);
  const locationId = grant?.locationId ?? null;
  // Invoke assertCommandPayloadMatch.
  assertCommandPayloadMatch(
    card.cardType === input.cardType &&
      nullNorm(card.employeeId) === nullNorm(input.employeeId) &&
      nullNorm(locationId) === nullNorm(input.locationId) &&
      grant != null &&
      grant.validFrom.getTime() === input.validFrom.getTime() &&
      grant.validUntil.getTime() === input.validUntil.getTime(),
  );
}

/** List access cards with optional filters; newest first. */
export async function listCards(filters: {
  employeeId?: string;
  status?: CardStatus;
  cardType?: CardType;
  q?: string;
  staffOnly?: boolean;
}) {
  // Build AND clauses only for filters the caller actually set.
  const and: Prisma.AccessCardWhereInput[] = [];

  // Filter by card holder employee id.
  if (filters.employeeId) {
    and.push({ employeeId: filters.employeeId });
  }
  // Filter by active / revoked status.
  if (filters.status) {
    and.push({ status: filters.status });
  }
  // Filter by exact card type (guest, housekeeper, master, …).
  if (filters.cardType) {
    and.push({ cardType: filters.cardType });
  }
  if (filters.staffOnly) {
    // Intersect with staff types + non-null holder. Incompatible with guest
    // (or any non-staff cardType) → empty result via AND, not a wider set.
    and.push({
      cardType: { in: STAFF_CARD_TYPES },
      employeeId: { not: null },
    });
  }
  // Free-text search across label, holder name, and employee number.
  if (filters.q) {
    and.push({
      OR: [
        { label: { contains: filters.q, mode: "insensitive" } },
        {
          employee: {
            fullName: { contains: filters.q, mode: "insensitive" },
          },
        },
        {
          employee: {
            employeeNumber: { contains: filters.q, mode: "insensitive" },
          },
        },
      ],
    });
  }

  // Empty AND → unfiltered list; otherwise combine all clauses.
  const where: Prisma.AccessCardWhereInput =
    and.length > 0 ? { AND: and } : {};

  // Newest-first with grants + employee joins for the cards panel.
  return prisma.accessCard.findMany({
    where,
    include: cardInclude,
    orderBy: [{ createdAt: "desc" }],
  });
}

/** Active employees for card-holder pickers (capped at 200). */
export async function listCardEmployees(q?: string) {
  // Active users only; optional name/number search; hard cap for picker UX.
  return prisma.employee.findMany({
    where: {
      user: { isActive: true },
      // Spread additional fields/filters.
      ...(q
        ? {
            OR: [
              { fullName: { contains: q, mode: "insensitive" } },
              { employeeNumber: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      fullName: true,
      employeeNumber: true,
      department: true,
    },
    orderBy: { fullName: "asc" },
    take: 200,
  });
}

/**
 * Issue a card + initial grant. Safe to retry with the same `commandId`:
 * returns the existing card with `idempotent: true` (including unique races).
 */
export async function issueCard(input: {
  cardType: CardType;
  employeeId?: string | null;
  locationId?: string | null;
  validFrom: Date;
  validUntil: Date;
  label?: string | null;
  commandId: string;
  issuedByEmployeeId: string;
}): Promise<{ card: CardWithRelations; idempotent: boolean }> {
  // Idempotency: same commandId returns the same card when fingerprint matches.
  const existing = await prisma.accessCard.findUnique({
    where: { commandId: input.commandId },
    include: cardInclude,
  });
  // Retry of a prior successful issue — fingerprint must match (P1-83).
  if (existing) {
    // Invoke assertIssueFingerprintMatch.
    assertIssueFingerprintMatch(existing, input);
    return { card: existing, idempotent: true };
  }

  // Validate the grant window before type-specific rules.
  assertValidity(input.validFrom, input.validUntil);

  // Branch validation on guest vs staff/master card rules.
  const isGuest = input.cardType === CardType.guest;
  const isMaster = input.cardType === CardType.master;

  if (isGuest) {
    // Guest cards bind to a room, never to a staff employee.
    if (input.employeeId) {
      throw new AppError(
        400,
        "invalid_input",
        "Guest cards must not be linked to an employee",
      );
    }
    // Guest cards always require a room location grant.
    if (!input.locationId) {
      throw new AppError(
        400,
        "invalid_input",
        "Guest cards require a room location",
      );
    }
  } else {
    // Staff / master cards require a holder employee.
    if (!input.employeeId) {
      throw new AppError(
        400,
        "invalid_input",
        "Staff cards require an employee",
      );
    }
    // Master is property-wide — locationId must stay null.
    if (isMaster && input.locationId) {
      throw new AppError(
        400,
        "invalid_input",
        "Master cards are property-wide and must not set a location",
      );
    }
  }

  // Ensure the holder employee exists when provided.
  if (input.employeeId) {
    const employee = await prisma.employee.findUnique({
      where: { id: input.employeeId },
    });
    if (!employee) {
      throw new AppError(404, "not_found", "Employee not found");
    }
  }

  // Ensure the grant location exists; guest grants must be rooms.
  if (input.locationId) {
    const location = await prisma.location.findUnique({
      where: { id: input.locationId },
    });
    if (!location) {
      throw new AppError(404, "not_found", "Location not found");
    }
    if (isGuest && location.kind !== LocationKind.room) {
      throw new AppError(
        400,
        "invalid_input",
        "Guest cards require a room location",
      );
    }
  }

  try {
    // Create card + initial grant + audit in one transaction.
    const card = await prisma.$transaction(async (tx) => {
      const created = await tx.accessCard.create({
        data: {
          cardType: input.cardType,
          status: CardStatus.active,
          label: input.label?.trim() || null,
          employeeId: input.employeeId ?? null,
          issuedByEmployeeId: input.issuedByEmployeeId,
          commandId: input.commandId,
          grants: {
            create: {
              locationId: input.locationId ?? null,
              validFrom: input.validFrom,
              validUntil: input.validUntil,
              issuedByEmployeeId: input.issuedByEmployeeId,
            },
          },
        },
        include: cardInclude,
      });
      // Audit the issue under the issuing employee.
      await recordAudit(
        {
          actorEmployeeId: input.issuedByEmployeeId,
          action: "card.issue",
          entityType: "card",
          entityId: created.id,
          locationId: input.locationId ?? null,
          after: {
            cardType: created.cardType,
            employeeId: created.employeeId,
            locationId: input.locationId ?? null,
          },
          summary: `Issued ${created.cardType} card`,
        },
        tx,
      );
      return created;
    });
    return { card, idempotent: false };
  } catch (err) {
    // Concurrent create with the same commandId → treat as idempotent success.
    if (isP2002(err)) {
      const raced = await prisma.accessCard.findUnique({
        where: { commandId: input.commandId },
        include: cardInclude,
      });
      // P2002 loser must fingerprint too — otherwise concurrent mismatched
      // payloads with the same commandId would silently succeed (P1-83d).
      if (raced) {
        // Invoke assertIssueFingerprintMatch.
        assertIssueFingerprintMatch(raced, input);
        return { card: raced, idempotent: true };
      }
    }
    // Non-unique errors (or unique without a recoverable row) propagate.
    throw err;
  }
}

/** Mark a card revoked (409 if already revoked) and write an audit event. */
export async function revokeCard(input: {
  cardId: string;
  actorEmployeeId?: string;
}): Promise<CardWithRelations> {
  // Load for 404 / audit summary; CAS below is the concurrency authority.
  const card = await prisma.accessCard.findUnique({
    where: { id: input.cardId },
  });
  // Missing card → 404.
  if (!card) {
    throw new AppError(404, "not_found", "Card not found");
  }

  // CAS status flip + at-most-one audit (P1-84).
  return prisma.$transaction(async (tx) => {
    const flipped = await tx.accessCard.updateMany({
      where: { id: input.cardId, status: CardStatus.active },
      data: { status: CardStatus.revoked },
    });
    // Already revoked (or raced loser) → conflict; do not audit.
    if (flipped.count === 0) {
      throw new AppError(409, "invalid_state", "Card already revoked");
    }
    // Audit only the successful CAS winner.
    await recordAudit(
      {
        actorEmployeeId: input.actorEmployeeId,
        action: "card.revoke",
        entityType: "card",
        entityId: input.cardId,
        before: { status: CardStatus.active },
        after: { status: CardStatus.revoked },
        summary: `Revoked ${card.cardType} card`,
      },
      tx,
    );
    // Reload with standard includes for the API payload.
    return tx.accessCard.findUniqueOrThrow({
      where: { id: input.cardId },
      include: cardInclude,
    });
  });
}
