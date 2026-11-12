/** /daily-plan — view plan, import/create/delete rows, apply departure effects. */
import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import * as dailyPlanController from "../controllers/dailyPlan";

// Express router for daily plan view, import, and departure effects.
export const dailyPlanRouter = Router();

// GET / — list daily plan entries for a hotel date (scoped).
dailyPlanRouter.get(
  "/",
  // Require an authenticated session before listing plan rows.
  requireAuth,
  // Authorize plan.view for daily plan reads.
  requireAction("plan.view"),
  // Delegate to the list controller with async error forwarding.
  asyncHandler(dailyPlanController.list),
);

// POST /apply-departure-effects — apply/confirm deferred vacant+dirty for departures.
dailyPlanRouter.post(
  "/apply-departure-effects",
  // Require an authenticated session before applying departure effects.
  requireAuth,
  // Authorize plan.manage for departure-effect mutations.
  requireAction("plan.manage"),
  // Delegate to the applyDepartureEffects controller with async error forwarding.
  asyncHandler(dailyPlanController.applyDepartureEffects),
);

// POST /import — bulk import plan rows for a hotel date.
dailyPlanRouter.post(
  "/import",
  // Require an authenticated session before importing plan rows.
  requireAuth,
  // Authorize plan.manage for bulk import.
  requireAction("plan.manage"),
  // Delegate to the import controller with async error forwarding.
  asyncHandler(dailyPlanController.importPlan),
);

// POST / — create a single plan entry.
dailyPlanRouter.post(
  "/",
  // Require an authenticated session before creating a plan entry.
  requireAuth,
  // Authorize plan.manage for single-row creation.
  requireAction("plan.manage"),
  // Delegate to the create controller with async error forwarding.
  asyncHandler(dailyPlanController.create),
);

// DELETE /:id — remove a plan entry.
dailyPlanRouter.delete(
  "/:id",
  // Require an authenticated session before deleting a plan entry.
  requireAuth,
  // Authorize plan.manage for plan-entry deletion.
  requireAction("plan.manage"),
  // Delegate to the remove controller with async error forwarding.
  asyncHandler(dailyPlanController.remove),
);
