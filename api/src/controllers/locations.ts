/**
 * Location catalog admin handlers: hierarchy, CRUD-ish updates, occupancy /
 * service status, archive/restore. Most mutations assert DataScope access.
 */
import type { NextFunction, Request, Response } from "express";
import { z } from "zod/v3";
import {
  LocationKind,
  Occupancy,
  ServiceStatus,
} from "@prisma/client";
import {
  locationWhere,
  resolveDataScope,
} from "../services/dataScope";
import { recordAudit } from "../services/audit";
import {
  archiveLocation,
  createLocation,
  getLocationHierarchy,
  listLocationsCatalog,
  loadScopedLocation,
  mapLocation,
  reconcileOrphanCleaningStatusForLocation,
  restoreLocation,
  setLocationOccupancy,
  setLocationServiceStatus,
  updateLocation,
  findLocationById,
} from "../services/locations";

// Zod field / transform.
const kindSchema = z.enum(["room", "common_area"]);
// Zod field / transform.
const occupancySchema = z.enum(["vacant", "occupied", "unknown"]);
// Zod field / transform.
const serviceStatusSchema = z.enum([
  "in_service",
  "out_of_service",
  "unknown",
]);

/** GET /locations/hierarchy — building/floor/room tree for admin UI. */
export async function hierarchy(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  // JSON success response.
  return res.json(await getLocationHierarchy());
}

/** GET /locations — catalog list with optional kind / includeArchived / pagination. */
export async function list(req: Request, res: Response) {
  const kindParsed = kindSchema.optional().safeParse(req.query.kind);
  if (!kindParsed.success) {
    return res
      .status(400)
      .json({ error: "validation", details: kindParsed.error.flatten() });
  }
  const includeArchived = req.query.includeArchived === "true";
  const q =
    typeof req.query.q === "string" ? req.query.q : undefined;
  const pageRaw =
    typeof req.query.page === "string" ? Number(req.query.page) : undefined;
  const pageSizeRaw =
    typeof req.query.pageSize === "string"
      ? Number(req.query.pageSize)
      : undefined;
  const usePaging =
    pageRaw !== undefined ||
    pageSizeRaw !== undefined ||
    req.query.paged === "true";

  const scope = await resolveDataScope(req.user!);
  const result = await listLocationsCatalog({
    kind: kindParsed.data as LocationKind | undefined,
    includeArchived,
    scopeFilter: locationWhere(scope),
    q,
    ...(usePaging
      ? {
          page: Number.isFinite(pageRaw) ? pageRaw : 1,
          pageSize: Number.isFinite(pageSizeRaw) ? pageSizeRaw : 25,
        }
      : {}),
  });

  if (Array.isArray(result)) {
    return res.json(result.map(mapLocation));
  }
  return res.json({
    items: result.items.map(mapLocation),
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
    totalPages: result.totalPages,
  });
}

/** POST /locations — create a room or common area on a floor. */
export async function create(req: Request, res: Response) {
  // Zod schema for request shape.
  const schema = z.object({
    floorId: z.string().min(1),
    number: z.string().min(1).max(64),
    kind: kindSchema.optional(),
    occupancy: occupancySchema.optional(),
    serviceStatus: serviceStatusSchema.optional(),
  });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body);
  // Reject invalid request payload.
  if (!parsed.success) {
    // Return value / early exit.
    return res
      .status(400)
      .json({ error: "validation", details: parsed.error.flatten() });
  }

  const location = await createLocation({
    floorId: parsed.data.floorId,
    number: parsed.data.number,
    kind: parsed.data.kind as LocationKind | undefined,
    occupancy: parsed.data.occupancy as Occupancy | undefined,
    serviceStatus: parsed.data.serviceStatus as ServiceStatus | undefined,
    actorEmployeeId: req.user!.employeeId,
  });
  // Return value / early exit.
  return res.status(201).json(mapLocation(location));
}

/** PATCH /locations/:id/occupancy — set vacant/occupied/unknown. */
export async function setOccupancy(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // Zod schema for request shape.
  const schema = z.object({ occupancy: occupancySchema });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body);
  // Reject invalid request payload.
  if (!parsed.success) {
    // Return value / early exit.
    return res
      .status(400)
      .json({ error: "validation", details: parsed.error.flatten() });
  }

  // Scope check before mutating occupancy (audited in the service).
  const scope = await resolveDataScope(req.user!);
  // Await async step.
  await loadScopedLocation(scope, req.params.id);

  const location = await setLocationOccupancy(
    req.params.id,
    parsed.data.occupancy as Occupancy,
    req.user!.employeeId,
  );
  // JSON success response.
  return res.json(mapLocation(location));
}

