/**
 * /sectors — sector admin (sectors.manage) plus /mine for the caller's own sectors
 * (auth only; no manage action required).
 */
import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import * as sectorsController from "../controllers/sectors";

export const sectorsRouter = Router();

// GET / — admin list of all sectors.
sectorsRouter.get(
  "/",
  requireAuth,
  requireAction("sectors.manage"),
  asyncHandler(sectorsController.list),
);

// GET /mine — sectors for the current employee (auth only; not full admin list).
sectorsRouter.get("/mine", requireAuth, asyncHandler(sectorsController.listMine));

// GET /:id — single sector detail including locations/members.
sectorsRouter.get(
  "/:id",
  requireAuth,
  requireAction("sectors.manage"),
  asyncHandler(sectorsController.get),
);

// POST / — create a sector.
sectorsRouter.post(
  "/",
  requireAuth,
  requireAction("sectors.manage"),
  asyncHandler(sectorsController.create),
);

// PATCH /:id — update sector metadata / membership.
sectorsRouter.patch(
  "/:id",
  requireAuth,
  requireAction("sectors.manage"),
  asyncHandler(sectorsController.update),
);

// PUT /:id/locations — replace the location set for a sector.
sectorsRouter.put(
  "/:id/locations",
  requireAuth,
  requireAction("sectors.manage"),
  asyncHandler(sectorsController.setLocations),
);
