/**
 * /invitations — issue/list/revoke invites; public redeem is rate-limited (no auth).
 * /devices — list/revoke activated devices (mounted separately in app.ts).
 */
import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import { invitationRedeemLimiter } from "../middleware/security";
import * as invitationsController from "../controllers/invitations";

// Express router for invite issue/list/revoke and public redeem.
export const invitationsRouter = Router();
// Separate router mounted at /devices for activated-device admin.
export const devicesRouter = Router();

// POST /redeem — public: redeem an invite code on a new device (rate-limited).
invitationsRouter.post(
  "/redeem",
  // Throttle public redeem attempts to limit invite-code guessing.
  invitationRedeemLimiter,
  // Delegate to the redeem controller with async error forwarding.
  asyncHandler(invitationsController.redeem),
);

// POST / — issue a new invitation for a role/email.
invitationsRouter.post(
  "/",
  // Require an authenticated session before issuing invitations.
  requireAuth,
  // Authorize people.invite for invitation issuance.
  requireAction("people.invite"),
  // Delegate to the issue controller with async error forwarding.
  asyncHandler(invitationsController.issue),
);

// GET / — list outstanding invitations.
invitationsRouter.get(
  "/",
  // Require an authenticated session before listing invitations.
  requireAuth,
  // Authorize people.invite for invitation list reads.
  requireAction("people.invite"),
  // Delegate to the list controller with async error forwarding.
  asyncHandler(invitationsController.list),
);

// POST /:id/revoke — revoke an unused invitation.
invitationsRouter.post(
  "/:id/revoke",
  // Require an authenticated session before revoking an invitation.
  requireAuth,
  // Authorize people.invite for invitation revocation.
  requireAction("people.invite"),
  // Delegate to the revoke controller with async error forwarding.
  asyncHandler(invitationsController.revoke),
);

// GET /devices/ — list activated devices (people.manage_access gate).
devicesRouter.get(
  "/",
  // Require an authenticated session before listing devices.
  requireAuth,
  // Authorize people.manage_access for device inventory.
  requireAction("people.manage_access"),
  // Delegate to the listDevices controller with async error forwarding.
  asyncHandler(invitationsController.listDevices),
);

// POST /devices/:id/revoke — revoke a device activation.
devicesRouter.post(
  "/:id/revoke",
  // Require an authenticated session before revoking a device.
  requireAuth,
  // Authorize people.manage_access for device revocation.
  requireAction("people.manage_access"),
  // Delegate to the revokeDevice controller with async error forwarding.
  asyncHandler(invitationsController.revokeDevice),
);
