/**
 * Location catalog CRUD: find, create, update, archive/restore, QR payload,
 * and building/floor hierarchy for pickers.
 */
import {
  // Run next step: CatalogStatus,
  CatalogStatus,
  // Run next step: LocationKind,
  LocationKind,
  // Run next step: Occupancy,
  Occupancy,
  // Run next step: Prisma,
  Prisma,
  // Run next step: ServiceStatus,
  ServiceStatus,
// Run next step: } from "@prisma/client";
} from "@prisma/client";
// Import module ../../constants for this service.
import { OPEN_TICKET_STATUSES } from "../../constants";
// Import module ../../db for this service.
import { prisma } from "../../db";
// Import module ../../errors for this service.
import { AppError } from "../../errors";
// Import module ../../events/bus for this service.
import { publish } from "../../events/bus";
// Import module ../db/prismaErrors for this service.
import { isP2002 } from "../db/prismaErrors";
// Import module ../audit for this service.
import { recordAudit } from "../audit";
// Import module dependency for this service.
import {
  // Run next step: attachOpenIssueCounts,
  attachOpenIssueCounts,
  // Run next step: locationInclude,
  locationInclude,
  // Declare type LocationForMap for callers and internals.
  type LocationForMap,
// Run next step: } from "./types";
} from "./types";
// Import module ./pagination for this service.
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
  // Branch when this condition holds so the right path runs.
  if (requested == null || !Number.isFinite(requested)) {
    // Return the computed result to the caller.
    return DEFAULT_ACTIVE_LOCATION_LIMIT;
  }
  // Return the computed result to the caller.
  return Math.min(
    // Run next step: Math.max(1, Math.floor(requested)),
    Math.max(1, Math.floor(requested)),
    // Run next step: MAX_ACTIVE_LOCATION_LIMIT,
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
  // Set kind on the structure being built.
  kind: LocationKind,
  // Run next step: scopeFilter?: Prisma.LocationWhereInput,
  scopeFilter?: Prisma.LocationWhereInput,
  // Run next step: options?: { limit?: number; cursor?: string },
  options?: { limit?: number; cursor?: string },
// Run next step: ): Promise<{ rows: LocationForMap[]; truncated: boolean; nex…
): Promise<{ rows: LocationForMap[]; truncated: boolean; nextCursor: string | null }> {
  // Capture limit for use in this scope.
  const limit = resolveActiveLocationLimit(options?.limit);
  // Live board / room list — active catalog only.
  // scopeFilter ANDs with kind when the caller is sector-scoped.
  const rows = await prisma.location.findMany({
    // Set where on the structure being built.
    where: { AND: [{ catalogStatus: "active", kind }, scopeFilter ?? {}, activeLocationAfter(options?.cursor)] },
    // Set include on the structure being built.
    include: locationInclude,
    // Set orderBy on the structure being built.
    orderBy: [{ floor: { number: "asc" } }, { number: "asc" }, { id: "asc" }],
    // Set take on the structure being built.
    take: limit + 1,
  });
  // Capture truncated for use in this scope.
  const truncated = rows.length > limit;
  // Define page as a callable used by this flow.
  const page = (truncated ? rows.slice(0, limit) : rows) as LocationForMap[];
  // Capture ids for use in this scope.
  const ids = page.map((r) => r.id);
  // Capture grouped for use in this scope.
  const grouped =
    // Run next step: ids.length === 0
    ids.length === 0
      // Complete the ternary or optional chain started above.
      ? []
      // Complete the ternary or optional chain started above.
      : await prisma.maintenanceTicket.groupBy({
          // Set by on the structure being built.
          by: ["locationId", "blocksRoom"],
          // Set where on the structure being built.
          where: {
            // Set locationId on the structure being built.
            locationId: { in: ids },
            // Set status on the structure being built.
            status: { in: OPEN_TICKET_STATUSES },
          },
          // Set _count on the structure being built.
          _count: { _all: true },
        });
  // Load with counts asynchronously for the next steps.
  const withCounts = await attachOpenIssueCounts(page, grouped);
  // Return the computed result to the caller.
  return {
    // Set rows on the structure being built.
    rows: withCounts,
    // Run next step: truncated,
    truncated,
    // Set nextCursor on the structure being built.
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
    // Set where on the structure being built.
    where: { id },
    // Set include on the structure being built.
    include: locationInclude,
  });
  // Missing id → null (callers map to 404).
  if (!location) return null;
  // Optional kind guard so room routes cannot load common areas by id.
  if (kind && location.kind !== kind) return null;
  // Load grouped asynchronously for the next steps.
  const grouped = await prisma.maintenanceTicket.groupBy({
    // Set by on the structure being built.
    by: ["locationId", "blocksRoom"],
    // Set where on the structure being built.
    where: {
      // Set locationId on the structure being built.
      locationId: location.id,
      // Set status on the structure being built.
      status: { in: OPEN_TICKET_STATUSES },
    },
    // Set _count on the structure being built.
    _count: { _all: true },
  });
  // Load value asynchronously for the next steps.
  const [withCounts] = await attachOpenIssueCounts(
    // Run next step: [location as LocationForMap],
    [location as LocationForMap],
    // Run next step: grouped,
    grouped,
  );
  // Return the computed result to the caller.
  return withCounts;
}

