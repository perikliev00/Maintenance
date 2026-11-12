/** /operations — live operations board snapshot (operations.view_live). */
import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import * as OperationsController from "../controllers/operations";

// Express router for the live operations board snapshot.
export const operationsRouter = Router();

// GET /live/attention — paginated needs-attention page (must be before /live if nested).
operationsRouter.get(
  "/live/attention",
  // Require an authenticated session before reading attention items.
  requireAuth,
  // Authorize operations.view_live for the attention page.
  requireAction("operations.view_live"),
  // Delegate to the liveAttention controller with async error forwarding.
  asyncHandler(OperationsController.liveAttention),
);

// GET /live — live board snapshot (rooms, tasks, tickets in scope).
operationsRouter.get(
  "/live",
  // Require an authenticated session before reading the live board.
  requireAuth,
  // Authorize operations.view_live for the board snapshot.
  requireAction("operations.view_live"),
  // Delegate to the live controller with async error forwarding.
  asyncHandler(OperationsController.live),
);
