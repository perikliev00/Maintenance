import { Router } from "express";
import { LocationKind } from "@prisma/client";
import { requireAuth, requireAction } from "../middleware/auth";
import { AppError } from "../errors";
import { markRoomDirty } from "../services/cleaning";
import {
  assertCanAccessLocation,
  locationWhere,
  resolveDataScope,
} from "../services/dataScope";
import {
  findActiveLocations,
  findLocationById,
  mapLocation,
} from "../services/locations";

export const commonAreasRouter = Router();

commonAreasRouter.get("/", requireAuth, requireAction("rooms.view"), async (req, res, next) => {
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
});

commonAreasRouter.get("/:id", requireAuth, requireAction("rooms.view"), async (req, res, next) => {
  try {
    const scope = await resolveDataScope(req.user!);
    const location = await findLocationById(
      req.params.id,
      LocationKind.common_area,
    );
    if (!location) {
      return res
        .status(404)
        .json({ error: "not_found", message: "Common area not found" });
    }
    await assertCanAccessLocation(scope, location.id);
    return res.json(mapLocation(location));
  } catch (err) {
    return next(err);
  }
});

commonAreasRouter.post(
  "/:id/mark-dirty",
  requireAuth,
  requireAction("rooms.mark_dirty"),
  async (req, res, next) => {
    try {
      const scope = await resolveDataScope(req.user!);
      const existing = await findLocationById(
        req.params.id,
        LocationKind.common_area,
      );
      if (!existing) {
        return res
          .status(404)
          .json({ error: "not_found", message: "Common area not found" });
      }
      await assertCanAccessLocation(scope, existing.id);
      const location = await markRoomDirty(
        req.params.id,
        req.user!.employeeId,
      );
      return res.json(mapLocation(location));
    } catch (err) {
      return next(err);
    }
  },
);

commonAreasRouter.use((err: unknown, _req: any, res: any, next: any) => {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: err.code,
      message: err.message,
      details: err.details,
    });
  }
  return next(err);
});
