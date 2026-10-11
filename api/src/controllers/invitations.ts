import type { NextFunction, Request, Response } from "express";
import { Role } from "@prisma/client";
import { z } from "zod";
import { issueAuthCookies } from "../middleware/session";
import {
  issueInvitation,
  listActiveInvitations,
  listDevices as fetchDevices,
  redeemInvitation,
  revokeDevice as revokeDeviceById,
  revokeInvitation,
} from "../services/invitations";

const newInviteSchema = z.object({
  kind: z.literal("new"),
  fullName: z.string().min(1).max(200),
  employeeNumber: z.string().min(1).max(40),
  email: z.string().email(),
  role: z.nativeEnum(Role),
  department: z.string().max(120).optional().nullable(),
});

const existingInviteSchema = z.object({
  kind: z.literal("existing"),
  employeeId: z.string().min(1),
  email: z.string().email().optional(),
  role: z.nativeEnum(Role).optional(),
});

const issueSchema = z.discriminatedUnion("kind", [
  newInviteSchema,
  existingInviteSchema,
]);

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
    const result = await redeemInvitation(parsed.data);
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

export async function issue(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = issueSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "validation",
        details: parsed.error.flatten(),
      });
    }
    const origin =
      typeof req.headers.origin === "string" && req.headers.origin
        ? req.headers.origin
        : process.env.WEB_ORIGIN ?? "http://localhost:5173";
    const result = await issueInvitation(
      { userId: req.user!.userId, role: req.user!.role },
      parsed.data,
      origin,
    );
    return res.status(201).json(result);
  } catch (err) {
    return next(err);
  }
}

export async function list(_req: Request, res: Response, next: NextFunction) {
  try {
    const list = await listActiveInvitations();
    return res.json(list);
  } catch (err) {
    return next(err);
  }
}

export async function revoke(req: Request, res: Response, next: NextFunction) {
  try {
    const updated = await revokeInvitation(req.params.id);
    return res.json(updated);
  } catch (err) {
    return next(err);
  }
}

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

export async function revokeDevice(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const updated = await revokeDeviceById(req.params.id);
    return res.json(updated);
  } catch (err) {
    return next(err);
  }
}
