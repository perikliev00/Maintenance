/**
 * /sectors — sector admin (sectors.manage) plus /mine for the caller's own sectors
 * (auth only; no manage action required).
 */
import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import * as sectorsController from "../controllers/sectors";

// Create the Express router for sector administration endpoints.
export const sectorsRouter = Router();

// GET / — admin list of all sectors.
sectorsRouter.get(
  "/",
  // Require an authenticated session before listing all sectors.
  requireAuth,
  // Authorize sectors.manage for the admin sector list.
  requireAction("sectors.manage"),
  // Delegate to the list controller with async error forwarding.
  asyncHandler(sectorsController.list),
);

// GET /mine — sectors for the current employee (auth only; not full admin list).
sectorsRouter.get("/mine", requireAuth, asyncHandler(sectorsController.listMine));

// GET /:id — single sector detail including locations/members.
sectorsRouter.get(
  "/:id",
  // Require an authenticated session before reading sector detail.
  requireAuth,
  // Authorize sectors.manage for sector detail.
  requireAction("sectors.manage"),
  // Delegate to the get controller with async error forwarding.
  asyncHandler(sectorsController.get),
);

// POST / — create a sector.
sectorsRouter.post(
  "/",
  // Require an authenticated session before creating a sector.
  requireAuth,
  // Authorize sectors.manage for sector creation.
  requireAction("sectors.manage"),
  // Delegate to the create controller with async error forwarding.
  asyncHandler(sectorsController.create),
);

// PATCH /:id — update sector metadata / membership.
sectorsRouter.patch(
  "/:id",
  // Require an authenticated session before updating a sector.
  requireAuth,
  // Authorize sectors.manage for sector updates.
  requireAction("sectors.manage"),
  // Delegate to the update controller with async error forwarding.
  asyncHandler(sectorsController.update),
);

// PUT /:id/locations — replace the location set for a sector.
sectorsRouter.put(
  "/:id/locations",
  // Require an authenticated session before replacing sector locations.
  requireAuth,
  // Authorize sectors.manage for location-set replacement.
  requireAction("sectors.manage"),
  // Delegate to the setLocations controller with async error forwarding.
  asyncHandler(sectorsController.setLocations),
);
