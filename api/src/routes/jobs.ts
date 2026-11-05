/** NEW-05: GET /runs needs jobs.view; POST /run needs jobs.run (separate grants). */
import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import * as JobsController from "../controllers/jobs";

export const jobsRouter = Router();

// GET /runs — recent background job run history.
jobsRouter.get(
  "/runs",
  requireAuth,
  requireAction("jobs.view"),
  asyncHandler(JobsController.listRuns),
);

// POST /run — manually trigger a named background job (least privilege).
jobsRouter.post(
  "/run",
  requireAuth,
  requireAction("jobs.run"),
  asyncHandler(JobsController.run),
);
