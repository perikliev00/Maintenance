/** NEW-05: GET /runs needs jobs.view; POST /run needs jobs.run (separate grants). */
import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import * as JobsController from "../controllers/jobs";

// Express router for background job history and manual triggers.
export const jobsRouter = Router();

// GET /runs — recent background job run history.
jobsRouter.get(
  "/runs",
  // Require an authenticated session before listing job runs.
  requireAuth,
  // Authorize jobs.view for run history reads.
  requireAction("jobs.view"),
  // Delegate to the listRuns controller with async error forwarding.
  asyncHandler(JobsController.listRuns),
);

// POST /run — manually trigger a named background job (least privilege).
jobsRouter.post(
  "/run",
  // Require an authenticated session before triggering a job.
  requireAuth,
  // Authorize jobs.run separately from view for least privilege.
  requireAction("jobs.run"),
  // Delegate to the run controller with async error forwarding.
  asyncHandler(JobsController.run),
);
