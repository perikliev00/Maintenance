/**
 * Location catalog admin handlers: hierarchy, CRUD-ish updates, occupancy /
 * service status, archive/restore. Most mutations assert DataScope access.
 */
import type { NextFunction, Request, Response } from "express";
// Import dependency zod/v3.
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
  // Provide _req for the object/call below.
  _req: Request,
  // Provide res for the object/call below.
  res: Response,
  // Provide next for the object/call below.
  next: NextFunction,
// Continue the controller logic.
) {
  // JSON success response.
  return res.json(await getLocationHierarchy());
}

/** GET /locations — catalog list with optional kind / includeArchived / pagination. */
export async function list(req: Request, res: Response) {
  // Bind kindParsed for use in the handler below.
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
  // Bind includeArchived for use in the handler below.
  const includeArchived = req.query.includeArchived === "true";
  // Bind q for use in the handler below.
  const q =
    // Narrow the runtime type before using the value.
    typeof req.query.q === "string" ? req.query.q : undefined;
  // Bind pageRaw for use in the handler below.
  const pageRaw =
    // Narrow the runtime type before using the value.
    typeof req.query.page === "string" ? Number(req.query.page) : undefined;
  // Bind pageSizeRaw for use in the handler below.
  const pageSizeRaw =
    // Narrow the runtime type before using the value.
    typeof req.query.pageSize === "string"
      // Continue the conditional expression.
      ? Number(req.query.pageSize)
      // Continue the conditional expression.
      : undefined;
  // Bind usePaging for use in the handler below.
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
    // Provide kind for the object/call below.
    kind: kindParsed.data as LocationKind | undefined,
    // Pass includeArchived through.
    includeArchived,
    // Provide scopeFilter for the object/call below.
    scopeFilter: locationWhere(scope),
    // Pass q through.
    q,
    // Continue the controller logic.
    ...(usePaging
      // Continue the conditional expression.
      ? {
          // Provide page for the object/call below.
          page: Number.isFinite(pageRaw) ? pageRaw : 1,
          // Provide pageSize for the object/call below.
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
    // Provide items for the object/call below.
    items: result.items.map(mapLocation),
    // Provide page for the object/call below.
    page: result.page,
    // Provide pageSize for the object/call below.
    pageSize: result.pageSize,
    // Provide total for the object/call below.
    total: result.total,
    // Provide totalPages for the object/call below.
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
    // Provide kind for the object/call below.
    kind: kindSchema.optional(),
    // Provide occupancy for the object/call below.
    occupancy: occupancySchema.optional(),
    // Provide serviceStatus for the object/call below.
    serviceStatus: serviceStatusSchema.optional(),
  });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body);
  // Reject invalid request payload.
  if (!parsed.success) {
    // Return value / early exit.
    return res
      // Set response status code.
      .status(400)
      // Attach JSON body to the response.
      .json({ error: "validation", details: parsed.error.flatten() });
  }

  // Await async work into location.
  const location = await createLocation({
    // Provide floorId for the object/call below.
    floorId: parsed.data.floorId,
    // Provide number for the object/call below.
    number: parsed.data.number,
    // Provide kind for the object/call below.
    kind: parsed.data.kind as LocationKind | undefined,
    // Provide occupancy for the object/call below.
    occupancy: parsed.data.occupancy as Occupancy | undefined,
    // Provide serviceStatus for the object/call below.
    serviceStatus: parsed.data.serviceStatus as ServiceStatus | undefined,
    // Provide actorEmployeeId for the object/call below.
    actorEmployeeId: req.user!.employeeId,
  });
  // Return value / early exit.
  return res.status(201).json(mapLocation(location));
}

/** PATCH /locations/:id/occupancy — set vacant/occupied/unknown. */
export async function setOccupancy(
  // Provide req for the object/call below.
  req: Request,
  // Provide res for the object/call below.
  res: Response,
  // Provide next for the object/call below.
  next: NextFunction,
// Continue the controller logic.
) {
  // Zod schema for request shape.
  const schema = z.object({ occupancy: occupancySchema });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body);
  // Reject invalid request payload.
  if (!parsed.success) {
    // Return value / early exit.
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

  // Await async work into location.
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
  // Provide req for the object/call below.
  req: Request,
  // Provide res for the object/call below.
  res: Response,
  // Provide next for the object/call below.
  next: NextFunction,
// Continue the controller logic.
) {
  // Zod schema for request shape.
  const schema = z.object({ serviceStatus: serviceStatusSchema });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body);
  // Reject invalid request payload.
  if (!parsed.success) {
    // Return value / early exit.
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

  // Await async work into location.
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
  // Provide req for the object/call below.
  req: Request,
  // Provide res for the object/call below.
  res: Response,
  // Provide next for the object/call below.
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
    // Provide actorEmployeeId for the object/call below.
    actorEmployeeId: req.user!.employeeId,
    // Provide action for the object/call below.
    action: "location.reconcile_cleaning_status",
    // Provide entityType for the object/call below.
    entityType: "location",
    // Provide entityId for the object/call below.
    entityId: req.params.id,
    // Provide locationId for the object/call below.
    locationId: req.params.id,
    // Provide after for the object/call below.
    after: {
      // Provide updated for the object/call below.
      updated: result.updated,
      // Provide cleaningStatus for the object/call below.
      cleaningStatus: result.cleaningStatus,
    },
    // Provide summary for the object/call below.
    summary: result.updated
      // Continue the conditional expression.
      ? `Reconciled cleaning status to ${result.cleaningStatus}`
      // Continue the conditional expression.
      : "Cleaning status already consistent",
  });
  // Await async work into location.
  const location = await findLocationById(req.params.id);
  // JSON success response with the payload.
  return res.json({
    // Provide updated for the object/call below.
    updated: result.updated,
    // Provide cleaningStatus for the object/call below.
    cleaningStatus: result.cleaningStatus,
    // Provide location for the object/call below.
    location: location ? mapLocation(location) : null,
  });
}

/** POST /locations/:id/archive — soft-archive a location. */
export async function archive(req: Request, res: Response) {
  // Build data-scope filter.
  const scope = await resolveDataScope(req.user!);
  // Await async step.
  await loadScopedLocation(scope, req.params.id);
  // Await async work into location.
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
  // Await async work into location.
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
    // Provide kind for the object/call below.
    kind: kindSchema.optional(),
  });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body);
  // Reject invalid request payload.
  if (!parsed.success) {
    // Return value / early exit.
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
      // Provide error for the object/call below.
      error: "validation",
      // Provide message for the object/call below.
      message: "At least one of floorId, number, kind is required",
    });
  }

  // Build data-scope filter.
  const scope = await resolveDataScope(req.user!);
  // Await async step.
  await loadScopedLocation(scope, req.params.id);

  // Await async work into location.
  const location = await updateLocation(req.params.id, {
    // Provide floorId for the object/call below.
    floorId: parsed.data.floorId,
    // Provide number for the object/call below.
    number: parsed.data.number,
    // Provide kind for the object/call below.
    kind: parsed.data.kind as LocationKind | undefined,
    // Provide actorEmployeeId for the object/call below.
    actorEmployeeId: req.user!.employeeId,
  });
  // JSON success response.
  return res.json(mapLocation(location));
}
