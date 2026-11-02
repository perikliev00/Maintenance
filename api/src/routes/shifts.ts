/**
 * /shifts — shift definitions and roster. List is auth-only; manage/roster
 * mutations require shifts.manage.
 */
import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import * as ShiftsController from "../controllers/shifts";

export const shiftsRouter = Router();

// GET / — list shift definitions (any authenticated user).
shiftsRouter.get("/", requireAuth, asyncHandler(ShiftsController.list));

// GET /roster — roster assignments for manage UI.
shiftsRouter.get(
  "/roster",
  requireAuth,
  requireAction("shifts.manage"),
  asyncHandler(ShiftsController.listRoster),
);

// PUT /roster — upsert roster row(s).
shiftsRouter.put(
  "/roster",
  requireAuth,
  requireAction("shifts.manage"),
  asyncHandler(ShiftsController.upsertRoster),
);

// POST / — create a shift definition.
shiftsRouter.post(
  "/",
  requireAuth,
  requireAction("shifts.manage"),
  asyncHandler(ShiftsController.create),
);

// PATCH /:id — update a shift definition.
shiftsRouter.patch(
  "/:id",
  requireAuth,
  requireAction("shifts.manage"),
  asyncHandler(ShiftsController.update),
);
