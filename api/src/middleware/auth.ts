import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";

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

export function requireRoles(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "unauthorized", message: "Missing user" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: "forbidden",
        message: "Insufficient permissions",
      });
    }
    return next();
  };
}
