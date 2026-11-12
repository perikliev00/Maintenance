/**
 * Invitation issue/redeem/revoke and device list/revoke.
 * Redeem is public (rate-limited on the route) and sets auth cookies on success.
 */
import type { NextFunction, Request, Response } from "express";
// Import dependency @prisma/client.
import { Role } from "@prisma/client";
// Import dependency zod/v3.
import { z } from "zod/v3";
// Import local module ../middleware/session.
import { issueAuthCookies } from "../middleware/session";
// Continue named import list.
import {
  // Bring issueInvitation into scope from the import.
  issueInvitation,
  // Bring listActiveInvitations into scope from the import.
  listActiveInvitations,
  // Bring listDevices into scope from the import.
  listDevices as fetchDevices,
  // Bring redeemInvitation into scope from the import.
  redeemInvitation,
  // Bring revokeDevice into scope from the import.
  revokeDevice as revokeDeviceById,
  // Bring revokeInvitation into scope from the import.
  revokeInvitation,
} from "../services/invitations";

/** Invite payload for creating a brand-new employee + user. */
const newInviteSchema = z.object({
  // Validate field kind.
  kind: z.literal("new"),
  // Validate field fullName.
  fullName: z.string().min(1).max(200),
  // Validate field employeeNumber.
  employeeNumber: z.string().min(1).max(40),
  // Validate field email.
  email: z.string().email(),
  // Validate field role.
  role: z.nativeEnum(Role),
  // Validate field department.
  department: z.string().max(120).optional().nullable(),
});

/** Invite payload for an existing employee who needs a device/activation. */
const existingInviteSchema = z.object({
  // Validate field kind.
  kind: z.literal("existing"),
  // Validate field employeeId.
  employeeId: z.string().min(1),
  // Validate field email.
  email: z.string().email().optional(),
  // Validate field role.
  role: z.nativeEnum(Role).optional(),
});

/** Discriminated union on `kind` for issue body validation. */
const issueSchema = z.discriminatedUnion("kind", [
  // Pass newInviteSchema through.
  newInviteSchema,
  // Pass existingInviteSchema through.
  existingInviteSchema,
]);

/**
 * Activate an invite on a device; strips tokens from the JSON body after
 * setting httpOnly cookies (same XSS posture as login).
 */
export async function redeem(req: Request, res: Response) {
  // Zod schema schema for request validation.
  const schema = z.object({
    // Validate field code.
    code: z.string().min(4).max(40),
    // Validate field password.
    password: z.string().min(8).max(200).optional(),
    // Validate field deviceLabel.
    deviceLabel: z.string().min(1).max(120),
    // Validate field fingerprint.
    fingerprint: z.string().min(1).max(200),
  });
  // Parse and validate input against the schema.
  const parsed = schema.safeParse(req.body);
  // Reject malformed input before any side effects.
  if (!parsed.success) {
    // Bad-request validation error response.
    return res.status(400).json({
      // Provide error for the object/call below.
      error: "validation",
      // Provide details for the object/call below.
      details: parsed.error.flatten(),
    });
  }
  // Redeem creates/activates user, device, and session tokens.
  const result = await redeemInvitation(parsed.data);
  // Prefer cookies over returning raw tokens in JSON.
  issueAuthCookies(res, {
    // Provide accessToken for the object/call below.
    accessToken: result.accessToken,
    // Provide refreshToken for the object/call below.
    refreshToken: result.refreshToken,
  });
  // Do not return access/refresh tokens in JSON (httpOnly cookies only).
  const {
    // Provide token for the object/call below.
    token: _token,
    // Provide accessToken for the object/call below.
    accessToken: _access,
    // Provide refreshToken for the object/call below.
    refreshToken: _refresh,
    // Provide expiresIn for the object/call below.
    expiresIn: _expires,
    // Provide sessionId for the object/call below.
    sessionId: _sid,
    // Continue the controller logic.
    ...rest
  // Continue the controller logic.
  } = result;
  // JSON success response with the payload.
  return res.json(rest);
}

/** POST /invitations — issue a new or existing-employee invite. */
export async function issue(req: Request, res: Response) {
  // Parse and validate input against the schema.
  const parsed = issueSchema.safeParse(req.body);
  // Reject malformed input before any side effects.
  if (!parsed.success) {
    // Bad-request validation error response.
    return res.status(400).json({
      // Provide error for the object/call below.
      error: "validation",
      // Provide details for the object/call below.
      details: parsed.error.flatten(),
    });
  }
  // Invoke service and capture the result payload.
  const result = await issueInvitation(
    // Continue the controller logic.
    { userId: req.user!.userId, role: req.user!.role },
    // Pass parsed.data through.
    parsed.data,
  );
  // Created response with the new resource body.
  return res.status(201).json(result);
}

/** GET /invitations — list active (unredeemed/unrevoked) invites. */
export async function list(_req: Request, res: Response) {
  // Await async work into list.
  const list = await listActiveInvitations();
  // JSON success response with the payload.
  return res.json(list);
}

/** POST /invitations/:id/revoke — revoke an unused invitation. */
export async function revoke(req: Request, res: Response) {
  // Await async work into updated.
  const updated = await revokeInvitation(req.params.id);
  // JSON success response with the payload.
  return res.json(updated);
}

/** GET /devices — list activated devices (optional employeeId filter). */
export async function listDevices(
  // Provide req for the object/call below.
  req: Request,
  // Provide res for the object/call below.
  res: Response,
  // Provide next for the object/call below.
  next: NextFunction,
// Continue the controller logic.
) {
  // Bind employeeId for use in the handler below.
  const employeeId =
    // Narrow the runtime type before using the value.
    typeof req.query.employeeId === "string"
      // Continue the conditional expression.
      ? req.query.employeeId
      // Continue the conditional expression.
      : undefined;
  // Await async work into list.
  const list = await fetchDevices(employeeId);
  // JSON success response with the payload.
  return res.json(list);
}

/** POST /devices/:id/revoke — revoke a device activation. */
export async function revokeDevice(
  // Provide req for the object/call below.
  req: Request,
  // Provide res for the object/call below.
  res: Response,
  // Provide next for the object/call below.
  next: NextFunction,
// Continue the controller logic.
) {
  // Await async work into updated.
  const updated = await revokeDeviceById(req.params.id, {
    // Provide employeeId for the object/call below.
    employeeId: req.user!.employeeId,
    // Provide role for the object/call below.
    role: req.user!.role,
  });
  // JSON success response with the payload.
  return res.json(updated);
}
