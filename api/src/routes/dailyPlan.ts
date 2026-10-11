import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import * as dailyPlanController from "../controllers/dailyPlan";

export const dailyPlanRouter = Router();

dailyPlanRouter.get(
  "/",
  requireAuth,
  requireAction("plan.view"),
  dailyPlanController.list,
);

dailyPlanRouter.post(
  "/apply-departure-effects",
  requireAuth,
  requireAction("plan.manage"),
  dailyPlanController.applyDepartureEffects,
);

dailyPlanRouter.post(
  "/import",
  requireAuth,
  requireAction("plan.manage"),
  dailyPlanController.importPlan,
);

dailyPlanRouter.post(
  "/",
  requireAuth,
  requireAction("plan.manage"),
  dailyPlanController.create,
);

dailyPlanRouter.delete(
  "/:id",
  requireAuth,
  requireAction("plan.manage"),
  dailyPlanController.remove,
);
