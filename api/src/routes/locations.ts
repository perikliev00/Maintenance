/**
 * /locations — CRUD-ish location admin, occupancy/service-status patches,
 * and archive/restore. Action gates vary per route (rooms.* / sectors.manage).
 */
import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import * as locationsController from "../controllers/locations";

export const locationsRouter = Router();

// Static path segments registered before /:id so they are not captured as ids.

// GET /hierarchy — building/floor/room tree for admin UI.
locationsRouter.get(
  "/hierarchy",
  requireAuth,
  requireAction("rooms.manage"),
  asyncHandler(locationsController.hierarchy),
);

// GET / — list locations for admin (rooms.manage).
locationsRouter.get(
  "/",
  requireAuth,
  requireAction("rooms.manage"),
  asyncHandler(locationsController.list),
);

// POST / — create a location.
locationsRouter.post(
  "/",
  requireAuth,
  requireAction("rooms.manage"),
  asyncHandler(locationsController.create),
);

// PATCH /:id/occupancy — set vacant/occupied/etc.
locationsRouter.patch(
  "/:id/occupancy",
  requireAuth,
  requireAction("rooms.set_occupancy"),
  asyncHandler(locationsController.setOccupancy),
);

// PATCH /:id/service-status — set in_service / ooo / etc.
locationsRouter.patch(
  "/:id/service-status",
  requireAuth,
  requireAction("rooms.set_service_status"),
  asyncHandler(locationsController.setServiceStatus),
);

// POST /:id/reconcile-cleaning-status — explicit orphan cleaningStatus heal.
locationsRouter.post(
  "/:id/reconcile-cleaning-status",
  requireAuth,
  requireAction("rooms.manage"),
  asyncHandler(locationsController.reconcileCleaningStatus),
);

// POST /:id/archive — soft-archive a location.
locationsRouter.post(
  "/:id/archive",
  requireAuth,
  requireAction("rooms.manage"),
  asyncHandler(locationsController.archive),
);

// POST /:id/restore — restore an archived location.
locationsRouter.post(
  "/:id/restore",
  requireAuth,
  requireAction("rooms.manage"),
  asyncHandler(locationsController.restore),
);

// PATCH /:id — update location metadata (name, floor, etc.).
locationsRouter.patch(
  "/:id",
  requireAuth,
  requireAction("rooms.manage"),
  asyncHandler(locationsController.update),
);
