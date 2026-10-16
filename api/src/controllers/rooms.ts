/** Room location list/get/mark-dirty; results filtered by the caller's DataScope. */
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

/** GET /rooms — active room locations in the caller's scope. */
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await resolveDataScope(req.user!);
    // Only active rooms; Prisma where includes sector/hotel scope.
    const locations = await findActiveLocations(
      LocationKind.room,
      locationWhere(scope),
    );
    return res.json(locations.map(mapLocation));
  } catch (err) {
    return next(err);
  }
}

/** GET /rooms/:id — single room; 404 if missing or out of scope. */
export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await resolveDataScope(req.user!);
    // Enforces kind=room and data-scope access.
    const location = await loadScopedLocation(scope, req.params.id, {
      kind: LocationKind.room,
      notFoundMessage: "Room not found",
    });
    return res.json(mapLocation(location));
  } catch (err) {
    return next(err);
  }
}

/** POST /rooms/:id/mark-dirty — set dirty and rebind cleaning work. */
export async function markDirty(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await resolveDataScope(req.user!);
    // Access check before mutation (same not-found messaging as get).
    await loadScopedLocation(scope, req.params.id, {
      kind: LocationKind.room,
      notFoundMessage: "Room not found",
    });
    // Actor employee id is recorded on the dirty transition / audit.
    const location = await markRoomDirty(
      req.params.id,
      req.user!.employeeId,
    );
    return res.json(mapLocation(location));
  } catch (err) {
    return next(err);
  }
}
