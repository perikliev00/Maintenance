import { Request, Response, NextFunction } from "express";
import { Role } from "@prisma/client";
import { Action, isOwner } from "../permissions";
import { canPerform } from "../services/roleGrants";
import { assertSessionActive } from "../services/authSessions";
import {
  signAccessToken,
  verifyAccessToken,
  type AuthUser,
} from "../auth/tokens";
import { extractAccessToken, type AuthVia } from "./session";

export type { AuthUser };
export { signAccessToken, verifyAccessToken };

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      authVia?: AuthVia;
    }
  }
}

/** @deprecated Prefer createSession() which issues access+refresh. */
export function signToken(payload: AuthUser): string {
  return signAccessToken(payload);
}

/** Verify JWT + active AuthSession + active user; role/email from DB (not JWT). */
export async function authenticateToken(token: string): Promise<AuthUser> {
  const decoded = verifyAccessToken(token);
  const session = await assertSessionActive(decoded.sid, decoded.userId);
  return {
    userId: session.user.id,
    employeeId: session.user.employeeId,
    role: session.user.role,
    email: session.user.email,
    sid: session.id,
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const extracted = extractAccessToken(req);
  if (!extracted) {
    return res.status(401).json({ error: "unauthorized", message: "Missing token" });
  }

  authenticateToken(extracted.token)
    .then((decoded) => {
      req.user = decoded;
      req.authVia = extracted.via;
      next();
    })
    .catch(() => {
      res.status(401).json({ error: "unauthorized", message: "Invalid token" });
    });
}

/** Owner always passes. Otherwise role must be in the list. */
export function requireRoles(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "unauthorized", message: "Missing user" });
    }
    if (isOwner(req.user.role) || roles.includes(req.user.role)) {
      return next();
    }
    return res.status(403).json({
      error: "forbidden",
      message: "Insufficient permissions",
    });
  };
}

export function requireAction(action: Action) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "unauthorized", message: "Missing user" });
    }
    try {
      if (await canPerform(req.user.role, action)) {
        return next();
      }
      return res.status(403).json({
        error: "forbidden",
        message: "Insufficient permissions",
      });
    } catch (err) {
      return next(err);
    }
  };
}
