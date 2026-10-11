import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import * as sectorsController from "../controllers/sectors";

export const sectorsRouter = Router();

sectorsRouter.get(
  "/",
  requireAuth,
  requireAction("sectors.manage"),
  sectorsController.list,
);

sectorsRouter.get("/mine", requireAuth, sectorsController.listMine);

sectorsRouter.get(
  "/:id",
  requireAuth,
  requireAction("sectors.manage"),
  sectorsController.get,
);

sectorsRouter.post(
  "/",
  requireAuth,
  requireAction("sectors.manage"),
  sectorsController.create,
);

sectorsRouter.patch(
  "/:id",
  requireAuth,
  requireAction("sectors.manage"),
  sectorsController.update,
);

sectorsRouter.put(
  "/:id/locations",
  requireAuth,
  requireAction("sectors.manage"),
  sectorsController.setLocations,
);