/** Buildings → floors tree for location pickers / catalog UI. */
export async function getLocationHierarchy() {
  // All buildings with floors ordered for the catalog picker.
  const buildings = await prisma.building.findMany({
    // Set include on the structure being built.
    include: {
      // Set floors on the structure being built.
      floors: {
        // Set orderBy on the structure being built.
        orderBy: { number: "asc" },
        // Set select on the structure being built.
        select: { id: true, number: true, name: true },
      },
    },
    // Set orderBy on the structure being built.
    orderBy: { code: "asc" },
  });
  // Flatten to the compact picker DTO (no extra building fields).
  // Preserves building sort (code asc) and floor sort (number asc).
  return buildings.map((b) => ({
    // Set id on the structure being built.
    id: b.id,
    // Set name on the structure being built.
    name: b.name,
    // Set code on the structure being built.
    code: b.code,
    // Set floors on the structure being built.
    floors: b.floors.map((f) => ({
      // Set id on the structure being built.
      id: f.id,
      // Set number on the structure being built.
      number: f.number,
      // Set name on the structure being built.
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
  // Set include on the structure being built.
  include: typeof locationInclude;
// Run next step: }>;
}>;

// Declare type LocationsCatalogPage for callers and internals.
export type LocationsCatalogPage = {
  // Set items on the structure being built.
  items: CatalogLocationRow[];
  // Set page on the structure being built.
  page: number;
  // Set pageSize on the structure being built.
  pageSize: number;
  // Set total on the structure being built.
  total: number;
  // Set totalPages on the structure being built.
  totalPages: number;
};

// Define catalogBaseWhere — core behavior for this module.
function catalogBaseWhere(input: {
  // Run next step: kind?: LocationKind;
  kind?: LocationKind;
  // Run next step: includeArchived?: boolean;
  includeArchived?: boolean;
  // Run next step: scopeFilter?: Prisma.LocationWhereInput;
  scopeFilter?: Prisma.LocationWhereInput;
// Run next step: }): Prisma.LocationWhereInput {
}): Prisma.LocationWhereInput {
  // Return the computed result to the caller.
  return {
    // Set AND on the structure being built.
    AND: [
      // Run next step: input.scopeFilter ?? {},
      input.scopeFilter ?? {},
      // Run next step: input.kind ? { kind: input.kind } : {},
      input.kind ? { kind: input.kind } : {},
      // Run next step: input.includeArchived ? {} : { catalogStatus: CatalogStatus.…
      input.includeArchived ? {} : { catalogStatus: CatalogStatus.active },
    ],
  };
}

/** Number-only filter — friendly to GIN trgm on Location.number. */
function catalogNumberSearchWhere(q: string): Prisma.LocationWhereInput {
  // Return the computed result to the caller.
  return { number: { contains: q, mode: "insensitive" } };
}

/** Broader building/floor/number OR (may Seq Scan; used as fallback). */
function catalogBroadSearchWhere(q: string): Prisma.LocationWhereInput {
  // Return the computed result to the caller.
  return {
    // Set OR on the structure being built.
    OR: [
      // Run next step: { number: { contains: q, mode: "insensitive" } },
      { number: { contains: q, mode: "insensitive" } },
      // Run next step: {
      {
        // Set floor on the structure being built.
        floor: {
          // Set name on the structure being built.
          name: { contains: q, mode: "insensitive" },
        },
      },
      // Run next step: {
      {
        // Set floor on the structure being built.
        floor: {
          // Set building on the structure being built.
          building: {
            // Set OR on the structure being built.
            OR: [
              // Run next step: { code: { contains: q, mode: "insensitive" } },
              { code: { contains: q, mode: "insensitive" } },
              // Run next step: { name: { contains: q, mode: "insensitive" } },
              { name: { contains: q, mode: "insensitive" } },
            ],
          },
        },
      },
    ],
  };
}

// Define buildCatalogWhere — core behavior for this module.
function buildCatalogWhere(input: {
  // Run next step: kind?: LocationKind;
  kind?: LocationKind;
  // Run next step: includeArchived?: boolean;
  includeArchived?: boolean;
  // Run next step: scopeFilter?: Prisma.LocationWhereInput;
  scopeFilter?: Prisma.LocationWhereInput;
  // Run next step: q?: string;
  q?: string;
  /** When true with q, OR across building/floor (fallback path). */
  broadSearch?: boolean;
// Run next step: }): Prisma.LocationWhereInput {
}): Prisma.LocationWhereInput {
  // Capture q for use in this scope.
  const q = input.q?.trim();
  // Capture search for use in this scope.
  const search: Prisma.LocationWhereInput | undefined = q
    // Complete the ternary or optional chain started above.
    ? input.broadSearch
      // Complete the ternary or optional chain started above.
      ? catalogBroadSearchWhere(q)
      // Complete the ternary or optional chain started above.
      : catalogNumberSearchWhere(q)
    // Complete the ternary or optional chain started above.
    : undefined;
  // Return the computed result to the caller.
  return {
    // Set AND on the structure being built.
    AND: [catalogBaseWhere(input), search ?? {}],
  };
}

/** Same orderBy listLocationsCatalog uses — exported for EXPLAIN parity tests. */
export const catalogOrderBy: Prisma.LocationOrderByWithRelationInput[] = [
  // Run next step: { catalogStatus: "asc" },
  { catalogStatus: "asc" },
  // Run next step: { floor: { building: { code: "asc" } } },
  { floor: { building: { code: "asc" } } },
  // Run next step: { floor: { number: "asc" } },
  { floor: { number: "asc" } },
  // Run next step: { number: "asc" },
  { number: "asc" },
];

/**
 * Resolve the same where clause listLocationsCatalog uses (number-first, then
 * broad). Exported so perf tests can EXPLAIN the real Prisma findMany path.
 */
export async function resolveCatalogListWhere(input: {
  // Run next step: kind?: LocationKind;
  kind?: LocationKind;
  // Run next step: includeArchived?: boolean;
  includeArchived?: boolean;
  // Run next step: scopeFilter?: Prisma.LocationWhereInput;
  scopeFilter?: Prisma.LocationWhereInput;
  // Run next step: q?: string;
  q?: string;
// Run next step: }): Promise<Prisma.LocationWhereInput> {
}): Promise<Prisma.LocationWhereInput> {
  // Capture q for use in this scope.
  const q = input.q?.trim();
  // Capture where for use in this scope.
  let where = buildCatalogWhere({ ...input, broadSearch: false });
  // Branch when this condition holds so the right path runs.
  if (q) {
    // Load number hits asynchronously for the next steps.
    const numberHits = await prisma.location.count({ where });
    // Branch when this condition holds so the right path runs.
    if (numberHits === 0) {
      // Update where as control flow progresses.
      where = buildCatalogWhere({ ...input, broadSearch: true });
    }
  }
  // Return the computed result to the caller.
  return where;
}

/**
 * Paginated/filtered catalog list including archived when requested.
 * Pass `page` for server-side OFFSET pagination; omit for the legacy full list.
 */
export async function listLocationsCatalog(input: {
  // Run next step: kind?: LocationKind;
  kind?: LocationKind;
  // Run next step: includeArchived?: boolean;
  includeArchived?: boolean;
  // Run next step: scopeFilter?: Prisma.LocationWhereInput;
  scopeFilter?: Prisma.LocationWhereInput;
  // Run next step: q?: string;
  q?: string;
  // Run next step: page?: number;
  page?: number;
  // Run next step: pageSize?: number;
  pageSize?: number;
// Run next step: }): Promise<CatalogLocationRow[] | LocationsCatalogPage> {
}): Promise<CatalogLocationRow[] | LocationsCatalogPage> {
  // Load where asynchronously for the next steps.
  const where = await resolveCatalogListWhere(input);

  // Legacy unpaged callers (tests / older clients).
  if (input.page === undefined && input.pageSize === undefined) {
    // Return the computed result to the caller.
    return prisma.location.findMany({
      // Run next step: where,
      where,
      // Set include on the structure being built.
      include: locationInclude,
      // Set orderBy on the structure being built.
      orderBy: catalogOrderBy,
    });
  }

  // Capture page size for use in this scope.
  const pageSize = Math.min(
    // Run next step: Math.max(input.pageSize ?? CATALOG_PAGE_SIZE_DEFAULT, 1),
    Math.max(input.pageSize ?? CATALOG_PAGE_SIZE_DEFAULT, 1),
    // Run next step: CATALOG_PAGE_SIZE_MAX,
    CATALOG_PAGE_SIZE_MAX,
  );
  // Capture page for use in this scope.
  const page = Math.max(input.page ?? 1, 1);
  // Load value asynchronously for the next steps.
  const [total, items] = await Promise.all([
    // Persist or query via Prisma for durable state.
    prisma.location.count({ where }),
    // Persist or query via Prisma for durable state.
    prisma.location.findMany({
      // Run next step: where,
      where,
      // Set include on the structure being built.
      include: locationInclude,
      // Set orderBy on the structure being built.
      orderBy: catalogOrderBy,
      // Set skip on the structure being built.
      skip: (page - 1) * pageSize,
      // Set take on the structure being built.
      take: pageSize,
    }),
  ]);
  // Capture total pages for use in this scope.
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // Return the computed result to the caller.
  return {
    // Run next step: items,
    items,
    // Set page on the structure being built.
    page: Math.min(page, totalPages),
    // Run next step: pageSize,
    pageSize,
    // Run next step: total,
    total,
    // Run next step: totalPages,
    totalPages,
  };
}


/** 404 when the floor id is unknown (create/update target). */
async function assertFloorExists(floorId: string) {
  // Existence-only select — create/update target validation.
  const floor = await prisma.floor.findUnique({
    // Set where on the structure being built.
    where: { id: floorId },
    // Set select on the structure being built.
    select: { id: true },
  });
  // Branch when this condition holds so the right path runs.
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
      // Run next step: 409,
      409,
      // Run next step: "conflict",
      "conflict",
      // Run next step: "A location with this number already exists on that floor",
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
  // Set floorId on the structure being built.
  floorId: string;
  // Set number on the structure being built.
  number: string;
  // Run next step: kind?: LocationKind;
  kind?: LocationKind;
  // Run next step: occupancy?: Occupancy;
  occupancy?: Occupancy;
  // Run next step: serviceStatus?: ServiceStatus;
  serviceStatus?: ServiceStatus;
  // Run next step: actorEmployeeId?: string;
  actorEmployeeId?: string;
// Run next step: }) {
}) {
  // Trim and reject blank room/area numbers.
  const number = input.number.trim();
  // Branch when this condition holds so the right path runs.
  if (!number) {
    // Empty/whitespace room numbers are rejected at the service layer.
    throw new AppError(400, "validation", "number is required");
  }
  // Validate floor foreign key before insert.
  await assertFloorExists(input.floorId);
  // Default kind is room when the catalog form omits it.
  const kind = input.kind ?? LocationKind.room;

  // Attempt the fallible work so errors can be handled below.
  try {
    // Location row + audit share one transaction.
    const created = await prisma.$transaction(async (tx) => {
      // Common areas default vacant; rooms default unknown occupancy.
      const row = await tx.location.create({
        // Set data on the structure being built.
        data: {
          // Set floorId on the structure being built.
          floorId: input.floorId,
          // Run next step: number,
          number,
          // Run next step: kind,
          kind,
          // Set occupancy on the structure being built.
          occupancy:
            // Run next step: input.occupancy ??
            input.occupancy ??
            // Run next step: (kind === LocationKind.common_area
            (kind === LocationKind.common_area
              // Complete the ternary or optional chain started above.
              ? Occupancy.vacant
              // Complete the ternary or optional chain started above.
              : Occupancy.unknown),
          // Set serviceStatus on the structure being built.
          serviceStatus: input.serviceStatus ?? ServiceStatus.in_service,
        },
        // Set include on the structure being built.
        include: locationInclude,
      });
      // Wait for the async step before continuing.
      await recordAudit({
        // Set actorEmployeeId on the structure being built.
        actorEmployeeId: input.actorEmployeeId,
        // Set action on the structure being built.
        action: "location.create",
        // Set entityType on the structure being built.
        entityType: "location",
        // Set entityId on the structure being built.
        entityId: row.id,
        // Set locationId on the structure being built.
        locationId: row.id,
        // Set after on the structure being built.
        after: {
          // Set floorId on the structure being built.
          floorId: row.floorId,
          // Set number on the structure being built.
          number: row.number,
          // Set kind on the structure being built.
          kind: row.kind,
          // Set occupancy on the structure being built.
          occupancy: row.occupancy,
          // Set serviceStatus on the structure being built.
          serviceStatus: row.serviceStatus,
        },
        // Set summary on the structure being built.
        summary: `Created ${row.kind} ${row.number}`,
      // Run next step: }, tx);
      }, tx);
      // Return the computed result to the caller.
      return row;
    });
    // Live board refresh for the new location.
    publish("location.changed", { locationId: created.id });
    // Return the computed result to the caller.
    return created;
  // Run next step: } catch (err) {
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
  // Set id on the structure being built.
  id: string,
  // Set input on the structure being built.
  input: {
    // Run next step: floorId?: string;
    floorId?: string;
    // Run next step: number?: string;
    number?: string;
    // Run next step: kind?: LocationKind;
    kind?: LocationKind;
    // Run next step: actorEmployeeId?: string;
    actorEmployeeId?: string;
  },
// Run next step: ) {
) {
  // Load current row for before-snapshot and 404.
  const existing = await prisma.location.findUnique({ where: { id } });
  // Branch when this condition holds so the right path runs.
  if (!existing) {
    // Unknown location id — distinct from validation errors below.
    throw new AppError(404, "not_found", "Location not found");
  }
  // Validate new floor when the patch moves the location.
  if (input.floorId !== undefined) {
    // Wait for the async step before continuing.
    await assertFloorExists(input.floorId);
  }
  // Capture number for use in this scope.
  const number =
    // Run next step: input.number !== undefined ? input.number.trim() : undefined…
    input.number !== undefined ? input.number.trim() : undefined;
  // Explicit empty string after trim is invalid.
  if (number !== undefined && !number) {
    // Patch explicitly clearing number is invalid.
    throw new AppError(400, "validation", "number is required");
  }

  // Attempt the fallible work so errors can be handled below.
  try {
    // Patch + audit commit atomically.
    const updated = await prisma.$transaction(async (tx) => {
      // Partial patch of floor / number / kind only.
      const row = await tx.location.update({
        // Set where on the structure being built.
        where: { id },
        // Set data on the structure being built.
        data: {
          // Set floorId on the structure being built.
          floorId: input.floorId,
          // Run next step: number,
          number,
          // Set kind on the structure being built.
          kind: input.kind,
        },
        // Set include on the structure being built.
        include: locationInclude,
      });
      // Audit compact before/after of the mutable catalog fields.
      await recordAudit({
        // Set actorEmployeeId on the structure being built.
        actorEmployeeId: input.actorEmployeeId,
        // Set action on the structure being built.
        action: "location.update",
        // Set entityType on the structure being built.
        entityType: "location",
        // Set entityId on the structure being built.
        entityId: id,
        // Set locationId on the structure being built.
        locationId: id,
        // Set before on the structure being built.
        before: {
          // Set floorId on the structure being built.
          floorId: existing.floorId,
          // Set number on the structure being built.
          number: existing.number,
          // Set kind on the structure being built.
          kind: existing.kind,
        },
        // Set after on the structure being built.
        after: {
          // Set floorId on the structure being built.
          floorId: row.floorId,
          // Set number on the structure being built.
          number: row.number,
          // Set kind on the structure being built.
          kind: row.kind,
        },
        // Set summary on the structure being built.
        summary: `Updated location ${row.number}`,
      // Run next step: }, tx);
      }, tx);
      // Return the computed result to the caller.
      return row;
    });
    // Board subscribers pick up number/floor/kind changes.
    publish("location.changed", { locationId: updated.id });
    // Return the computed result to the caller.
    return updated;
  // Run next step: } catch (err) {
  } catch (err) {
    // Same P2002 mapping as create when number collides on a floor.
    conflictFromPrisma(err);
  }
}

