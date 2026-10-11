import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import * as RoomsController from "../controllers/rooms";

export const roomsRouter = Router();

roomsRouter.get("/", requireAuth, requireAction("rooms.view"), RoomsController.list);

roomsRouter.get("/:id", requireAuth, requireAction("rooms.view"), RoomsController.get);

roomsRouter.post(
  "/:id/mark-dirty",
  requireAuth,
  requireAction("rooms.mark_dirty"),
  RoomsController.markDirty,
);
