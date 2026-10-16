/**
 * /locations — CRUD-ish location admin, occupancy/service-status patches,
 * QR lookup, and archive/restore. Action gates vary per route (rooms.* / sectors.manage).
 */
import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import * as locationsController from "../controllers/locations";

export const locationsRouter = Router();

// Static path segments registered before /:id so they are not captured as ids.

// GET /by-qr/:token — resolve a location from its QR token (rooms.view).
locationsRouter.get(
  "/by-qr/:token",
  requireAuth,
  requireAction("rooms.view"),
  locationsController.byQr,
);

// GET /hierarchy — building/floor/room tree for admin UI.
locationsRouter.get(
  "/hierarchy",
  requireAuth,
  requireAction("rooms.manage"),
  locationsController.hierarchy,
);

// GET / — list locations for admin (rooms.manage).
locationsRouter.get(
  "/",
  requireAuth,
  requireAction("rooms.manage"),
  locationsController.list,
);

// POST / — create a location.
locationsRouter.post(
  "/",
  requireAuth,
  requireAction("rooms.manage"),
  locationsController.create,
);

// PATCH /:id/occupancy — set vacant/occupied/etc.
locationsRouter.patch(
  "/:id/occupancy",
  requireAuth,
  requireAction("rooms.set_occupancy"),
  locationsController.setOccupancy,
);

// PATCH /:id/service-status — set in_service / ooo / etc.
locationsRouter.patch(
  "/:id/service-status",
  requireAuth,
  requireAction("rooms.set_service_status"),
  locationsController.setServiceStatus,
);

// POST /:id/archive — soft-archive a location.
locationsRouter.post(
  "/:id/archive",
  requireAuth,
  requireAction("rooms.manage"),
  locationsController.archive,
);

// POST /:id/restore — restore an archived location.
locationsRouter.post(
  "/:id/restore",
  requireAuth,
  requireAction("rooms.manage"),
  locationsController.restore,
);

// GET /:id/qr — QR payload for a location (sectors.manage).
locationsRouter.get(
  "/:id/qr",
  requireAuth,
  requireAction("sectors.manage"),
  locationsController.qr,
);

// PATCH /:id — update location metadata (name, floor, etc.).
locationsRouter.patch(
  "/:id",
  requireAuth,
  requireAction("rooms.manage"),
  locationsController.update,
);
