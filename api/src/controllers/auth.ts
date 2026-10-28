/**
 * Auth HTTP handlers: login/refresh/logout and /me profile payload.
 * Access/refresh tokens are issued only via httpOnly cookies (never JSON body).
 */
import type { NextFunction, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod/v3";
import { Role } from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";
import { verifyAccessToken } from "../auth/tokens";
import { authenticateToken } from "../middleware/auth";
import {
  clearAuthCookies,
  extractAccessToken,
  issueAuthCookies,
  readRefreshToken,
} from "../middleware/session";
import {
  createSession,
  hashRefreshToken,
  revokeAllForUser,
  revokeAllUsingRefreshToken,
  assertSessionActive,
  revokeSession,
  rotateRefresh,
} from "../services/authSessions";
import { capabilitiesFor } from "../services/roleGrants";

/** Shape returned to the client after login or /me (panels/actions from RoleGrant). */
async function publicUser(user: {
  id: string;
  email: string;
  role: Role;
  employeeId: string;
  employee: { fullName: string };
}) {
  // Resolve panel/action grants and landing panel for this role.
  const caps = await capabilitiesFor(user.role);
  // Supervisors get an extra count of sectors they primary-supervise.
  let supervisedSectorCount: number | null = null;
  if (user.role === Role.supervisor) {
    supervisedSectorCount = await prisma.sector.count({
      where: {
        primarySupervisorEmployeeId: user.employeeId,
        isActive: true,
      },
    });
  }
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    employeeId: user.employeeId,
    fullName: user.employee.fullName,
    panels: caps.panels,
    actions: caps.actions,
    landing: caps.landing,
    supervisedSectorCount,
  };
}

/** Email/password login; rejects inactive or not-yet-activated accounts. */
export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
    }

    // Look up user by email with employee for publicUser payload.
    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email },
      include: { employee: true },
    });
    // Same 401 for missing vs inactive/archived to avoid account enumeration.
    if (!user || !user.isActive || user.employee.archivedAt) {
      return res.status(401).json({ error: "unauthorized", message: "Invalid credentials" });
    }

    // Invited but not yet redeemed on a device.
    if (!user.activatedAt) {
      return res.status(403).json({
        error: "not_activated",
        message: "Account is not activated. Use an invitation code on a device first.",
      });
    }

    // Constant-time-ish bcrypt compare of the password hash.
    const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: "unauthorized", message: "Invalid credentials" });
    }

    // Stamp last login for audit/ops visibility.
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Create AuthSession + access/refresh token pair.
    const tokens = await createSession({
      userId: user.id,
      userAgent: req.get("user-agent"),
      ip: req.ip,
    });

    // Set httpOnly session/refresh + CSRF cookies.
    issueAuthCookies(res, tokens);

    // Tokens only in httpOnly cookies — never in JSON body (XSS).
    return res.json({
      user: await publicUser(user),
      expiresIn: tokens.expiresIn,
    });
  } catch (err) {
    return next(err);
  }
}

/** Rotate cookies; only a confirmed authentication rejection clears them. */
export async function refresh(req: Request, res: Response, next: NextFunction) {
  try {
    // Cookie preferred; body fallback for non-browser clients.
    const refreshToken = readRefreshToken(req);
    if (!refreshToken) {
      return res.status(401).json({
        error: "unauthorized",
        message: "Missing refresh token",
      });
    }

    // Rotate refresh hash and mint a new access token.
    const tokens = await rotateRefresh(refreshToken, {
      userAgent: req.get("user-agent"),
      ip: req.ip,
    });

    issueAuthCookies(res, tokens);
    return res.json({ ok: true, expiresIn: tokens.expiresIn });
  } catch (err) {
    if (err instanceof AppError && (err.status === 401 || err.status === 403)) {
      clearAuthCookies(res);
    }
    return next(err);
  }
}

/**
 * Revoke the current session via access token when possible; otherwise look up
 * the refresh-token hash. Always clears cookies so the browser drops credentials.
 */
export async function logout(req: Request, res: Response) {
  try {
    let revoked = false;
    // Prefer revoking by access-token session id.
    const extracted = extractAccessToken(req);
    if (extracted) {
      try {
        const user = await authenticateToken(extracted.token);
        await revokeSession(user.sid);
        revoked = true;
      } catch {
        // fall through to refresh-token revoke
      }
    }

    // Fallback: look up session by refresh-token hash when access token is gone/invalid.
    if (!revoked) {
      const refreshToken = readRefreshToken(req);
      if (refreshToken) {
        const hash = hashRefreshToken(refreshToken);
        const session = await prisma.authSession.findUnique({
          where: { refreshTokenHash: hash },
          select: { id: true },
        });
        if (session) {
          await revokeSession(session.id);
        }
      }
    }

    // Always clear cookies even if no session row was found.
    clearAuthCookies(res);
    return res.json({ ok: true });
  } catch (err) {
    clearAuthCookies(res);
    throw err;
  }
}

/** Revoke all sessions using refresh credentials, or a valid access token. */
export async function logoutAll(req: Request, res: Response) {
  // Browser access cookies expire sooner than refresh cookies. Authenticate the
  // refresh under the same User lock as revocation; never rotate it just to logout.
  const refreshToken = readRefreshToken(req);
  let count: number;
  if (refreshToken) {
    count = await revokeAllUsingRefreshToken(refreshToken);
  } else {
    const access = extractAccessToken(req);
    if (!access) throw new AppError(401, "unauthorized", "Missing token");
    let claims;
    try { claims = verifyAccessToken(access.token); }
    catch { throw new AppError(401, "unauthorized", "Invalid token"); }
    await assertSessionActive(claims.sid, claims.userId);
    count = await revokeAllForUser(claims.userId);
  }
  clearAuthCookies(res);
  return res.json({ ok: true, revoked: count });
}

/** Current user profile + capability panels/actions. */
export async function me(req: Request, res: Response) {
  // Reload user from DB so role/active changes apply immediately.
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    include: { employee: true },
  });
  // Missing, blocked, or archived accounts cannot use /me.
  if (!user || !user.isActive || user.employee.archivedAt) {
    return res.status(401).json({
      error: "unauthorized",
      message: !user ? "User not found" : "Account blocked",
    });
  }
  return res.json(await publicUser(user));
}
