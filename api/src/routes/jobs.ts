/** /jobs — run history (jobs.view) and manual trigger (jobs.run). */
import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import * as JobsController from "../controllers/jobs";

export const jobsRouter = Router();

// GET /runs — recent background job run history.
jobsRouter.get(
  "/runs",
  requireAuth,
  requireAction("jobs.view"),
  JobsController.listRuns,
);

// POST /run — manually trigger a named background job (least privilege).
jobsRouter.post(
  "/run",
  requireAuth,
  requireAction("jobs.run"),
  JobsController.run,
);
