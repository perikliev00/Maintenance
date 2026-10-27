/**
 * Location catalog admin handlers: hierarchy, CRUD-ish updates, occupancy /
 * service status, QR, archive/restore. Most mutations assert DataScope access.
 */
import type { NextFunction, Request, Response } from "express";
import { z } from "zod/v3";
import {
  LocationKind,
  Occupancy,
  ServiceStatus,
} from "@prisma/client";
import {
  assertCanAccessLocation,
  locationWhere,
  resolveDataScope,
} from "../services/dataScope";
import {
  archiveLocation,
  createLocation,
  findLocationByQrToken,
  getLocationHierarchy,
  listLocationsCatalog,
  loadScopedLocation,
  locationQrPayload,
  mapLocation,
  restoreLocation,
  setLocationOccupancy,
  setLocationServiceStatus,
  updateLocation,
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

/** Resolve a room/common-area QR token to location identity (no auto start). */
export async function byQr(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    // Look up by QR token (not location id).
    const location = await findLocationByQrToken(req.params.token);
    // Archived / unknown tokens are indistinguishable 404s.
    if (!location || location.catalogStatus !== "active") {
      // Return value / early exit.
      return res.status(404).json({
        error: "not_found",
        message: "Unknown or inactive location QR",
      });
    }
    // Caller must be in scope for this location.
    const scope = await resolveDataScope(req.user!);
    // Assert access / permission.
    await assertCanAccessLocation(scope, location.id);
    // JSON success response.
    return res.json({
      location: mapLocation(location),
      qr: locationQrPayload(location),
    });
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** GET /locations/hierarchy — building/floor/room tree for admin UI. */
export async function hierarchy(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  // Try block for fallible work.
  try {
    // JSON success response.
    return res.json(await getLocationHierarchy());
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** GET /locations — catalog list with optional kind / includeArchived. */
export async function list(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    const kindParsed = kindSchema.optional().safeParse(req.query.kind);
    // Branch: conditional gate.
    if (!kindParsed.success) {
      // Return value / early exit.
      return res
        .status(400)
        .json({ error: "validation", details: kindParsed.error.flatten() });
    }
    const includeArchived = req.query.includeArchived === "true";
    // Build data-scope filter.
    const scope = await resolveDataScope(req.user!);
    const locations = await listLocationsCatalog({
      kind: kindParsed.data as LocationKind | undefined,
      includeArchived,
      scopeFilter: locationWhere(scope),
    });
    // JSON success response.
    return res.json(locations.map(mapLocation));
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** POST /locations — create a room or common area on a floor. */
export async function create(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
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
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** PATCH /locations/:id/occupancy — set vacant/occupied/unknown. */
export async function setOccupancy(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // Try block for fallible work.
  try {
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
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** PATCH /locations/:id/service-status — set in_service / out_of_service / unknown. */
export async function setServiceStatus(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // Try block for fallible work.
  try {
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
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** POST /locations/:id/archive — soft-archive a location. */
export async function archive(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
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
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** POST /locations/:id/restore — restore an archived location. */
export async function restore(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
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
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** GET /locations/:id/qr — QR payload for an active location in scope. */
export async function qr(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    // Build data-scope filter.
    const scope = await resolveDataScope(req.user!);
    // activeOnly: archived locations do not get QR payloads.
    const location = await loadScopedLocation(scope, req.params.id, {
      activeOnly: true,
    });
    // JSON success response.
    return res.json(locationQrPayload(location));
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/** PATCH /locations/:id — update floor/number/kind (at least one field required). */
export async function update(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
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
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}
