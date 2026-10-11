import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import * as JobsController from "../controllers/jobs";

export const jobsRouter = Router();

jobsRouter.get(
  "/runs",
  requireAuth,
  requireAction("jobs.view"),
  JobsController.listRuns,
);

jobsRouter.post(
  "/run",
  requireAuth,
  requireAction("jobs.view"),
  JobsController.run,
);
