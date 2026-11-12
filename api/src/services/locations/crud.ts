/**
 * Location catalog CRUD: find, create, update, archive/restore, QR payload,
 * and building/floor hierarchy for pickers.
 */
import {
  CatalogStatus,
  LocationKind,
  Occupancy,
  Prisma,
  ServiceStatus,
} from "@prisma/client";
import { OPEN_TICKET_STATUSES } from "../../constants";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { publish } from "../../events/bus";
import { isP2002 } from "../db/prismaErrors";
import { recordAudit } from "../audit";
import {
  attachOpenIssueCounts,
  locationInclude,
  // Declare type LocationForMap for callers and internals.
  type LocationForMap,
} from "./types";
import { activeLocationAfter, activeLocationCursor } from "./pagination";

/** Default cap for active board lists (SUS-001 / B3). Override via `?limit=`. */
export const DEFAULT_ACTIVE_LOCATION_LIMIT = 500;
/** Hard ceiling so clients cannot request an unbounded dump. */
export const MAX_ACTIVE_LOCATION_LIMIT = 2000;

/**
 * Clamp a requested board-list limit into `[1, MAX]` (default when missing/NaN).
 * Exported for unit tests (SUS-001 / B3).
 */
export function resolveActiveLocationLimit(requested?: number): number {
  if (requested == null || !Number.isFinite(requested)) {
    return DEFAULT_ACTIVE_LOCATION_LIMIT;
  }
  return Math.min(
    Math.max(1, Math.floor(requested)),
    MAX_ACTIVE_LOCATION_LIMIT,
  );
}

/**
 * Active locations of `kind`, optionally narrowed by data-scope filter.
 *
 * @param kind - room vs common_area board partition.
 * @param scopeFilter - Optional Prisma where AND from data scope.
 * @param options.limit - Page size (default 500, max 2000). Fetches limit+1 for continuation.
 * @param options.cursor - Opaque sort tuple from X-Next-Cursor; scope applies on every page.
 */
export async function findActiveLocations(
  kind: LocationKind,
  scopeFilter?: Prisma.LocationWhereInput,
  options?: { limit?: number; cursor?: string },
): Promise<{ rows: LocationForMap[]; truncated: boolean; nextCursor: string | null }> {
  const limit = resolveActiveLocationLimit(options?.limit);
  // Live board / room list — active catalog only.
  // scopeFilter ANDs with kind when the caller is sector-scoped.
  const rows = await prisma.location.findMany({
    where: { AND: [{ catalogStatus: "active", kind }, scopeFilter ?? {}, activeLocationAfter(options?.cursor)] },
    include: locationInclude,
    orderBy: [{ floor: { number: "asc" } }, { number: "asc" }, { id: "asc" }],
    take: limit + 1,
  });
  const truncated = rows.length > limit;
  const page = (truncated ? rows.slice(0, limit) : rows) as LocationForMap[];
  const ids = page.map((r) => r.id);
  const grouped =
    ids.length === 0
      // Complete the ternary or optional chain started above.
      ? []
      // Complete the ternary or optional chain started above.
      : await prisma.maintenanceTicket.groupBy({
          by: ["locationId", "blocksRoom"],
          where: {
            locationId: { in: ids },
            status: { in: OPEN_TICKET_STATUSES },
          },
          _count: { _all: true },
        });
  // Load with counts asynchronously for the next steps.
  const withCounts = await attachOpenIssueCounts(page, grouped);
  return {
    rows: withCounts,
    truncated,
    nextCursor: truncated ? activeLocationCursor(rows[limit - 1]) : null,
  };
}

/**
 * Load one location with board includes; null if missing or kind mismatch.
 *
 * @param id - Location primary key.
 * @param kind - When set, returns null if the row kind differs.
 */
export async function findLocationById(id: string, kind?: LocationKind) {
  // Full board include (task, tickets, sector, floor).
  const location = await prisma.location.findUnique({
    where: { id },
    include: locationInclude,
  });
  // Missing id → null (callers map to 404).
  if (!location) return null;
  // Optional kind guard so room routes cannot load common areas by id.
  if (kind && location.kind !== kind) return null;
  const grouped = await prisma.maintenanceTicket.groupBy({
    by: ["locationId", "blocksRoom"],
    where: {
      locationId: location.id,
      status: { in: OPEN_TICKET_STATUSES },
    },
    _count: { _all: true },
  });
  const [withCounts] = await attachOpenIssueCounts(
    [location as LocationForMap],
    grouped,
  );
  return withCounts;
}

/** Buildings → floors tree for location pickers / catalog UI. */
export async function getLocationHierarchy() {
  // All buildings with floors ordered for the catalog picker.
  const buildings = await prisma.building.findMany({
    include: {
      floors: {
        orderBy: { number: "asc" },
        select: { id: true, number: true, name: true },
      },
    },
    orderBy: { code: "asc" },
  });
  // Flatten to the compact picker DTO (no extra building fields).
  // Preserves building sort (code asc) and floor sort (number asc).
  return buildings.map((b) => ({
    id: b.id,
    name: b.name,
    code: b.code,
    floors: b.floors.map((f) => ({
      id: f.id,
      number: f.number,
      name: f.name,
    })),
  }));
}

