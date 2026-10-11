import { Router } from "express";
import { LocationKind } from "@prisma/client";
import { requireAuth, requireAction } from "../middleware/auth";
import { markRoomDirty } from "../services/cleaning";
import {
  locationWhere,
  resolveDataScope,
} from "../services/dataScope";
import {
  findActiveLocations,
  loadScopedLocation,
  mapLocation,
} from "../services/locations";

export const roomsRouter = Router();

roomsRouter.get("/", requireAuth, requireAction("rooms.view"), async (req, res, next) => {
  try {
    const scope = await resolveDataScope(req.user!);
    const locations = await findActiveLocations(
      LocationKind.room,
      locationWhere(scope),
    );
    return res.json(locations.map(mapLocation));
  } catch (err) {
    return next(err);
  }
});

roomsRouter.get("/:id", requireAuth, requireAction("rooms.view"), async (req, res, next) => {
  try {
    const scope = await resolveDataScope(req.user!);
    const location = await loadScopedLocation(scope, req.params.id, {
      kind: LocationKind.room,
      notFoundMessage: "Room not found",
    });
    return res.json(mapLocation(location));
  } catch (err) {
    return next(err);
  }
});

roomsRouter.post(
  "/:id/mark-dirty",
  requireAuth,
  requireAction("rooms.mark_dirty"),
  async (req, res, next) => {
    try {
      const scope = await resolveDataScope(req.user!);
      await loadScopedLocation(scope, req.params.id, {
        kind: LocationKind.room,
        notFoundMessage: "Room not found",
      });
      const location = await markRoomDirty(
        req.params.id,
        req.user!.employeeId,
      );
      return res.json(mapLocation(location));
    } catch (err) {
      return next(err);
    }
  },
);
