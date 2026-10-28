/** /people — staff directory, role changes, and access lifecycle. */
import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import * as peopleController from "../controllers/people";

export const peopleRouter = Router();

peopleRouter.get(
  "/",
  requireAuth,
  requireAction("people.view"),
  peopleController.list,
);

peopleRouter.get(
  "/:employeeId",
  requireAuth,
  requireAction("people.view"),
  peopleController.getOne,
);

peopleRouter.post(
  "/:employeeId/block",
  requireAuth,
  requireAction("people.manage_access"),
  peopleController.block,
);

peopleRouter.post(
  "/:employeeId/unblock",
  requireAuth,
  requireAction("people.manage_access"),
  peopleController.unblock,
);

peopleRouter.post(
  "/:employeeId/archive",
  requireAuth,
  requireAction("people.manage_access"),
  peopleController.archive,
);

peopleRouter.post(
  "/:employeeId/restore",
  requireAuth,
  requireAction("people.manage_access"),
  peopleController.restore,
);

// PATCH /:id/role — :id is User id (legacy ControlPage contract).
peopleRouter.patch(
  "/:id/role",
  requireAuth,
  requireAction("people.change_role"),
  peopleController.changeRole,
);
