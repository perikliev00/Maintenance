import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import * as OperationsController from "../controllers/operations";

export const operationsRouter = Router();

operationsRouter.get(
  "/live",
  requireAuth,
  requireAction("operations.view_live"),
  OperationsController.live,
);
