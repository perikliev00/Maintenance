/**
 * Location catalog admin handlers: hierarchy, CRUD-ish updates, occupancy /
 * service status, archive/restore. Most mutations assert DataScope access.
 */
import type { NextFunction, Request, Response } from "express";
import { z } from "zod/v3";
// Continue named import list.
import {
  // Bring LocationKind into scope from the import.
  LocationKind,
  // Bring Occupancy into scope from the import.
  Occupancy,
  // Bring ServiceStatus into scope from the import.
  ServiceStatus,
} from "@prisma/client";
// Continue named import list.
import {
  // Bring locationWhere into scope from the import.
  locationWhere,
  // Bring resolveDataScope into scope from the import.
  resolveDataScope,
} from "../services/dataScope";
// Import local module ../services/audit.
import { recordAudit } from "../services/audit";
// Continue named import list.
import {
  // Bring archiveLocation into scope from the import.
  archiveLocation,
  // Bring createLocation into scope from the import.
  createLocation,
  // Bring getLocationHierarchy into scope from the import.
  getLocationHierarchy,
  // Bring listLocationsCatalog into scope from the import.
  listLocationsCatalog,
  // Bring loadScopedLocation into scope from the import.
  loadScopedLocation,
  // Bring mapLocation into scope from the import.
  mapLocation,
  // Bring reconcileOrphanCleaningStatusForLocation into scope from the import.
  reconcileOrphanCleaningStatusForLocation,
  // Bring restoreLocation into scope from the import.
  restoreLocation,
  // Bring setLocationOccupancy into scope from the import.
  setLocationOccupancy,
  // Bring setLocationServiceStatus into scope from the import.
  setLocationServiceStatus,
  // Bring updateLocation into scope from the import.
  updateLocation,
  // Bring findLocationById into scope from the import.
  findLocationById,
} from "../services/locations";

// Zod field / transform.
const kindSchema = z.enum(["room", "common_area"]);
// Zod field / transform.
const occupancySchema = z.enum(["vacant", "occupied", "unknown"]);
// Zod field / transform.
const serviceStatusSchema = z.enum([
  // Pass string literal argument.
  "in_service",
  // Pass string literal argument.
  "out_of_service",
  // Pass string literal argument.
  "unknown",
]);

/** GET /locations/hierarchy — building/floor/room tree for admin UI. */
export async function hierarchy(
  _req: Request,
  res: Response,
  next: NextFunction,
// Continue the controller logic.
) {
  // JSON success response.
  return res.json(await getLocationHierarchy());
}

/** GET /locations — catalog list with optional kind / includeArchived / pagination. */
export async function list(req: Request, res: Response) {
  const kindParsed = kindSchema.optional().safeParse(req.query.kind);
  // Guard: skip or fail when the negated condition holds.
  if (!kindParsed.success) {
    // Return value or early exit.
    return res
      // Set response status code.
      .status(400)
      // Attach JSON body to the response.
      .json({ error: "validation", details: kindParsed.error.flatten() });
  }
  const includeArchived = req.query.includeArchived === "true";
  const q =
    // Narrow the runtime type before using the value.
    typeof req.query.q === "string" ? req.query.q : undefined;
  const pageRaw =
    // Narrow the runtime type before using the value.
    typeof req.query.page === "string" ? Number(req.query.page) : undefined;
  const pageSizeRaw =
    // Narrow the runtime type before using the value.
    typeof req.query.pageSize === "string"
      // Continue the conditional expression.
      ? Number(req.query.pageSize)
      // Continue the conditional expression.
      : undefined;
  const usePaging =
    // Continue the controller logic.
    pageRaw !== undefined ||
    // Continue the controller logic.
    pageSizeRaw !== undefined ||
    // Continue the controller logic.
    req.query.paged === "true";

  // Resolve caller's DataScope for Prisma filtering.
  const scope = await resolveDataScope(req.user!);
  // Invoke service and capture the result payload.
  const result = await listLocationsCatalog({
    kind: kindParsed.data as LocationKind | undefined,
    includeArchived,
    scopeFilter: locationWhere(scope),
    q,
    // Continue the controller logic.
    ...(usePaging
      // Continue the conditional expression.
      ? {
          page: Number.isFinite(pageRaw) ? pageRaw : 1,
          pageSize: Number.isFinite(pageSizeRaw) ? pageSizeRaw : 25,
        }
      // Continue the conditional expression.
      : {}),
  });

  // Branch when this condition holds.
  if (Array.isArray(result)) {
    // JSON success response with the payload.
    return res.json(result.map(mapLocation));
  }
  // JSON success response with the payload.
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
    // Validate field floorId.
    floorId: z.string().min(1),
    // Validate field number.
    number: z.string().min(1).max(64),
    kind: kindSchema.optional(),
    occupancy: occupancySchema.optional(),
    serviceStatus: serviceStatusSchema.optional(),
  });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body);
  // Reject invalid request payload.
  if (!parsed.success) {
    return res
      // Set response status code.
      .status(400)
      // Attach JSON body to the response.
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
  return res.status(201).json(mapLocation(location));
}

