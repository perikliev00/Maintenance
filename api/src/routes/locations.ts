/**
 * /locations — CRUD-ish location admin, occupancy/service-status patches,
 * and archive/restore. Action gates vary per route (rooms.* / sectors.manage).
 */
import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import * as locationsController from "../controllers/locations";

// Express router for location admin, occupancy, and archive/restore.
export const locationsRouter = Router();

// Static path segments registered before /:id so they are not captured as ids.

// GET /hierarchy — building/floor/room tree for admin UI.
locationsRouter.get(
  "/hierarchy",
  // Require an authenticated session before reading the hierarchy.
  requireAuth,
  // Authorize rooms.manage for hierarchy reads.
  requireAction("rooms.manage"),
  // Delegate to the hierarchy controller with async error forwarding.
  asyncHandler(locationsController.hierarchy),
);

// GET / — list locations for admin (rooms.manage).
locationsRouter.get(
  "/",
  // Require an authenticated session before listing locations.
  requireAuth,
  // Authorize rooms.manage for admin location list.
  requireAction("rooms.manage"),
  // Delegate to the list controller with async error forwarding.
  asyncHandler(locationsController.list),
);

// POST / — create a location.
locationsRouter.post(
  "/",
  // Require an authenticated session before creating a location.
  requireAuth,
  // Authorize rooms.manage for location creation.
  requireAction("rooms.manage"),
  // Delegate to the create controller with async error forwarding.
  asyncHandler(locationsController.create),
);

// PATCH /:id/occupancy — set vacant/occupied/etc.
locationsRouter.patch(
  "/:id/occupancy",
  // Require an authenticated session before changing occupancy.
  requireAuth,
  // Authorize rooms.set_occupancy for occupancy mutations.
  requireAction("rooms.set_occupancy"),
  // Delegate to the setOccupancy controller with async error forwarding.
  asyncHandler(locationsController.setOccupancy),
);

// PATCH /:id/service-status — set in_service / ooo / etc.
locationsRouter.patch(
  "/:id/service-status",
  // Require an authenticated session before changing service status.
  requireAuth,
  // Authorize rooms.set_service_status for service-status mutations.
  requireAction("rooms.set_service_status"),
  // Delegate to the setServiceStatus controller with async error forwarding.
  asyncHandler(locationsController.setServiceStatus),
);

// POST /:id/reconcile-cleaning-status — explicit orphan cleaningStatus heal.
locationsRouter.post(
  "/:id/reconcile-cleaning-status",
  // Require an authenticated session before reconciling cleaning status.
  requireAuth,
  // Authorize rooms.manage for cleaning-status reconciliation.
  requireAction("rooms.manage"),
  // Delegate to the reconcileCleaningStatus controller with async error forwarding.
  asyncHandler(locationsController.reconcileCleaningStatus),
);

// POST /:id/archive — soft-archive a location.
locationsRouter.post(
  "/:id/archive",
  // Require an authenticated session before archiving a location.
  requireAuth,
  // Authorize rooms.manage for location archive.
  requireAction("rooms.manage"),
  // Delegate to the archive controller with async error forwarding.
  asyncHandler(locationsController.archive),
);

// POST /:id/restore — restore an archived location.
locationsRouter.post(
  "/:id/restore",
  // Require an authenticated session before restoring a location.
  requireAuth,
  // Authorize rooms.manage for location restore.
  requireAction("rooms.manage"),
  // Delegate to the restore controller with async error forwarding.
  asyncHandler(locationsController.restore),
);

// PATCH /:id — update location metadata (name, floor, etc.).
locationsRouter.patch(
  "/:id",
  // Require an authenticated session before updating location metadata.
  requireAuth,
  // Authorize rooms.manage for location metadata updates.
  requireAction("rooms.manage"),
  // Delegate to the update controller with async error forwarding.
  asyncHandler(locationsController.update),
);
