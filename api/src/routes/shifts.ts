/**
 * /shifts — shift definitions and roster. List is auth-only; manage/roster
 * mutations require shifts.manage.
 */
import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import * as ShiftsController from "../controllers/shifts";

// Create the Express router for shift definition and roster endpoints.
export const shiftsRouter = Router();

// GET / — list shift definitions (any authenticated user).
shiftsRouter.get("/", requireAuth, asyncHandler(ShiftsController.list));

// GET /roster — roster assignments for manage UI.
shiftsRouter.get(
  "/roster",
  // Require an authenticated session before reading the roster.
  requireAuth,
  // Authorize shifts.manage for roster reads.
  requireAction("shifts.manage"),
  // Delegate to the roster list controller with async error forwarding.
  asyncHandler(ShiftsController.listRoster),
);

// PUT /roster — upsert roster row(s).
shiftsRouter.put(
  "/roster",
  // Require an authenticated session before upserting roster rows.
  requireAuth,
  // Authorize shifts.manage for roster writes.
  requireAction("shifts.manage"),
  // Delegate to the roster upsert controller with async error forwarding.
  asyncHandler(ShiftsController.upsertRoster),
);

// POST / — create a shift definition.
shiftsRouter.post(
  "/",
  // Require an authenticated session before creating a shift.
  requireAuth,
  // Authorize shifts.manage for shift creation.
  requireAction("shifts.manage"),
  // Delegate to the create controller with async error forwarding.
  asyncHandler(ShiftsController.create),
);

// PATCH /:id — update a shift definition.
shiftsRouter.patch(
  "/:id",
  // Require an authenticated session before updating a shift.
  requireAuth,
  // Authorize shifts.manage for shift updates.
  requireAction("shifts.manage"),
  // Delegate to the update controller with async error forwarding.
  asyncHandler(ShiftsController.update),
);
