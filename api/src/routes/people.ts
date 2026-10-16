/** /people — staff directory and role changes (people.view / people.change_role). */
import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import * as peopleController from "../controllers/people";

export const peopleRouter = Router();

// GET / — staff directory (users/employees visible to the caller).
peopleRouter.get(
  "/",
  requireAuth,
  requireAction("people.view"),
  peopleController.list,
);

// PATCH /:id/role — change a user's role (assignableRolesFor enforced in controller).
peopleRouter.patch(
  "/:id/role",
  requireAuth,
  requireAction("people.change_role"),
  peopleController.changeRole,
);
