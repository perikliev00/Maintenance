/**
 * /invitations — issue/list/revoke invites; public redeem is rate-limited (no auth).
 * /devices — list/revoke activated devices (mounted separately in app.ts).
 */
import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import { invitationRedeemLimiter } from "../middleware/security";
import * as invitationsController from "../controllers/invitations";

export const invitationsRouter = Router();
export const devicesRouter = Router();

// POST /redeem — public: redeem an invite code on a new device (rate-limited).
invitationsRouter.post(
  "/redeem",
  invitationRedeemLimiter,
  asyncHandler(invitationsController.redeem),
);

// POST / — issue a new invitation for a role/email.
invitationsRouter.post(
  "/",
  requireAuth,
  requireAction("people.invite"),
  asyncHandler(invitationsController.issue),
);

// GET / — list outstanding invitations.
invitationsRouter.get(
  "/",
  requireAuth,
  requireAction("people.invite"),
  asyncHandler(invitationsController.list),
);

// POST /:id/revoke — revoke an unused invitation.
invitationsRouter.post(
  "/:id/revoke",
  requireAuth,
  requireAction("people.invite"),
  asyncHandler(invitationsController.revoke),
);

// GET /devices/ — list activated devices (people.manage_access gate).
devicesRouter.get(
  "/",
  requireAuth,
  requireAction("people.manage_access"),
  asyncHandler(invitationsController.listDevices),
);

// POST /devices/:id/revoke — revoke a device activation.
devicesRouter.post(
  "/:id/revoke",
  requireAuth,
  requireAction("people.manage_access"),
  asyncHandler(invitationsController.revokeDevice),
);
