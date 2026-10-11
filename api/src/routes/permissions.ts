import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import * as PermissionsController from "../controllers/permissions";

export const permissionsRouter = Router();

permissionsRouter.get(
  "/matrix",
  requireAuth,
  requireAction("permissions.manage"),
  PermissionsController.getMatrix,
);

permissionsRouter.get(
  "/history",
  requireAuth,
  requireAction("permissions.manage"),
  PermissionsController.listHistory,
);

permissionsRouter.put(
  "/roles/:role",
  requireAuth,
  requireAction("permissions.manage"),
  PermissionsController.replaceRole,
);
