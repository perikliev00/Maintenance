/** Common-area location list/get/mark-dirty; scoped like rooms. */
import type { NextFunction, Request, Response } from "express";
import { LocationKind } from "@prisma/client";
import { markRoomDirty } from "../services/cleaning";
import {
  locationWhere,
  resolveDataScope,
} from "../services/dataScope";
import {
  findActiveLocations,
  loadScopedLocation,
  mapLocation,
} from "../services/locations";

/** GET /common-areas — active common-area locations in the caller's scope. */
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await resolveDataScope(req.user!);
    // Only active common areas; Prisma where includes sector/hotel scope.
    const locations = await findActiveLocations(
      LocationKind.common_area,
      locationWhere(scope),
    );
    return res.json(locations.map(mapLocation));
  } catch (err) {
    return next(err);
  }
}

/** GET /common-areas/:id — single common area; 404 if missing or out of scope. */
export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await resolveDataScope(req.user!);
    // Enforces kind=common_area and data-scope access.
    const location = await loadScopedLocation(scope, req.params.id, {
      kind: LocationKind.common_area,
      notFoundMessage: "Common area not found",
    });
    return res.json(mapLocation(location));
  } catch (err) {
    return next(err);
  }
}

/** POST /common-areas/:id/mark-dirty — set dirty and rebind cleaning work. */
export async function markDirty(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await resolveDataScope(req.user!);
    // Access check before mutation (same not-found messaging as get).
    await loadScopedLocation(scope, req.params.id, {
      kind: LocationKind.common_area,
      notFoundMessage: "Common area not found",
    });
    // Reuses markRoomDirty service (location-kind agnostic dirty + rebind).
    const location = await markRoomDirty(
      req.params.id,
      req.user!.employeeId,
    );
    return res.json(mapLocation(location));
  } catch (err) {
    return next(err);
  }
}
