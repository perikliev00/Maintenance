/**
 * Auth HTTP handlers: login/refresh/logout and /me profile payload.
 * Access/refresh tokens are issued only via httpOnly cookies (never JSON body).
 */
import type { Request, Response } from "express";
import { z } from "zod/v3";
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
import { publicUser } from "../services/authProfile";
import { loginWithCredentials } from "../services/authLogin";
import {
  hashRefreshToken,
  revokeAllForUser,
  revokeAllUsingRefreshToken,
  assertSessionActive,
  revokeSession,
  rotateRefresh,
} from "../services/authSessions";

/** Email/password login; rejects inactive or not-yet-activated accounts. */
export async function login(req: Request, res: Response) {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
  }

  const { user, tokens } = await loginWithCredentials(parsed.data, {
    userAgent: req.get("user-agent") ?? undefined,
    ip: req.ip,
  });

  // Set httpOnly session/refresh + CSRF cookies.
  issueAuthCookies(res, tokens);

  // Tokens only in httpOnly cookies — never in JSON body (XSS).
  return res.json({
    user,
    expiresIn: tokens.expiresIn,
  });
}

/** Rotate cookies; only a confirmed authentication rejection clears them. */
export async function refresh(req: Request, res: Response) {
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
    // Clear stale cookies on auth rejection; asyncHandler forwards the error.
    if (err instanceof AppError && (err.status === 401 || err.status === 403)) {
      clearAuthCookies(res);
    }
    throw err;
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
