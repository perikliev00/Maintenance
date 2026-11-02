/** /analytics — summary metrics (analytics.view). */
import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import * as AnalyticsController from "../controllers/analytics";

export const analyticsRouter = Router();

// GET /summary — housekeeping/maintenance analytics snapshot for the selected period.
analyticsRouter.get(
  "/summary",
  requireAuth,
  requireAction("analytics.view"),
  asyncHandler(AnalyticsController.summary),
);
