import { Router } from "express";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireAuth, requireAction } from "../middleware/auth";
import { invitationRedeemLimiter } from "../middleware/security";
import { issueAuthCookies } from "../middleware/session";
import { AppError } from "../services/cleaning";
import {
  issueInvitation,
  listActiveInvitations,
  listDevices,
  redeemInvitation,
  revokeDevice,
  revokeInvitation,
} from "../services/invitations";

export const invitationsRouter = Router();
export const devicesRouter = Router();

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

invitationsRouter.post(
  "/redeem",
  invitationRedeemLimiter,
  async (req, res, next) => {
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
  },
);

invitationsRouter.post(
  "/",
  requireAuth,
  requireAction("people.invite"),
  async (req, res, next) => {
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
  },
);

invitationsRouter.get(
  "/",
  requireAuth,
  requireAction("people.invite"),
  async (_req, res, next) => {
    try {
      const list = await listActiveInvitations();
      return res.json(list);
    } catch (err) {
      return next(err);
    }
  },
);

invitationsRouter.post(
  "/:id/revoke",
  requireAuth,
  requireAction("people.invite"),
  async (req, res, next) => {
    try {
      const updated = await revokeInvitation(req.params.id);
      return res.json(updated);
    } catch (err) {
      return next(err);
    }
  },
);

devicesRouter.get(
  "/",
  requireAuth,
  requireAction("people.invite"),
  async (req, res, next) => {
    try {
      const employeeId =
        typeof req.query.employeeId === "string"
          ? req.query.employeeId
          : undefined;
      const list = await listDevices(employeeId);
      return res.json(list);
    } catch (err) {
      return next(err);
    }
  },
);

devicesRouter.post(
  "/:id/revoke",
  requireAuth,
  requireAction("people.invite"),
  async (req, res, next) => {
    try {
      const updated = await revokeDevice(req.params.id);
      return res.json(updated);
    } catch (err) {
      return next(err);
    }
  },
);

function errorHandler(
  err: unknown,
  _req: any,
  res: any,
  next: any,
) {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: err.code,
      message: err.message,
      details: err.details,
    });
  }
  return next(err);
}

invitationsRouter.use(errorHandler);
devicesRouter.use(errorHandler);
