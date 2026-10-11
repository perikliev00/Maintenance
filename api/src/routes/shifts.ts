import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import * as ShiftsController from "../controllers/shifts";

export const shiftsRouter = Router();

shiftsRouter.get("/", requireAuth, ShiftsController.list);

shiftsRouter.get(
  "/roster",
  requireAuth,
  requireAction("shifts.manage"),
  ShiftsController.listRoster,
);

shiftsRouter.put(
  "/roster",
  requireAuth,
  requireAction("shifts.manage"),
  ShiftsController.upsertRoster,
);

shiftsRouter.post(
  "/",
  requireAuth,
  requireAction("shifts.manage"),
  ShiftsController.create,
);

shiftsRouter.patch(
  "/:id",
  requireAuth,
  requireAction("shifts.manage"),
  ShiftsController.update,
);
