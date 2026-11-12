/**
 * Short-lived access JWT helpers. Claims include sid (AuthSession id);
 * middleware reloads role/email from the DB after verify — do not trust JWT
 * role alone for authorization.
 */
// jsonwebtoken for HS256 sign/verify of access tokens.
import jwt from "jsonwebtoken";
// Role claim type mirrored from Prisma (reloaded from DB after verify).
import type { Role } from "@prisma/client";

/** Only HS256 is accepted for access tokens (SUS-002 / B3). */
export const ACCESS_JWT_ALGORITHMS = ["HS256"] as const;

/** Access-token claim shape; sid ties the token to an AuthSession row. */
export type AuthUser = {
  userId: string;
  employeeId: string;
  role: Role;
  email: string;
  sid: string;
};

/** Resolve JWT_SECRET from the environment; throw if unset. */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  // Missing secret must fail loudly — signing/verifying without one is unsafe.
  if (!secret) {
    throw new Error("JWT_SECRET is not set");
  }
  return secret;
}

/** Sign a 15-minute access token (refresh rotation issues a new one). */
export function signAccessToken(payload: AuthUser): string {
  // Short TTL limits damage if a token is leaked; refresh issues a replacement.
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: "15m",
    algorithm: "HS256",
  });
}

/**
 * Verify signature/expiry and require userId + sid.
 * Rejects SSE stream tickets (purpose=sse) — those belong in ?ticket= only.
 * Does not check session revocation — callers must assertSessionActive.
 */
export function verifyAccessToken(token: string): AuthUser {
  // Pin algorithms so `alg: none` / unexpected HMAC/RSA algs cannot verify.
  const decoded = jwt.verify(token, getJwtSecret(), {
    algorithms: [...ACCESS_JWT_ALGORITHMS],
  }) as AuthUser & {
    sid?: string;
    purpose?: unknown;
  };
  // SSE tickets must not authenticate requireAuth / ordinary API routes.
  if (decoded?.purpose === "sse") {
    throw new Error("SSE ticket is not an access token");
  }
  // Both userId and sid are required to bind the token to an AuthSession row.
  if (!decoded?.userId || !decoded?.sid) {
    throw new Error("Invalid token payload");
  }
  // Return a normalized claim object (drop any extra JWT fields).
  return {
    userId: decoded.userId,
    employeeId: decoded.employeeId,
    role: decoded.role,
    email: decoded.email,
    sid: decoded.sid,
  };
}
