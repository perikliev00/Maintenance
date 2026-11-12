/**
 * Append-only audit trail helpers: record events (optionally inside a
 * transaction) and list/filter them with data-scope constraints.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
// Shared Prisma client singleton.
import { prisma } from "../db";

/** Prisma client or transaction client for writing audit rows atomically with domain changes. */
export type AuditDb = Prisma.TransactionClient | PrismaClient;

/** Fields for a single audit event row. */
export type RecordAuditInput = {
  // Time field actorEmployeeId.
  actorEmployeeId?: string | null;
  // Field action on this type/payload.
  action: string;
  // Field entityType on this type/payload.
  entityType: string;
  // Field entityId on this type/payload.
  entityId: string;
  // Optional reason.
  reason?: string | null;
  // Time field before.
  before?: unknown;
  // Time field after.
  after?: unknown;
  // Optional locationId.
  locationId?: string | null;
  // Optional summary.
  summary?: string | null;
  // Time field occurredAt.
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
  // Param input required by this function.
  input: RecordAuditInput,
  // Param db required by this function.
  db: AuditDb = prisma,
) {
  // Append-only insert; occurredAt defaults in schema when omitted.
  return db.auditEvent.create({
    // Mutation data payload.
    data: {
      // Time field actorEmployeeId.
      actorEmployeeId: input.actorEmployeeId ?? null,
      // Field action on this type/payload.
      action: input.action,
      // Field entityType on this type/payload.
      entityType: input.entityType,
      // Field entityId on this type/payload.
      entityId: input.entityId,
      // Empty/whitespace reason collapses to null.
      reason: input.reason?.trim() || null,
      // Time field before.
      before: toJson(input.before),
      // Time field after.
      after: toJson(input.after),
      // Field locationId on this type/payload.
      locationId: input.locationId ?? null,
      // Field summary on this type/payload.
      summary: input.summary?.trim() || null,
      // Time field occurredAt.
      occurredAt: input.occurredAt,
    },
  });
}

/** Bulk-insert audit events; no-op when `rows` is empty. */
export async function recordAuditMany(
  // Param rows required by this function.
  rows: RecordAuditInput[],
  // Param db required by this function.
  db: AuditDb = prisma,
) {
  // Avoid createMany with an empty array (some drivers dislike it).
  if (!rows.length) return { count: 0 };
  // Same field mapping as recordAudit, batched for throughput.
  return db.auditEvent.createMany({
    // Mutation data payload.
    data: rows.map((input) => ({
      // Set actorEmployeeId.
      actorEmployeeId: input.actorEmployeeId ?? null,
      // Set action.
      action: input.action,
      // Set entityType.
      entityType: input.entityType,
      // Set entityId.
      entityId: input.entityId,
      // Set reason.
      reason: input.reason?.trim() || null,
      // Set before.
      before: toJson(input.before) as Prisma.InputJsonValue | undefined,
      // Set after.
      after: toJson(input.after) as Prisma.InputJsonValue | undefined,
      // Set locationId.
      locationId: input.locationId ?? null,
      // Set summary.
      summary: input.summary?.trim() || null,
      // Set occurredAt.
      occurredAt: input.occurredAt,
    })),
  });
}

/** Query filters for {@link listAuditEvents}. */
export type ListAuditEventsFilter = {
  // Optional entityType.
  entityType?: string;
  // Optional entityId.
  entityId?: string;
  // Optional entityIdStartsWith.
  entityIdStartsWith?: string;
  // Optional locationId.
  locationId?: string;
  // Time field actorEmployeeId.
  actorEmployeeId?: string;
  // Optional action.
  action?: string;
  // Optional actions.
  actions?: string[];
  // Time field from.
  from?: Date;
  // Time field to.
  to?: Date;
  // Optional limit.
  limit?: number;
  /**
   * When set (including empty array), restrict results to these location IDs
   * and (for sector scope) sector entity rows whose entityId is in sectorIds.
   * Null locationId rows for other entity types are excluded.
   * Omit / null = unrestricted (only for kind=all actors).
   */
  scopeLocationIds?: string[] | null;
  // Time field scopeSectorIds.
  scopeSectorIds?: string[];
};

