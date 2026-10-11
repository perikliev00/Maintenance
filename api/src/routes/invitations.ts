import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import { invitationRedeemLimiter } from "../middleware/security";
import * as invitationsController from "../controllers/invitations";

export const invitationsRouter = Router();
export const devicesRouter = Router();

invitationsRouter.post(
  "/redeem",
  invitationRedeemLimiter,
  invitationsController.redeem,
);

invitationsRouter.post(
  "/",
  requireAuth,
  requireAction("people.invite"),
  invitationsController.issue,
);

invitationsRouter.get(
  "/",
  requireAuth,
  requireAction("people.invite"),
  invitationsController.list,
);

invitationsRouter.post(
  "/:id/revoke",
  requireAuth,
  requireAction("people.invite"),
  invitationsController.revoke,
);

devicesRouter.get(
  "/",
  requireAuth,
  requireAction("people.invite"),
  invitationsController.listDevices,
);

devicesRouter.post(
  "/:id/revoke",
  requireAuth,
  requireAction("people.invite"),
  invitationsController.revokeDevice,
);
