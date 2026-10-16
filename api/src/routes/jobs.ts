/** /jobs — background job run history and manual trigger (jobs.view). */
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

// POST /run — manually trigger a named background job.
jobsRouter.post(
  "/run",
  requireAuth,
  requireAction("jobs.view"),
  JobsController.run,
);