/** PATCH /locations/:id/service-status — set in_service / out_of_service / unknown. */
export async function setServiceStatus(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // Zod schema for request shape.
  const schema = z.object({ serviceStatus: serviceStatusSchema });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body);
  // Reject invalid request payload.
  if (!parsed.success) {
    // Return value / early exit.
    return res
      .status(400)
      .json({ error: "validation", details: parsed.error.flatten() });
  }

  // Build data-scope filter.
  const scope = await resolveDataScope(req.user!);
  // Await async step.
  await loadScopedLocation(scope, req.params.id);

  const location = await setLocationServiceStatus(
    req.params.id,
    parsed.data.serviceStatus as ServiceStatus,
    req.user!.employeeId,
  );
  // JSON success response.
  return res.json(mapLocation(location));
}

/**
 * POST /locations/:id/reconcile-cleaning-status — explicit orphan status heal.
 * Requires rooms.manage + data-scope access; never runs on GET.
 */
export async function reconcileCleaningStatus(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const scope = await resolveDataScope(req.user!);
  await loadScopedLocation(scope, req.params.id);
  const result = await reconcileOrphanCleaningStatusForLocation(req.params.id);
  await recordAudit({
    actorEmployeeId: req.user!.employeeId,
    action: "location.reconcile_cleaning_status",
    entityType: "location",
    entityId: req.params.id,
    locationId: req.params.id,
    after: {
      updated: result.updated,
      cleaningStatus: result.cleaningStatus,
    },
    summary: result.updated
      ? `Reconciled cleaning status to ${result.cleaningStatus}`
      : "Cleaning status already consistent",
  });
  const location = await findLocationById(req.params.id);
  return res.json({
    updated: result.updated,
    cleaningStatus: result.cleaningStatus,
    location: location ? mapLocation(location) : null,
  });
}

/** POST /locations/:id/archive — soft-archive a location. */
export async function archive(req: Request, res: Response) {
  // Build data-scope filter.
  const scope = await resolveDataScope(req.user!);
  // Await async step.
  await loadScopedLocation(scope, req.params.id);
  const location = await archiveLocation(
    req.params.id,
    req.user!.employeeId,
  );
  // JSON success response.
  return res.json(mapLocation(location));
}

/** POST /locations/:id/restore — restore an archived location. */
export async function restore(req: Request, res: Response) {
  // Build data-scope filter.
  const scope = await resolveDataScope(req.user!);
  // Await async step.
  await loadScopedLocation(scope, req.params.id);
  const location = await restoreLocation(
    req.params.id,
    req.user!.employeeId,
  );
  // JSON success response.
  return res.json(mapLocation(location));
}

/** PATCH /locations/:id — update floor/number/kind (at least one field required). */
export async function update(req: Request, res: Response) {
  // Zod schema for request shape.
  const schema = z.object({
    floorId: z.string().min(1).optional(),
    number: z.string().min(1).max(64).optional(),
    kind: kindSchema.optional(),
  });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body);
  // Reject invalid request payload.
  if (!parsed.success) {
    // Return value / early exit.
    return res
      .status(400)
      .json({ error: "validation", details: parsed.error.flatten() });
  }
  // Reject empty patches that would be no-ops.
  if (
    parsed.data.floorId === undefined &&
    parsed.data.number === undefined &&
    parsed.data.kind === undefined
  ) {
    // Validation error response.
    return res.status(400).json({
      error: "validation",
      message: "At least one of floorId, number, kind is required",
    });
  }

  // Build data-scope filter.
  const scope = await resolveDataScope(req.user!);
  // Await async step.
  await loadScopedLocation(scope, req.params.id);

  const location = await updateLocation(req.params.id, {
    floorId: parsed.data.floorId,
    number: parsed.data.number,
    kind: parsed.data.kind as LocationKind | undefined,
    actorEmployeeId: req.user!.employeeId,
  });
  // JSON success response.
  return res.json(mapLocation(location));
}
