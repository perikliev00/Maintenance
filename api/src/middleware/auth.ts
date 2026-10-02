import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";
import { Action, canPerform, isOwner } from "../permissions";

export type AuthUser = {
  userId: string;
  employeeId: string;
  role: Role;
  email: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set");
  }
  return secret;
}

export function signToken(payload: AuthUser): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: "12h" });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "unauthorized", message: "Missing token" });
  }

  try {
    const token = header.slice("Bearer ".length);
    const decoded = jwt.verify(token, getJwtSecret()) as AuthUser;
    req.user = decoded;
    return next();
  } catch {
    return res.status(401).json({ error: "unauthorized", message: "Invalid token" });
  }
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
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "unauthorized", message: "Missing user" });
    }
    if (canPerform(req.user.role, action)) {
      return next();
    }
    return res.status(403).json({
      error: "forbidden",
      message: "Insufficient permissions",
    });
  };
}
