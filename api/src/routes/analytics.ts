/** /analytics — summary metrics (analytics.view). */
import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import * as AnalyticsController from "../controllers/analytics";

// Create the Express router for analytics endpoints.
// Express router for analytics summary metrics.
export const analyticsRouter = Router();

// GET /summary — housekeeping/maintenance analytics snapshot for the selected period.
analyticsRouter.get(
  "/summary",
  // Require an authenticated session before returning analytics.
  requireAuth,
  // Authorize the analytics.view action for this read.
  requireAction("analytics.view"),
  // Delegate to the summary controller with async error forwarding.
  asyncHandler(AnalyticsController.summary),
);
