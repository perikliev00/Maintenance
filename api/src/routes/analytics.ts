import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import * as AnalyticsController from "../controllers/analytics";

export const analyticsRouter = Router();

analyticsRouter.get(
  "/summary",
  requireAuth,
  requireAction("analytics.view"),
  AnalyticsController.summary,
);
