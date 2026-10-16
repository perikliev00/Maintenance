/** /rooms — list/get room locations and mark rooms dirty (rooms.* actions). */
import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import * as RoomsController from "../controllers/rooms";

export const roomsRouter = Router();

// GET / — list room locations in the caller's data scope.
roomsRouter.get("/", requireAuth, requireAction("rooms.view"), RoomsController.list);

// GET /:id — single room location detail.
roomsRouter.get("/:id", requireAuth, requireAction("rooms.view"), RoomsController.get);

// POST /:id/mark-dirty — set room dirty and rebind cleaning work.
roomsRouter.post(
  "/:id/mark-dirty",
  requireAuth,
  requireAction("rooms.mark_dirty"),
  RoomsController.markDirty,
);
