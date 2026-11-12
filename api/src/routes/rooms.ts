/** /rooms — list/get room locations and mark rooms dirty (rooms.* actions). */
import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import * as RoomsController from "../controllers/rooms";

// Create the Express router for room location endpoints.
// Express router for room list/get and mark-dirty mutations.
export const roomsRouter = Router();

// GET / — list room locations in the caller's data scope.
roomsRouter.get("/", requireAuth, requireAction("rooms.view"), asyncHandler(RoomsController.list));

// GET /:id — single room location detail.
roomsRouter.get("/:id", requireAuth, requireAction("rooms.view"), asyncHandler(RoomsController.get));

// POST /:id/mark-dirty — set room dirty and rebind cleaning work.
roomsRouter.post(
  "/:id/mark-dirty",
  // Require an authenticated session before mutating room state.
  requireAuth,
  // Authorize the rooms.mark_dirty action for this mutation.
  requireAction("rooms.mark_dirty"),
  // Delegate to the markDirty controller with async error forwarding.
  asyncHandler(RoomsController.markDirty),
);
