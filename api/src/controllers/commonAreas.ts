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

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await resolveDataScope(req.user!);
    const locations = await findActiveLocations(
      LocationKind.common_area,
      locationWhere(scope),
    );
    return res.json(locations.map(mapLocation));
  } catch (err) {
    return next(err);
  }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await resolveDataScope(req.user!);
    const location = await loadScopedLocation(scope, req.params.id, {
      kind: LocationKind.common_area,
      notFoundMessage: "Common area not found",
    });
    return res.json(mapLocation(location));
  } catch (err) {
    return next(err);
  }
}

export async function markDirty(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await resolveDataScope(req.user!);
    await loadScopedLocation(scope, req.params.id, {
      kind: LocationKind.common_area,
      notFoundMessage: "Common area not found",
    });
    const location = await markRoomDirty(
      req.params.id,
      req.user!.employeeId,
    );
    return res.json(mapLocation(location));
  } catch (err) {
    return next(err);
  }
}
