import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";

export type AuthUser = {
  userId: string;
  employeeId: string;
  role: Role;
  email: string;
  sid: string;
};

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set");
  }
  return secret;
}

export function signAccessToken(payload: AuthUser): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: "15m" });
}

export function verifyAccessToken(token: string): AuthUser {
  const decoded = jwt.verify(token, getJwtSecret()) as AuthUser & {
    sid?: string;
  };
  if (!decoded?.userId || !decoded?.sid) {
    throw new Error("Invalid token payload");
  }
  return {
    userId: decoded.userId,
    employeeId: decoded.employeeId,
    role: decoded.role,
    email: decoded.email,
    sid: decoded.sid,
  };
}
