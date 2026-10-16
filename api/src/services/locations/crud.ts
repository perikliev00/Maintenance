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
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { publish } from "../../events/bus";
import { recordAudit } from "../audit";
import { locationInclude } from "./types";

/**
 * Active locations of `kind`, optionally narrowed by data-scope filter.
 *
 * @param kind - room vs common_area board partition.
 * @param scopeFilter - Optional Prisma where AND from data scope.
 */
export async function findActiveLocations(
  kind: LocationKind,
  scopeFilter?: Prisma.LocationWhereInput,
) {
  // Live board / room list — active catalog only.
  // scopeFilter ANDs with kind when the caller is sector-scoped.
  return prisma.location.findMany({
    where: { catalogStatus: "active", kind, ...(scopeFilter ?? {}) },
    include: locationInclude,
    orderBy: [{ floor: { number: "asc" } }, { number: "asc" }],
  });
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
  // Happy path — location matches optional kind filter.
  return location;
}

/**
 * Resolve a location by its QR token (room scan entrypoint).
 *
 * @param token - Unique qrToken column value from the printed QR.
 */
export async function findLocationByQrToken(token: string) {
  // Unique qrToken index — used by the room-scan deep link.
  return prisma.location.findUnique({
    where: { qrToken: token },
    include: locationInclude,
  });
}

/**
 * Client QR payload including deep-link scan URL under WEB_ORIGIN.
 *
 * @param location - Row subset with floor/building joins for labeling.
 */
export function locationQrPayload(location: {
  id: string;
  qrToken: string;
  number: string;
  kind: LocationKind;
  floor: { number: number; building: { code: string } };
}) {
  // Strip trailing slash from WEB_ORIGIN; default to Vite dev origin.
  const origin =
    process.env.WEB_ORIGIN?.replace(/\/$/, "") || "http://localhost:5173";
  // Hash-routed scan URL consumed by the PWA room-QR entrypoint.
  const scanUrl = `${origin}/#/room-qr/${location.qrToken}`;
  // Compact payload for QR renderers and admin copy buttons.
  return {
    locationId: location.id,
    qrToken: location.qrToken,
    scanUrl,
    label: `${location.floor.building.code} ${location.number}`,
    kind: location.kind,
    buildingCode: location.floor.building.code,
    floor: location.floor.number,
    number: location.number,
  };
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

/**
 * Paginated/filtered catalog list including archived when requested.
 *
 * @param input.kind - Optional kind filter for room vs common area admin.
 * @param input.includeArchived - When false, active catalogStatus only.
 * @param input.scopeFilter - Data-scope AND for sector-limited admins.
 */
export async function listLocationsCatalog(input: {
  kind?: LocationKind;
  includeArchived?: boolean;
  scopeFilter?: Prisma.LocationWhereInput;
}) {
  // Default hides archived; admin catalog can pass includeArchived.
  const where: Prisma.LocationWhereInput = {
    ...(input.scopeFilter ?? {}),
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.includeArchived
      ? {}
      : { catalogStatus: CatalogStatus.active }),
  };
  // Active first, then building/floor/number for stable catalog browsing.
  // includeArchived skips the active-only catalogStatus filter.
  return prisma.location.findMany({
    where,
    include: locationInclude,
    orderBy: [
      { catalogStatus: "asc" },
      { floor: { building: { code: "asc" } } },
      { floor: { number: "asc" } },
      { number: "asc" },
    ],
  });
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
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
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
 * Create a location on a floor with a unique qrToken; audits the create.
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
              ? Occupancy.vacant
              : Occupancy.unknown),
          serviceStatus: input.serviceStatus ?? ServiceStatus.in_service,
        },
        include: locationInclude,
      });
      // qrToken is generated by Prisma @default(cuid()) on the model.
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
          ...(input.floorId !== undefined ? { floorId: input.floorId } : {}),
          ...(number !== undefined ? { number } : {}),
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
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

/**
 * Soft-archive (catalogStatus=archived) and audit.
 *
 * @param id - Location primary key.
 * @param actorEmployeeId - Optional audit actor.
 */
export async function archiveLocation(id: string, actorEmployeeId?: string) {
  const existing = await prisma.location.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, "not_found", "Location not found");
  }
  // Idempotent: already archived → return full row without re-auditing.
  if (existing.catalogStatus === CatalogStatus.archived) {
    // Reload with board includes for a consistent API shape.
    const full = await findLocationById(id);
    return full!;
  }

  // Soft-archive + audit in one transaction.
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.location.update({
      where: { id },
      data: { catalogStatus: CatalogStatus.archived },
      include: locationInclude,
    });
    await recordAudit({
      actorEmployeeId,
      action: "location.archive",
      entityType: "location",
      entityId: id,
      locationId: id,
      before: { catalogStatus: existing.catalogStatus },
      after: { catalogStatus: CatalogStatus.archived },
      summary: `Archived location ${row.number}`,
    }, tx);
    return row;
  });
  publish("location.changed", { locationId: updated.id });
  return updated;
}

/**
 * Restore an archived location to active and audit.
 *
 * @param id - Location primary key.
 * @param actorEmployeeId - Optional audit actor.
 */
export async function restoreLocation(id: string, actorEmployeeId?: string) {
  const existing = await prisma.location.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, "not_found", "Location not found");
  }
  // Idempotent: already active → return without audit.
  if (existing.catalogStatus === CatalogStatus.active) {
    // Full include graph for catalog/detail responses.
    const full = await findLocationById(id);
    return full!;
  }

  // Restore to active + audit in one transaction.
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.location.update({
      where: { id },
      data: { catalogStatus: CatalogStatus.active },
      include: locationInclude,
    });
    await recordAudit({
      actorEmployeeId,
      action: "location.restore",
      entityType: "location",
      entityId: id,
      locationId: id,
      before: { catalogStatus: existing.catalogStatus },
      after: { catalogStatus: CatalogStatus.active },
      summary: `Restored location ${row.number}`,
    }, tx);
    return row;
  });
  publish("location.changed", { locationId: updated.id });
  return updated;
}
