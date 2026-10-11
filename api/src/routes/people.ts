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

peopleRouter.patch(
  "/:id/role",
  requireAuth,
  requireAction("people.change_role"),
  peopleController.changeRole,
);
