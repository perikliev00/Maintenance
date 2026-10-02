import {
  CardStatus,
  CardType,
  LocationKind,
  Prisma,
} from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "./cleaning";
import { recordAudit } from "./audit";

const STAFF_CARD_TYPES: CardType[] = [
  CardType.housekeeper,
  CardType.maintenance,
  CardType.manager,
  CardType.master,
];

const cardInclude = {
  employee: true,
  issuedBy: true,
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

function assertValidity(validFrom: Date, validUntil: Date) {
  if (!(validUntil.getTime() > validFrom.getTime())) {
    throw new AppError(
      400,
      "invalid_input",
      "validUntil must be after validFrom",
    );
  }
}

export async function listCards(filters: {
  employeeId?: string;
  status?: CardStatus;
  cardType?: CardType;
  q?: string;
  staffOnly?: boolean;
}) {
  const where: Prisma.AccessCardWhereInput = {
    ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.cardType ? { cardType: filters.cardType } : {}),
    ...(filters.staffOnly
      ? { cardType: { in: STAFF_CARD_TYPES }, employeeId: { not: null } }
      : {}),
    ...(filters.q
      ? {
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
        }
      : {}),
  };

  return prisma.accessCard.findMany({
    where,
    include: cardInclude,
    orderBy: [{ createdAt: "desc" }],
  });
}

export async function listCardEmployees(q?: string) {
  return prisma.employee.findMany({
    where: {
      user: { isActive: true },
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
  const existing = await prisma.accessCard.findUnique({
    where: { commandId: input.commandId },
    include: cardInclude,
  });
  if (existing) {
    return { card: existing, idempotent: true };
  }

  assertValidity(input.validFrom, input.validUntil);

  const isGuest = input.cardType === CardType.guest;
  const isMaster = input.cardType === CardType.master;

  if (isGuest) {
    if (input.employeeId) {
      throw new AppError(
        400,
        "invalid_input",
        "Guest cards must not be linked to an employee",
      );
    }
    if (!input.locationId) {
      throw new AppError(
        400,
        "invalid_input",
        "Guest cards require a room location",
      );
    }
  } else {
    if (!input.employeeId) {
      throw new AppError(
        400,
        "invalid_input",
        "Staff cards require an employee",
      );
    }
    if (isMaster && input.locationId) {
      throw new AppError(
        400,
        "invalid_input",
        "Master cards are property-wide and must not set a location",
      );
    }
  }

  if (input.employeeId) {
    const employee = await prisma.employee.findUnique({
      where: { id: input.employeeId },
    });
    if (!employee) {
      throw new AppError(404, "not_found", "Employee not found");
    }
  }

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
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const raced = await prisma.accessCard.findUnique({
        where: { commandId: input.commandId },
        include: cardInclude,
      });
      if (raced) return { card: raced, idempotent: true };
    }
    throw err;
  }
}

export async function revokeCard(input: {
  cardId: string;
  actorEmployeeId?: string;
}): Promise<CardWithRelations> {
  const card = await prisma.accessCard.findUnique({
    where: { id: input.cardId },
  });
  if (!card) {
    throw new AppError(404, "not_found", "Card not found");
  }
  if (card.status === CardStatus.revoked) {
    throw new AppError(409, "invalid_state", "Card already revoked");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.accessCard.update({
      where: { id: input.cardId },
      data: { status: CardStatus.revoked },
      include: cardInclude,
    });
    await recordAudit(
      {
        actorEmployeeId: input.actorEmployeeId,
        action: "card.revoke",
        entityType: "card",
        entityId: input.cardId,
        before: { status: card.status },
        after: { status: CardStatus.revoked },
        summary: `Revoked ${card.cardType} card`,
      },
      tx,
    );
    return updated;
  });
}