/**
 * Build list-filter scope args from a DataScope. Non-`all` scopes never return
 * unrestricted (empty location list → no location rows match).
 */
export function auditScopeArgsFor(
  // Param scope required by this function.
  scope: { kind: string; sectorIds: string[] },
  // Param scopedLocationIds required by this function.
  scopedLocationIds: string[] | null,
): Pick<ListAuditEventsFilter, "scopeLocationIds" | "scopeSectorIds"> {
  // Hotel-wide actors: no location/sector AND clause on the list query.
  if (scope.kind === "all") {
    // Return response object.
    return { scopeLocationIds: undefined, scopeSectorIds: undefined };
  }
  // Sector/assignee scopes: empty location list still restricts (sentinel path).
  return {
    // Set scopeLocationIds.
    scopeLocationIds: scopedLocationIds ?? [],
    // Only sector-kind scopes include sector entity rows without a locationId.
    scopeSectorIds: scope.kind === "sectors" ? scope.sectorIds : [],
  };
}

/** Pure predicate mirroring listAuditEvents scope clause (for unit tests). */
export function auditEventMatchesScope(
  // Param event required by this function.
  event: {
    // Param locationId required by this function.
    locationId: string | null;
    // Param entityType required by this function.
    entityType: string;
    // Param entityId required by this function.
    entityId: string;
  },
  // Param scopeLocationIds required by this function.
  scopeLocationIds: string[] | null | undefined,
  // Param scopeSectorIds required by this function.
  scopeSectorIds?: string[],
): boolean {
  // unrestricted (omit/null scopeLocationIds) → every event matches.
  if (scopeLocationIds === undefined || scopeLocationIds === null) {
    // Return computed result.
    return true;
  }
  // Location-linked events must sit inside the scoped location set.
  if (event.locationId != null && scopeLocationIds.includes(event.locationId)) {
    // Return computed result.
    return true;
  }
  // Sector entity rows (no locationId) match when sector id is in scope.
  if (
    // Additional clause in this boolean decision.
    event.locationId == null &&
    // Additional clause in this boolean decision.
    event.entityType === "sector" &&
    // Additional clause in this boolean decision.
    (scopeSectorIds?.length ?? 0) > 0 &&
    // Support the surrounding control flow.
    scopeSectorIds!.includes(event.entityId)
  ) {
    // Return computed result.
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
  // Param scopeLocationIds required by this function.
  scopeLocationIds: string[],
  // Param scopeSectorIds required by this function.
  scopeSectorIds: string[] = [],
): Prisma.AuditEventWhereInput {
  // Empty list must not mean "all locations" — use a non-matching sentinel.
  const locationIds =
    // Support the surrounding control flow.
    scopeLocationIds.length > 0 ? scopeLocationIds : ["__none__"];
  // Always allow events whose locationId is in the (possibly sentinel) set.
  const scopeOr: Prisma.AuditEventWhereInput[] = [
    // Support the surrounding control flow.
    { locationId: { in: locationIds } },
  ];
  // Optional OR branch for sector admin events without a location FK.
  if (scopeSectorIds.length) {
    // Support the surrounding control flow.
    scopeOr.push({
      // Set locationId.
      locationId: null,
      // Set entityType.
      entityType: "sector",
      // Set entityId.
      entityId: { in: scopeSectorIds },
    });
  }
  // Return response object.
  return { OR: scopeOr };
}

/** Actor columns included on every audit list row. */
const actorSelect = {
  // Field id on this type/payload.
  id: true,
  // Field fullName on this type/payload.
  fullName: true,
  // Field employeeNumber on this type/payload.
  employeeNumber: true,
// Support the surrounding control flow.
} as const;

/** Map a DB audit row (+ actor) to the API list shape. */
export function mapAuditEvent(row: {
  // Param id required by this function.
  id: string;
  // Param action required by this function.
  action: string;
  // Param entityType required by this function.
  entityType: string;
  // Param entityId required by this function.
  entityId: string;
  // Param occurredAt required by this function.
  occurredAt: Date;
  // Param reason required by this function.
  reason: string | null;
  // Param before required by this function.
  before: unknown;
  // Param after required by this function.
  after: unknown;
  // Param locationId required by this function.
  locationId: string | null;
  // Param summary required by this function.
  summary: string | null;
  // Param actor required by this function.
  actor: {
    // Param id required by this function.
    id: string;
    // Param fullName required by this function.
    fullName: string;
    // Param employeeNumber required by this function.
    employeeNumber: string;
  // Support the surrounding control flow.
  } | null;
// Support the surrounding control flow.
}) {
  // Pass-through DTO — keeps list and tests aligned on field names.
  return {
    // Param id required by this function.
    id: row.id,
    // Param action required by this function.
    action: row.action,
    // Param entityType required by this function.
    entityType: row.entityType,
    // Param entityId required by this function.
    entityId: row.entityId,
    // Param occurredAt required by this function.
    occurredAt: row.occurredAt,
    // Param reason required by this function.
    reason: row.reason,
    // Param before required by this function.
    before: row.before,
    // Param after required by this function.
    after: row.after,
    // Param locationId required by this function.
    locationId: row.locationId,
    // Param summary required by this function.
    summary: row.summary,
    // Param actor required by this function.
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
  // Accumulator object where.
  const where: Prisma.AuditEventWhereInput = {};

  // Optional exact entity / actor / action filters.
  if (filter.entityType) where.entityType = filter.entityType;
  // Conditional path for this guard.
  if (filter.entityId) where.entityId = filter.entityId;
  // Prefix match overrides exact entityId when both are somehow present.
  if (filter.entityIdStartsWith) {
    // Assign where.entityId.
    where.entityId = { startsWith: filter.entityIdStartsWith };
  }
  // Conditional path for this guard.
  if (filter.locationId) where.locationId = filter.locationId;
  // Conditional path for this guard.
  if (filter.actorEmployeeId) where.actorEmployeeId = filter.actorEmployeeId;
  // Conditional path for this guard.
  if (filter.action) where.action = filter.action;
  // Multi-action list wins over single action when provided.
  if (filter.actions?.length) where.action = { in: filter.actions };
  // Inclusive occurredAt window when from/to are set.
  if (filter.from || filter.to) {
    // Assign where.occurredAt.
    where.occurredAt = {};
    // Conditional path for this guard.
    if (filter.from) where.occurredAt.gte = filter.from;
    // Conditional path for this guard.
    if (filter.to) where.occurredAt.lte = filter.to;
  }

  // Data-scope AND: set (including []) restricts; omit/null leaves unrestricted.
  if (filter.scopeLocationIds !== undefined && filter.scopeLocationIds !== null) {
    // Assign where.AND.
    where.AND = [
      // Spread additional fields/filters.
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      // Invoke buildAuditScopeWhere.
      buildAuditScopeWhere(
        // Support the surrounding control flow.
        filter.scopeLocationIds,
        // Support the surrounding control flow.
        filter.scopeSectorIds ?? [],
      ),
    ];
  }

  // Newest first for chronology UIs.
  const rows = await prisma.auditEvent.findMany({
    where,
    // Include relations for labels/checks.
    include: { actor: { select: actorSelect } },
    // Stable sort for paging.
    orderBy: { occurredAt: "desc" },
    // Page size limit.
    take: limit,
  });

  // Return computed result.
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
// Support the surrounding control flow.
] as const;
