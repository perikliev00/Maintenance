/** /daily-plan — view plan, import/create/delete rows, apply departure effects. */
import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import * as dailyPlanController from "../controllers/dailyPlan";

export const dailyPlanRouter = Router();

// GET / — list daily plan entries for a hotel date (scoped).
dailyPlanRouter.get(
  "/",
  requireAuth,
  requireAction("plan.view"),
  dailyPlanController.list,
);

// POST /apply-departure-effects — apply/confirm deferred vacant+dirty for departures.
dailyPlanRouter.post(
  "/apply-departure-effects",
  requireAuth,
  requireAction("plan.manage"),
  dailyPlanController.applyDepartureEffects,
);

// POST /import — bulk import plan rows for a hotel date.
dailyPlanRouter.post(
  "/import",
  requireAuth,
  requireAction("plan.manage"),
  dailyPlanController.importPlan,
);

// POST / — create a single plan entry.
dailyPlanRouter.post(
  "/",
  requireAuth,
  requireAction("plan.manage"),
  dailyPlanController.create,
);

// DELETE /:id — remove a plan entry.
dailyPlanRouter.delete(
  "/:id",
  requireAuth,
  requireAction("plan.manage"),
  dailyPlanController.remove,
);
