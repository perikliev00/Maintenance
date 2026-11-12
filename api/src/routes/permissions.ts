/** /permissions — role grant matrix, history, and replace-role (permissions.manage). */
import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import * as PermissionsController from "../controllers/permissions";

// Create the Express router for role-permission management endpoints.
export const permissionsRouter = Router();

// GET /matrix — full panel/action grant matrix for editable roles.
permissionsRouter.get(
  "/matrix",
  // Require an authenticated session before reading the grant matrix.
  requireAuth,
  // Authorize permissions.manage for matrix reads.
  requireAction("permissions.manage"),
  // Delegate to the matrix controller with async error forwarding.
  asyncHandler(PermissionsController.getMatrix),
);

// GET /history — grant change audit/history for the permissions UI.
permissionsRouter.get(
  "/history",
  // Require an authenticated session before reading grant history.
  requireAuth,
  // Authorize permissions.manage for history reads.
  requireAction("permissions.manage"),
  // Delegate to the history controller with async error forwarding.
  asyncHandler(PermissionsController.listHistory),
);

// PUT /roles/:role — replace all grants for one role atomically.
permissionsRouter.put(
  "/roles/:role",
  // Require an authenticated session before replacing role grants.
  requireAuth,
  // Authorize permissions.manage for grant replacement.
  requireAction("permissions.manage"),
  // Delegate to the replace-role controller with async error forwarding.
  asyncHandler(PermissionsController.replaceRole),
);
