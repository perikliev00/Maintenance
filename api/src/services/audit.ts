/**
 * Append-only audit trail helpers: record events (optionally inside a
 * transaction) and list/filter them with data-scope constraints.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../db";

/** Prisma client or transaction client for writing audit rows atomically with domain changes. */
export type AuditDb = Prisma.TransactionClient | PrismaClient;

/** Fields for a single audit event row. */
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

/** Map JS null to Prisma JsonNull; leave undefined unset. */
function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  // Omit the column when the caller did not supply a value.
  if (value === undefined) return undefined;
  // Explicit null must become Prisma.JsonNull (JSON null in the column).
  if (value === null) return Prisma.JsonNull;
  // Otherwise store as JSON-compatible InputJsonValue.
  return value as Prisma.InputJsonValue;
}

/** Persist one audit event (pass `db` to join an existing transaction). */
export async function recordAudit(
  input: RecordAuditInput,
  db: AuditDb = prisma,
) {
  // Append-only insert; occurredAt defaults in schema when omitted.
  return db.auditEvent.create({
    data: {
      actorEmployeeId: input.actorEmployeeId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      // Empty/whitespace reason collapses to null.
      reason: input.reason?.trim() || null,
      before: toJson(input.before),
      after: toJson(input.after),
      locationId: input.locationId ?? null,
      summary: input.summary?.trim() || null,
      occurredAt: input.occurredAt,
    },
  });
}

/** Bulk-insert audit events; no-op when `rows` is empty. */
export async function recordAuditMany(
  rows: RecordAuditInput[],
  db: AuditDb = prisma,
) {
  // Avoid createMany with an empty array (some drivers dislike it).
  if (!rows.length) return { count: 0 };
  // Same field mapping as recordAudit, batched for throughput.
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

/** Query filters for {@link listAuditEvents}. */
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
  // Hotel-wide actors: no location/sector AND clause on the list query.
  if (scope.kind === "all") {
    return { scopeLocationIds: undefined, scopeSectorIds: undefined };
  }
  // Sector/assignee scopes: empty location list still restricts (sentinel path).
  return {
    scopeLocationIds: scopedLocationIds ?? [],
    // Only sector-kind scopes include sector entity rows without a locationId.
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
  // unrestricted (omit/null scopeLocationIds) → every event matches.
  if (scopeLocationIds === undefined || scopeLocationIds === null) {
    return true;
  }
  // Location-linked events must sit inside the scoped location set.
  if (event.locationId != null && scopeLocationIds.includes(event.locationId)) {
    return true;
  }
  // Sector entity rows (no locationId) match when sector id is in scope.
  if (
    event.locationId == null &&
    event.entityType === "sector" &&
    (scopeSectorIds?.length ?? 0) > 0 &&
    scopeSectorIds!.includes(event.entityId)
  ) {
    return true;
  }
  // Everything else is out of scope.
  return false;
}

/**
 * Prisma where for scoped audit listing. Empty location list uses a sentinel
 * id so no location-linked rows match; sector entity rows can still match via OR.
 */
export function buildAuditScopeWhere(
  scopeLocationIds: string[],
  scopeSectorIds: string[] = [],
): Prisma.AuditEventWhereInput {
  // Empty list must not mean "all locations" — use a non-matching sentinel.
  const locationIds =
    scopeLocationIds.length > 0 ? scopeLocationIds : ["__none__"];
  // Always allow events whose locationId is in the (possibly sentinel) set.
  const scopeOr: Prisma.AuditEventWhereInput[] = [
    { locationId: { in: locationIds } },
  ];
  // Optional OR branch for sector admin events without a location FK.
  if (scopeSectorIds.length) {
    scopeOr.push({
      locationId: null,
      entityType: "sector",
      entityId: { in: scopeSectorIds },
    });
  }
  return { OR: scopeOr };
}

/** Actor columns included on every audit list row. */
const actorSelect = {
  id: true,
  fullName: true,
  employeeNumber: true,
} as const;

/** Map a DB audit row (+ actor) to the API list shape. */
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
  // Pass-through DTO — keeps list and tests aligned on field names.
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

/**
 * List recent audit events newest-first. Limit is clamped to 1..200 (default 50).
 * When `scopeLocationIds` is set (including `[]`), results are restricted via
 * {@link buildAuditScopeWhere}; omit / null means unrestricted.
 */
export async function listAuditEvents(filter: ListAuditEventsFilter) {
  // Clamp page size: default 50, min 1, max 200.
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const where: Prisma.AuditEventWhereInput = {};

  // Optional exact entity / actor / action filters.
  if (filter.entityType) where.entityType = filter.entityType;
  if (filter.entityId) where.entityId = filter.entityId;
  // Prefix match overrides exact entityId when both are somehow present.
  if (filter.entityIdStartsWith) {
    where.entityId = { startsWith: filter.entityIdStartsWith };
  }
  if (filter.locationId) where.locationId = filter.locationId;
  if (filter.actorEmployeeId) where.actorEmployeeId = filter.actorEmployeeId;
  if (filter.action) where.action = filter.action;
  // Multi-action list wins over single action when provided.
  if (filter.actions?.length) where.action = { in: filter.actions };
  // Inclusive occurredAt window when from/to are set.
  if (filter.from || filter.to) {
    where.occurredAt = {};
    if (filter.from) where.occurredAt.gte = filter.from;
    if (filter.to) where.occurredAt.lte = filter.to;
  }

  // Data-scope AND: set (including []) restricts; omit/null leaves unrestricted.
  if (filter.scopeLocationIds !== undefined && filter.scopeLocationIds !== null) {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      buildAuditScopeWhere(
        filter.scopeLocationIds,
        filter.scopeSectorIds ?? [],
      ),
    ];
  }

  // Newest first for chronology UIs.
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
  "ticket.duplicate_override",
  "ticket.assign",
  "ticket.start",
  "ticket.wait",
  "ticket.resume",
  "ticket.resolve",
  "ticket.close",
  "ticket.reopen",
] as const;
