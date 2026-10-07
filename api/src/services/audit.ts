import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../db";

export type AuditDb = Prisma.TransactionClient | PrismaClient;

export type RecordAuditInput = {
  actorEmployeeId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  locationId?: string | null;
  summary?: string | null;
  occurredAt?: Date;
};

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

function isAuditDb(value: unknown): value is AuditDb {
  return !!value && typeof value === "object" && "auditEvent" in value;
}

export async function recordAudit(
  dbOrInput: AuditDb | RecordAuditInput,
  inputOrDb?: RecordAuditInput | AuditDb,
) {
  const db = isAuditDb(dbOrInput)
    ? dbOrInput
    : isAuditDb(inputOrDb)
      ? inputOrDb
      : prisma;
  const input = (isAuditDb(dbOrInput) ? inputOrDb : dbOrInput) as RecordAuditInput;
  return db.auditEvent.create({
    data: {
      actorEmployeeId: input.actorEmployeeId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      reason: input.reason?.trim() || null,
      before: toJson(input.before),
      after: toJson(input.after),
      locationId: input.locationId ?? null,
      summary: input.summary?.trim() || null,
      occurredAt: input.occurredAt,
    },
  });
}

export async function recordAuditMany(
  dbOrRows: AuditDb | RecordAuditInput[],
  rowsOrDb?: RecordAuditInput[] | AuditDb,
) {
  const db = isAuditDb(dbOrRows)
    ? dbOrRows
    : isAuditDb(rowsOrDb)
      ? rowsOrDb
      : prisma;
  const rows = (isAuditDb(dbOrRows) ? rowsOrDb : dbOrRows) as RecordAuditInput[];
  if (!rows.length) return { count: 0 };
  return db.auditEvent.createMany({
    data: rows.map((input) => ({
      actorEmployeeId: input.actorEmployeeId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      reason: input.reason?.trim() || null,
      before: toJson(input.before) as Prisma.InputJsonValue | undefined,
      after: toJson(input.after) as Prisma.InputJsonValue | undefined,
      locationId: input.locationId ?? null,
      summary: input.summary?.trim() || null,
      occurredAt: input.occurredAt,
    })),
  });
}

export type ListAuditEventsFilter = {
  entityType?: string;
  entityId?: string;
  entityIdStartsWith?: string;
  locationId?: string;
  actorEmployeeId?: string;
  action?: string;
  actions?: string[];
  from?: Date;
  to?: Date;
  limit?: number;
  /**
   * When set (including empty array), restrict results to these location IDs
   * and (for sector scope) sector entity rows whose entityId is in sectorIds.
   * Null locationId rows for other entity types are excluded.
   * Omit / null = unrestricted (only for kind=all actors).
   */
  scopeLocationIds?: string[] | null;
  scopeSectorIds?: string[];
};

/**
 * Build list-filter scope args from a DataScope. Non-`all` scopes never return
 * unrestricted (empty location list → no location rows match).
 */
export function auditScopeArgsFor(
  scope: { kind: string; sectorIds: string[] },
  scopedLocationIds: string[] | null,
): Pick<ListAuditEventsFilter, "scopeLocationIds" | "scopeSectorIds"> {
  if (scope.kind === "all") {
    return { scopeLocationIds: undefined, scopeSectorIds: undefined };
  }
  return {
    scopeLocationIds: scopedLocationIds ?? [],
    scopeSectorIds: scope.kind === "sectors" ? scope.sectorIds : [],
  };
}

/** Pure predicate mirroring listAuditEvents scope clause (for unit tests). */
export function auditEventMatchesScope(
  event: {
    locationId: string | null;
    entityType: string;
    entityId: string;
  },
  scopeLocationIds: string[] | null | undefined,
  scopeSectorIds?: string[],
): boolean {
  if (scopeLocationIds === undefined || scopeLocationIds === null) {
    return true;
  }
  if (event.locationId != null && scopeLocationIds.includes(event.locationId)) {
    return true;
  }
  if (
    event.locationId == null &&
    event.entityType === "sector" &&
    (scopeSectorIds?.length ?? 0) > 0 &&
    scopeSectorIds!.includes(event.entityId)
  ) {
    return true;
  }
  return false;
}

export function buildAuditScopeWhere(
  scopeLocationIds: string[],
  scopeSectorIds: string[] = [],
): Prisma.AuditEventWhereInput {
  const locationIds =
    scopeLocationIds.length > 0 ? scopeLocationIds : ["__none__"];
  const scopeOr: Prisma.AuditEventWhereInput[] = [
    { locationId: { in: locationIds } },
  ];
  if (scopeSectorIds.length) {
    scopeOr.push({
      locationId: null,
      entityType: "sector",
      entityId: { in: scopeSectorIds },
    });
  }
  return { OR: scopeOr };
}

const actorSelect = {
  id: true,
  fullName: true,
  employeeNumber: true,
} as const;

export function mapAuditEvent(row: {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  occurredAt: Date;
  reason: string | null;
  before: unknown;
  after: unknown;
  locationId: string | null;
  summary: string | null;
  actor: {
    id: string;
    fullName: string;
    employeeNumber: string;
  } | null;
}) {
  return {
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    occurredAt: row.occurredAt,
    reason: row.reason,
    before: row.before,
    after: row.after,
    locationId: row.locationId,
    summary: row.summary,
    actor: row.actor,
  };
}

export async function listAuditEvents(filter: ListAuditEventsFilter) {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const where: Prisma.AuditEventWhereInput = {};

  if (filter.entityType) where.entityType = filter.entityType;
  if (filter.entityId) where.entityId = filter.entityId;
  if (filter.entityIdStartsWith) {
    where.entityId = { startsWith: filter.entityIdStartsWith };
  }
  if (filter.locationId) where.locationId = filter.locationId;
  if (filter.actorEmployeeId) where.actorEmployeeId = filter.actorEmployeeId;
  if (filter.action) where.action = filter.action;
  if (filter.actions?.length) where.action = { in: filter.actions };
  if (filter.from || filter.to) {
    where.occurredAt = {};
    if (filter.from) where.occurredAt.gte = filter.from;
    if (filter.to) where.occurredAt.lte = filter.to;
  }

  if (filter.scopeLocationIds !== undefined && filter.scopeLocationIds !== null) {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      buildAuditScopeWhere(
        filter.scopeLocationIds,
        filter.scopeSectorIds ?? [],
      ),
    ];
  }

  const rows = await prisma.auditEvent.findMany({
    where,
    include: { actor: { select: actorSelect } },
    orderBy: { occurredAt: "desc" },
    take: limit,
  });

  return rows.map(mapAuditEvent);
}

/** Ops-relevant actions shown on the live board audit feed. */
export const LIVE_AUDIT_ACTIONS = [
  "cleaning.inspect",
  "cleaning.session.complete",
  "cleaning.task.create",
  "cleaning.task.reassign",
  "cleaning.task.start",
  "location.mark_dirty",
  "ticket.create",
  "ticket.assign",
  "ticket.start",
  "ticket.wait",
  "ticket.resume",
  "ticket.resolve",
  "ticket.close",
  "ticket.reopen",
] as const;
