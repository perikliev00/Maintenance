import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import * as CommonAreasController from "../controllers/commonAreas";

export const commonAreasRouter = Router();

commonAreasRouter.get("/", requireAuth, requireAction("rooms.view"), CommonAreasController.list);

commonAreasRouter.get("/:id", requireAuth, requireAction("rooms.view"), CommonAreasController.get);

commonAreasRouter.post(
  "/:id/mark-dirty",
  requireAuth,
  requireAction("rooms.mark_dirty"),
  CommonAreasController.markDirty,
);
