/** /permissions — role grant matrix, history, and replace-role (permissions.manage). */
import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import * as PermissionsController from "../controllers/permissions";

export const permissionsRouter = Router();

// GET /matrix — full panel/action grant matrix for editable roles.
permissionsRouter.get(
  "/matrix",
  requireAuth,
  requireAction("permissions.manage"),
  PermissionsController.getMatrix,
);

// GET /history — grant change audit/history for the permissions UI.
permissionsRouter.get(
  "/history",
  requireAuth,
  requireAction("permissions.manage"),
  PermissionsController.listHistory,
);

// PUT /roles/:role — replace all grants for one role atomically.
permissionsRouter.put(
  "/roles/:role",
  requireAuth,
  requireAction("permissions.manage"),
  PermissionsController.replaceRole,
);
