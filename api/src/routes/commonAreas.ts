/** /common-areas — list/get common-area locations and mark dirty (rooms.* actions). */
import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import * as CommonAreasController from "../controllers/commonAreas";

export const commonAreasRouter = Router();

// GET / — list common-area locations in the caller's data scope.
commonAreasRouter.get("/", requireAuth, requireAction("rooms.view"), CommonAreasController.list);

// GET /:id — single common-area location detail.
commonAreasRouter.get("/:id", requireAuth, requireAction("rooms.view"), CommonAreasController.get);

// POST /:id/mark-dirty — set common area dirty and rebind cleaning work.
commonAreasRouter.post(
  "/:id/mark-dirty",
  requireAuth,
  requireAction("rooms.mark_dirty"),
  CommonAreasController.markDirty,
);
