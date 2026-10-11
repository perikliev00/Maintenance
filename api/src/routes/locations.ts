import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import * as locationsController from "../controllers/locations";

export const locationsRouter = Router();

locationsRouter.get(
  "/by-qr/:token",
  requireAuth,
  requireAction("rooms.view"),
  locationsController.byQr,
);

locationsRouter.get(
  "/hierarchy",
  requireAuth,
  requireAction("rooms.manage"),
  locationsController.hierarchy,
);

locationsRouter.get(
  "/",
  requireAuth,
  requireAction("rooms.manage"),
  locationsController.list,
);

locationsRouter.post(
  "/",
  requireAuth,
  requireAction("rooms.manage"),
  locationsController.create,
);

locationsRouter.patch(
  "/:id/occupancy",
  requireAuth,
  requireAction("rooms.set_occupancy"),
  locationsController.setOccupancy,
);

locationsRouter.patch(
  "/:id/service-status",
  requireAuth,
  requireAction("rooms.set_service_status"),
  locationsController.setServiceStatus,
);

locationsRouter.post(
  "/:id/archive",
  requireAuth,
  requireAction("rooms.manage"),
  locationsController.archive,
);

locationsRouter.post(
  "/:id/restore",
  requireAuth,
  requireAction("rooms.manage"),
  locationsController.restore,
);

locationsRouter.get(
  "/:id/qr",
  requireAuth,
  requireAction("sectors.manage"),
  locationsController.qr,
);

locationsRouter.patch(
  "/:id",
  requireAuth,
  requireAction("rooms.manage"),
  locationsController.update,
);
