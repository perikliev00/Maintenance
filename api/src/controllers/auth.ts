/**
 * Auth HTTP handlers: login/refresh/logout and /me profile payload.
 * Access/refresh tokens are issued only via httpOnly cookies (never JSON body).
 */
import type { Request, Response } from "express";
import { z } from "zod/v3";
// Import local module ../db.
import { prisma } from "../db";
// Import local module ../errors.
import { AppError } from "../errors";
// Import local module ../auth/tokens.
import { verifyAccessToken } from "../auth/tokens";
// Import local module ../middleware/auth.
import { authenticateToken } from "../middleware/auth";
// Continue named import list.
import {
  // Bring clearAuthCookies into scope from the import.
  clearAuthCookies,
  // Bring extractAccessToken into scope from the import.
  extractAccessToken,
  // Bring issueAuthCookies into scope from the import.
  issueAuthCookies,
  // Bring readRefreshToken into scope from the import.
  readRefreshToken,
} from "../middleware/session";
// Import local module ../services/authProfile.
import { publicUser } from "../services/authProfile";
// Import local module ../services/authLogin.
import { loginWithCredentials } from "../services/authLogin";
// Continue named import list.
import {
  // Bring hashRefreshToken into scope from the import.
  hashRefreshToken,
  // Bring revokeAllForUser into scope from the import.
  revokeAllForUser,
  // Bring revokeAllUsingRefreshToken into scope from the import.
  revokeAllUsingRefreshToken,
  // Bring assertSessionActive into scope from the import.
  assertSessionActive,
  // Bring revokeSession into scope from the import.
  revokeSession,
  // Bring rotateRefresh into scope from the import.
  rotateRefresh,
} from "../services/authSessions";

/** Email/password login; rejects inactive or not-yet-activated accounts. */
export async function login(req: Request, res: Response) {
  // Zod schema schema for request validation.
  const schema = z.object({
    // Validate field email.
    email: z.string().email(),
    // Validate field password.
    password: z.string().min(1),
  });
  // Parse and validate input against the schema.
  const parsed = schema.safeParse(req.body);
  // Reject malformed input before any side effects.
  if (!parsed.success) {
    // Bad-request validation error response.
    return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
  }

  // Continue the controller logic.
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
  // Try block for operations that may throw.
  try {
    // Cookie preferred; body fallback for non-browser clients.
    const refreshToken = readRefreshToken(req);
    // Guard: skip or fail when the negated condition holds.
    if (!refreshToken) {
      // Unauthorized when auth is missing or invalid.
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

    // Continue the controller logic.
    issueAuthCookies(res, tokens);
    // JSON success response with the payload.
    return res.json({ ok: true, expiresIn: tokens.expiresIn });
  // Continue the controller logic.
  } catch (err) {
    // Clear stale cookies on auth rejection; asyncHandler forwards the error.
    if (err instanceof AppError && (err.status === 401 || err.status === 403)) {
      // Continue the controller logic.
      clearAuthCookies(res);
    }
    // Abort with an application/HTTP error.
    throw err;
  }
}

/**
 * Revoke the current session via access token when possible; otherwise look up
 * the refresh-token hash. Always clears cookies so the browser drops credentials.
 */
export async function logout(req: Request, res: Response) {
  // Try block for operations that may throw.
  try {
    // Mutable revoked updated as the flow proceeds.
    let revoked = false;
    // Prefer revoking by access-token session id.
    const extracted = extractAccessToken(req);
    // Branch when this condition holds.
    if (extracted) {
      // Try block for operations that may throw.
      try {
        const user = await authenticateToken(extracted.token);
        // Await side-effecting async work.
        await revokeSession(user.sid);
        // Continue the controller logic.
        revoked = true;
      // Continue the controller logic.
      } catch {
        // fall through to refresh-token revoke
      }
    }

    // Fallback: look up session by refresh-token hash when access token is gone/invalid.
    if (!revoked) {
      const refreshToken = readRefreshToken(req);
      // Branch when this condition holds.
      if (refreshToken) {
        const hash = hashRefreshToken(refreshToken);
        const session = await prisma.authSession.findUnique({
          where: { refreshTokenHash: hash },
          select: { id: true },
        });
        // Branch when this condition holds.
        if (session) {
          // Await side-effecting async work.
          await revokeSession(session.id);
        }
      }
    }

    // Always clear cookies even if no session row was found.
    clearAuthCookies(res);
    // JSON success response with the payload.
    return res.json({ ok: true });
  // Continue the controller logic.
  } catch (err) {
    // Continue the controller logic.
    clearAuthCookies(res);
    // Abort with an application/HTTP error.
    throw err;
  }
}

/** Revoke all sessions using refresh credentials, or a valid access token. */
export async function logoutAll(req: Request, res: Response) {
  // Browser access cookies expire sooner than refresh cookies. Authenticate the
  // refresh under the same User lock as revocation; never rotate it just to logout.
  const refreshToken = readRefreshToken(req);
  // Continue the controller logic.
  let count: number;
  // Branch when this condition holds.
  if (refreshToken) {
    // Continue the controller logic.
    count = await revokeAllUsingRefreshToken(refreshToken);
  // Continue the controller logic.
  } else {
    const access = extractAccessToken(req);
    // Guard: skip or fail when the negated condition holds.
    if (!access) throw new AppError(401, "unauthorized", "Missing token");
    // Continue the controller logic.
    let claims;
    // Continue the controller logic.
    try { claims = verifyAccessToken(access.token); }
    // Continue the controller logic.
    catch { throw new AppError(401, "unauthorized", "Invalid token"); }
    // Await side-effecting async work.
    await assertSessionActive(claims.sid, claims.userId);
    // Continue the controller logic.
    count = await revokeAllForUser(claims.userId);
  }
  // Continue the controller logic.
  clearAuthCookies(res);
  // JSON success response with the payload.
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
    // Unauthorized when auth is missing or invalid.
    return res.status(401).json({
      error: "unauthorized",
      message: !user ? "User not found" : "Account blocked",
    });
  }
  // JSON success response with the payload.
  return res.json(await publicUser(user));
}