/** PATCH /locations/:id/occupancy — set vacant/occupied/unknown. */
export async function setOccupancy(
  req: Request,
  res: Response,
  next: NextFunction,
// Continue the controller logic.
) {
  // Zod schema for request shape.
  const schema = z.object({ occupancy: occupancySchema });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body);
  // Reject invalid request payload.
  if (!parsed.success) {
    return res
      // Set response status code.
      .status(400)
      // Attach JSON body to the response.
      .json({ error: "validation", details: parsed.error.flatten() });
  }

  // Scope check before mutating occupancy (audited in the service).
  const scope = await resolveDataScope(req.user!);
  // Await async step.
  await loadScopedLocation(scope, req.params.id);

  const location = await setLocationOccupancy(
    // Pass req.params.id through.
    req.params.id,
    // Continue the controller logic.
    parsed.data.occupancy as Occupancy,
    // Continue the controller logic.
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
// Continue the controller logic.
) {
  // Zod schema for request shape.
  const schema = z.object({ serviceStatus: serviceStatusSchema });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body);
  // Reject invalid request payload.
  if (!parsed.success) {
    return res
      // Set response status code.
      .status(400)
      // Attach JSON body to the response.
      .json({ error: "validation", details: parsed.error.flatten() });
  }

  // Build data-scope filter.
  const scope = await resolveDataScope(req.user!);
  // Await async step.
  await loadScopedLocation(scope, req.params.id);

  const location = await setLocationServiceStatus(
    // Pass req.params.id through.
    req.params.id,
    // Continue the controller logic.
    parsed.data.serviceStatus as ServiceStatus,
    // Continue the controller logic.
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
// Continue the controller logic.
) {
  // Resolve caller's DataScope for Prisma filtering.
  const scope = await resolveDataScope(req.user!);
  // Await side-effecting async work.
  await loadScopedLocation(scope, req.params.id);
  // Invoke service and capture the result payload.
  const result = await reconcileOrphanCleaningStatusForLocation(req.params.id);
  // Await side-effecting async work.
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
      // Continue the conditional expression.
      ? `Reconciled cleaning status to ${result.cleaningStatus}`
      // Continue the conditional expression.
      : "Cleaning status already consistent",
  });
  const location = await findLocationById(req.params.id);
  // JSON success response with the payload.
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
    // Pass req.params.id through.
    req.params.id,
    // Continue the controller logic.
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
    // Pass req.params.id through.
    req.params.id,
    // Continue the controller logic.
    req.user!.employeeId,
  );
  // JSON success response.
  return res.json(mapLocation(location));
}

/** PATCH /locations/:id — update floor/number/kind (at least one field required). */
export async function update(req: Request, res: Response) {
  // Zod schema for request shape.
  const schema = z.object({
    // Validate field floorId.
    floorId: z.string().min(1).optional(),
    // Validate field number.
    number: z.string().min(1).max(64).optional(),
    kind: kindSchema.optional(),
  });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body);
  // Reject invalid request payload.
  if (!parsed.success) {
    return res
      // Set response status code.
      .status(400)
      // Attach JSON body to the response.
      .json({ error: "validation", details: parsed.error.flatten() });
  }
  // Reject empty patches that would be no-ops.
  if (
    // Continue the controller logic.
    parsed.data.floorId === undefined &&
    // Continue the controller logic.
    parsed.data.number === undefined &&
    // Continue the controller logic.
    parsed.data.kind === undefined
  // Continue the controller logic.
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
