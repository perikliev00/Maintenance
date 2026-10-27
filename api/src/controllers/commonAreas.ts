/** Common-area location list/get/mark-dirty; scoped like rooms. */
import type { NextFunction, Request, Response } from "express";
import { LocationKind } from "@prisma/client";
import { z } from "zod/v3";
import { markRoomDirty } from "../services/cleaning";
import {
  locationWhere,
  resolveDataScope,
} from "../services/dataScope";
import {
  DEFAULT_ACTIVE_LOCATION_LIMIT,
  MAX_ACTIVE_LOCATION_LIMIT,
  findActiveLocations,
  loadScopedLocation,
  mapLocation,
} from "../services/locations";

/** GET /common-areas — active common areas in scope (capped; see SUS-001). */
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = z
      .object({
        limit: z.coerce
          .number()
          .int()
          .positive()
          .max(MAX_ACTIVE_LOCATION_LIMIT)
          .optional(),
        cursor: z.string().min(1).max(2048).optional(),
      })
      .safeParse(req.query);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "validation", details: parsed.error.flatten() });
    }
    const scope = await resolveDataScope(req.user!);
    // Only active common areas; Prisma where includes sector/hotel scope.
    const { rows, truncated, nextCursor } = await findActiveLocations(
      LocationKind.common_area,
      locationWhere(scope),
      { limit: parsed.data.limit ?? DEFAULT_ACTIVE_LOCATION_LIMIT, cursor: parsed.data.cursor },
    );
    if (truncated) res.setHeader("X-Result-Truncated", "1");
    if (nextCursor) res.setHeader("X-Next-Cursor", nextCursor);
    return res.json(rows.map(mapLocation));
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
