/** /operations — live operations board snapshot (operations.view_live). */
import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import * as OperationsController from "../controllers/operations";

export const operationsRouter = Router();

// GET /live — live board snapshot (rooms, tasks, tickets in scope).
operationsRouter.get(
  "/live",
  requireAuth,
  requireAction("operations.view_live"),
  OperationsController.live,
);
