/**
 * Invitation issue/redeem/revoke and device list/revoke.
 * Redeem is public (rate-limited on the route) and sets auth cookies on success.
 */
import type { NextFunction, Request, Response } from "express";
import { Role } from "@prisma/client";
import { z } from "zod/v3";
import { issueAuthCookies } from "../middleware/session";
import {
  issueInvitation,
  listActiveInvitations,
  listDevices as fetchDevices,
  redeemInvitation,
  revokeDevice as revokeDeviceById,
  revokeInvitation,
} from "../services/invitations";

/** Invite payload for creating a brand-new employee + user. */
const newInviteSchema = z.object({
  kind: z.literal("new"),
  fullName: z.string().min(1).max(200),
  employeeNumber: z.string().min(1).max(40),
  email: z.string().email(),
  role: z.nativeEnum(Role),
  department: z.string().max(120).optional().nullable(),
});

/** Invite payload for an existing employee who needs a device/activation. */
const existingInviteSchema = z.object({
  kind: z.literal("existing"),
  employeeId: z.string().min(1),
  email: z.string().email().optional(),
  role: z.nativeEnum(Role).optional(),
});

/** Discriminated union on `kind` for issue body validation. */
const issueSchema = z.discriminatedUnion("kind", [
  newInviteSchema,
  existingInviteSchema,
]);

/**
 * Activate an invite on a device; strips tokens from the JSON body after
 * setting httpOnly cookies (same XSS posture as login).
 */
export async function redeem(req: Request, res: Response, next: NextFunction) {
  try {
    const schema = z.object({
      code: z.string().min(4).max(40),
      password: z.string().min(8).max(200).optional(),
      deviceLabel: z.string().min(1).max(120),
      fingerprint: z.string().min(1).max(200),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "validation",
        details: parsed.error.flatten(),
      });
    }
    // Redeem creates/activates user, device, and session tokens.
    const result = await redeemInvitation(parsed.data);
    // Prefer cookies over returning raw tokens in JSON.
    issueAuthCookies(res, {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
    // Do not return access/refresh tokens in JSON (httpOnly cookies only).
    const {
      token: _token,
      accessToken: _access,
      refreshToken: _refresh,
      expiresIn: _expires,
      sessionId: _sid,
      ...rest
    } = result;
    return res.json(rest);
  } catch (err) {
    return next(err);
  }
}

/** POST /invitations — issue a new or existing-employee invite. */
export async function issue(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = issueSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "validation",
        details: parsed.error.flatten(),
      });
    }
    const result = await issueInvitation(
      { userId: req.user!.userId, role: req.user!.role },
      parsed.data,
    );
    return res.status(201).json(result);
  } catch (err) {
    return next(err);
  }
}

/** GET /invitations — list active (unredeemed/unrevoked) invites. */
export async function list(_req: Request, res: Response, next: NextFunction) {
  try {
    const list = await listActiveInvitations();
    return res.json(list);
  } catch (err) {
    return next(err);
  }
}

/** POST /invitations/:id/revoke — revoke an unused invitation. */
export async function revoke(req: Request, res: Response, next: NextFunction) {
  try {
    const updated = await revokeInvitation(req.params.id);
    return res.json(updated);
  } catch (err) {
    return next(err);
  }
}

/** GET /devices — list activated devices (optional employeeId filter). */
export async function listDevices(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const employeeId =
      typeof req.query.employeeId === "string"
        ? req.query.employeeId
        : undefined;
    const list = await fetchDevices(employeeId);
    return res.json(list);
  } catch (err) {
    return next(err);
  }
}

/** POST /devices/:id/revoke — revoke a device activation. */
export async function revokeDevice(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const updated = await revokeDeviceById(req.params.id, {
      employeeId: req.user!.employeeId,
      role: req.user!.role,
    });
    return res.json(updated);
  } catch (err) {
    return next(err);
  }
}