// Capture catalog page size default for use in this scope.
const CATALOG_PAGE_SIZE_DEFAULT = 25;
// Capture catalog page size max for use in this scope.
const CATALOG_PAGE_SIZE_MAX = 100;

// Declare type CatalogLocationRow for callers and internals.
type CatalogLocationRow = Prisma.LocationGetPayload<{
  include: typeof locationInclude;
}>;

// Declare type LocationsCatalogPage for callers and internals.
export type LocationsCatalogPage = {
  items: CatalogLocationRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

function catalogBaseWhere(input: {
  kind?: LocationKind;
  includeArchived?: boolean;
  scopeFilter?: Prisma.LocationWhereInput;
}): Prisma.LocationWhereInput {
  return {
    AND: [
      input.scopeFilter ?? {},
      input.kind ? { kind: input.kind } : {},
      input.includeArchived ? {} : { catalogStatus: CatalogStatus.active },
    ],
  };
}

/** Number-only filter — friendly to GIN trgm on Location.number. */
function catalogNumberSearchWhere(q: string): Prisma.LocationWhereInput {
  return { number: { contains: q, mode: "insensitive" } };
}

/** Broader building/floor/number OR (may Seq Scan; used as fallback). */
function catalogBroadSearchWhere(q: string): Prisma.LocationWhereInput {
  return {
    OR: [
      { number: { contains: q, mode: "insensitive" } },
      {
        floor: {
          name: { contains: q, mode: "insensitive" },
        },
      },
      {
        floor: {
          building: {
            OR: [
              { code: { contains: q, mode: "insensitive" } },
              { name: { contains: q, mode: "insensitive" } },
            ],
          },
        },
      },
    ],
  };
}

function buildCatalogWhere(input: {
  kind?: LocationKind;
  includeArchived?: boolean;
  scopeFilter?: Prisma.LocationWhereInput;
  q?: string;
  /** When true with q, OR across building/floor (fallback path). */
  broadSearch?: boolean;
}): Prisma.LocationWhereInput {
  const q = input.q?.trim();
  const search: Prisma.LocationWhereInput | undefined = q
    // Complete the ternary or optional chain started above.
    ? input.broadSearch
      // Complete the ternary or optional chain started above.
      ? catalogBroadSearchWhere(q)
      // Complete the ternary or optional chain started above.
      : catalogNumberSearchWhere(q)
    // Complete the ternary or optional chain started above.
    : undefined;
  return {
    AND: [catalogBaseWhere(input), search ?? {}],
  };
}

/** Same orderBy listLocationsCatalog uses — exported for EXPLAIN parity tests. */
export const catalogOrderBy: Prisma.LocationOrderByWithRelationInput[] = [
  { catalogStatus: "asc" },
  { floor: { building: { code: "asc" } } },
  { floor: { number: "asc" } },
  { number: "asc" },
];

/**
 * Resolve the same where clause listLocationsCatalog uses (number-first, then
 * broad). Exported so perf tests can EXPLAIN the real Prisma findMany path.
 */
export async function resolveCatalogListWhere(input: {
  kind?: LocationKind;
  includeArchived?: boolean;
  scopeFilter?: Prisma.LocationWhereInput;
  q?: string;
}): Promise<Prisma.LocationWhereInput> {
  const q = input.q?.trim();
  let where = buildCatalogWhere({ ...input, broadSearch: false });
  if (q) {
    // Load number hits asynchronously for the next steps.
    const numberHits = await prisma.location.count({ where });
    if (numberHits === 0) {
      where = buildCatalogWhere({ ...input, broadSearch: true });
    }
  }
  return where;
}

/**
 * Paginated/filtered catalog list including archived when requested.
 * Pass `page` for server-side OFFSET pagination; omit for the legacy full list.
 */
export async function listLocationsCatalog(input: {
  kind?: LocationKind;
  includeArchived?: boolean;
  scopeFilter?: Prisma.LocationWhereInput;
  q?: string;
  page?: number;
  pageSize?: number;
}): Promise<CatalogLocationRow[] | LocationsCatalogPage> {
  const where = await resolveCatalogListWhere(input);

  // Legacy unpaged callers (tests / older clients).
  if (input.page === undefined && input.pageSize === undefined) {
    return prisma.location.findMany({
      where,
      include: locationInclude,
      orderBy: catalogOrderBy,
    });
  }

  // Capture page size for use in this scope.
  const pageSize = Math.min(
    Math.max(input.pageSize ?? CATALOG_PAGE_SIZE_DEFAULT, 1),
    CATALOG_PAGE_SIZE_MAX,
  );
  const page = Math.max(input.page ?? 1, 1);
  const [total, items] = await Promise.all([
    // Persist or query via Prisma for durable state.
    prisma.location.count({ where }),
    // Persist or query via Prisma for durable state.
    prisma.location.findMany({
      where,
      include: locationInclude,
      orderBy: catalogOrderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  // Capture total pages for use in this scope.
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    items,
    page: Math.min(page, totalPages),
    pageSize,
    total,
    totalPages,
  };
}


/** 404 when the floor id is unknown (create/update target). */
async function assertFloorExists(floorId: string) {
  // Existence-only select — create/update target validation.
  const floor = await prisma.floor.findUnique({
    where: { id: floorId },
    select: { id: true },
  });
  if (!floor) {
    // floorId on create/update must reference an existing floor row.
    throw new AppError(404, "not_found", "Floor not found");
  }
}

/** Map unique (floorId, number) violations to a friendly 409. */
function conflictFromPrisma(err: unknown): never {
  // Unique (floorId, number) → conflict; anything else rethrows unchanged.
  if (isP2002(err)) {
    // @@unique([floorId, number]) on Location.
    throw new AppError(
      409,
      "conflict",
      "A location with this number already exists on that floor",
    );
  }
  // Non-unique violations propagate unchanged.
  throw err;
}

/**
 * Create a location on a floor; audits the create.
 *
 * @param input.floorId - Parent floor foreign key.
 * @param input.number - Room/area number unique per floor.
 * @param input.kind - Defaults to room when omitted.
 * @param input.actorEmployeeId - Optional audit actor.
 */
export async function createLocation(input: {
  floorId: string;
  number: string;
  kind?: LocationKind;
  occupancy?: Occupancy;
  serviceStatus?: ServiceStatus;
  actorEmployeeId?: string;
}) {
  // Trim and reject blank room/area numbers.
  const number = input.number.trim();
  if (!number) {
    // Empty/whitespace room numbers are rejected at the service layer.
    throw new AppError(400, "validation", "number is required");
  }
  // Validate floor foreign key before insert.
  await assertFloorExists(input.floorId);
  // Default kind is room when the catalog form omits it.
  const kind = input.kind ?? LocationKind.room;

  try {
    // Location row + audit share one transaction.
    const created = await prisma.$transaction(async (tx) => {
      // Common areas default vacant; rooms default unknown occupancy.
      const row = await tx.location.create({
        data: {
          floorId: input.floorId,
          number,
          kind,
          occupancy:
            input.occupancy ??
            (kind === LocationKind.common_area
              // Complete the ternary or optional chain started above.
              ? Occupancy.vacant
              // Complete the ternary or optional chain started above.
              : Occupancy.unknown),
          serviceStatus: input.serviceStatus ?? ServiceStatus.in_service,
        },
        include: locationInclude,
      });
      await recordAudit({
        actorEmployeeId: input.actorEmployeeId,
        action: "location.create",
        entityType: "location",
        entityId: row.id,
        locationId: row.id,
        after: {
          floorId: row.floorId,
          number: row.number,
          kind: row.kind,
          occupancy: row.occupancy,
          serviceStatus: row.serviceStatus,
        },
        summary: `Created ${row.kind} ${row.number}`,
      }, tx);
      return row;
    });
    // Live board refresh for the new location.
    publish("location.changed", { locationId: created.id });
    return created;
  } catch (err) {
    // Unique number-on-floor → 409; other errors propagate.
    conflictFromPrisma(err);
  }
}

/**
 * Update mutable location fields; audits before/after.
 *
 * @param id - Location primary key.
 * @param input - Partial patch of floorId/number/kind only.
 */
export async function updateLocation(
  id: string,
  input: {
    floorId?: string;
    number?: string;
    kind?: LocationKind;
    actorEmployeeId?: string;
  },
) {
  // Load current row for before-snapshot and 404.
  const existing = await prisma.location.findUnique({ where: { id } });
  if (!existing) {
    // Unknown location id — distinct from validation errors below.
    throw new AppError(404, "not_found", "Location not found");
  }
  // Validate new floor when the patch moves the location.
  if (input.floorId !== undefined) {
    await assertFloorExists(input.floorId);
  }
  const number =
    input.number !== undefined ? input.number.trim() : undefined;
  // Explicit empty string after trim is invalid.
  if (number !== undefined && !number) {
    // Patch explicitly clearing number is invalid.
    throw new AppError(400, "validation", "number is required");
  }

  try {
    // Patch + audit commit atomically.
    const updated = await prisma.$transaction(async (tx) => {
      // Partial patch of floor / number / kind only.
      const row = await tx.location.update({
        where: { id },
        data: {
          floorId: input.floorId,
          number,
          kind: input.kind,
        },
        include: locationInclude,
      });
      // Audit compact before/after of the mutable catalog fields.
      await recordAudit({
        actorEmployeeId: input.actorEmployeeId,
        action: "location.update",
        entityType: "location",
        entityId: id,
        locationId: id,
        before: {
          floorId: existing.floorId,
          number: existing.number,
          kind: existing.kind,
        },
        after: {
          floorId: row.floorId,
          number: row.number,
          kind: row.kind,
        },
        summary: `Updated location ${row.number}`,
      }, tx);
      return row;
    });
    // Board subscribers pick up number/floor/kind changes.
    publish("location.changed", { locationId: updated.id });
    return updated;
  } catch (err) {
    // Same P2002 mapping as create when number collides on a floor.
    conflictFromPrisma(err);
  }
}

