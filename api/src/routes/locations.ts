import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import { AppError } from "../errors";
import {
  assertCanAccessLocation,
  resolveDataScope,
} from "../services/dataScope";
import {
  findLocationById,
  findLocationByQrToken,
  locationQrPayload,
  mapLocation,
} from "../services/locations";

export const locationsRouter = Router();

/** Resolve a room/common-area QR token to location identity (no auto start). */
locationsRouter.get(
  "/by-qr/:token",
  requireAuth,
  requireAction("rooms.view"),
  async (req, res, next) => {
    try {
      const location = await findLocationByQrToken(req.params.token);
      if (!location || location.catalogStatus !== "active") {
        return res.status(404).json({
          error: "not_found",
          message: "Unknown or inactive location QR",
        });
      }
      const scope = await resolveDataScope(req.user!);
      await assertCanAccessLocation(scope, location.id);
      return res.json({
        location: mapLocation(location),
        qr: locationQrPayload(location),
      });
    } catch (err) {
      return next(err);
    }
  },
);

locationsRouter.get(
  "/:id/qr",
  requireAuth,
  requireAction("sectors.manage"),
  async (req, res, next) => {
    try {
      const location = await findLocationById(req.params.id);
      if (!location || location.catalogStatus !== "active") {
        return res.status(404).json({
          error: "not_found",
          message: "Location not found",
        });
      }
      const scope = await resolveDataScope(req.user!);
      await assertCanAccessLocation(scope, location.id);
      return res.json(locationQrPayload(location));
    } catch (err) {
      return next(err);
    }
  },
);

locationsRouter.use((err: unknown, _req: any, res: any, next: any) => {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: err.code,
      message: err.message,
      details: err.details,
    });
  }
  return next(err);
});
