/**
 * Request authentication and action-gate middleware.
 * Attaches req.user (DB-backed) and req.authVia (bearer vs cookie).
 */
// Express request/response types for middleware signatures.
import { Request, Response, NextFunction } from "express";
// Action catalog key type for requireAction.
import { Action } from "../permissions";
// DB-backed RoleGrant check used after authentication.
import { canPerform } from "../services/roleGrants";
// Ensures AuthSession is active and user is enabled.
import { assertSessionActive } from "../services/authSessions";
// Access JWT verify + AuthUser claim shape.
import {
  verifyAccessToken,
  type AuthUser,
} from "../auth/tokens";
// Prefer Bearer, else session cookie; AuthVia labels which path won.
import { extractAccessToken, type AuthVia } from "./session";

// Re-export AuthUser so route modules can import from middleware/auth.
export type { AuthUser };

// Augment Express Request with authenticated identity fields.
declare global {
  namespace Express {
    interface Request {
      // DB-backed identity attached by requireAuth.
      user?: AuthUser;
      // Whether the token came from Authorization or the session cookie.
      authVia?: AuthVia;
    }
  }
}

/**
 * Verify JWT + active AuthSession + active user; role/email from DB (not JWT).
 * Used by requireAuth and any path that already holds a raw access token string.
 */
export async function authenticateToken(token: string): Promise<AuthUser> {
  // Signature/expiry check; does not yet know if the session was revoked.
  const decoded = verifyAccessToken(token);
  // Load AuthSession + user; throws if revoked, expired, or user inactive.
  const session = await assertSessionActive(decoded.sid, decoded.userId);
  // Prefer DB fields over JWT claims so role/email changes take effect immediately.
  return {
    userId: session.user.id,
    employeeId: session.user.employeeId,
    role: session.user.role,
    email: session.user.email,
    sid: session.id,
  };
}

/** Require a valid access token (Bearer preferred, else session cookie). */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  // Prefer Authorization Bearer; fall back to httpOnly session cookie.
  const extracted = extractAccessToken(req);
  // No token at all → 401 before any DB work.
  if (!extracted) {
    return res.status(401).json({ error: "unauthorized", message: "Missing token" });
  }

  authenticateToken(extracted.token)
    .then((decoded) => {
      // Offline commands bind their original owner independently of cookies.
      // Another tab or a delayed Set-Cookie can change the browser session
      // without changing this tab's local binding. Reject before domain writes.
      const offlineUser = req.headers["x-offline-user"];
      if (offlineUser !== undefined && offlineUser !== decoded.userId) {
        res.status(409).json({
          error: "identity_changed",
          message: "Offline command belongs to a different account",
        });
        return;
      }
      // Attach DB-backed identity and how the token was presented.
      req.user = decoded;
      req.authVia = extracted.via;
      next();
    })
    .catch(() => {
      // Invalid/expired/revoked — do not leak why to the client.
      res.status(401).json({ error: "unauthorized", message: "Invalid token" });
    });
}

/**
 * Factory: after requireAuth, ensure the caller's role may perform `action`
 * via RoleGrant (DB). Owners/admins follow canPerform rules there.
 */
export function requireAction(action: Action) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // requireAuth should have run first; guard if a route forgot it.
    if (!req.user) {
      return res.status(401).json({ error: "unauthorized", message: "Missing user" });
    }
    try {
      // DB RoleGrant lookup (cached in roleGrants service).
      if (await canPerform(req.user.role, action)) {
        return next();
      }
      // Authenticated but not granted this action.
      return res.status(403).json({
        error: "forbidden",
        message: "Insufficient permissions",
      });
    } catch (err) {
      // Unexpected grant/DB failures go to the terminal error handler.
      return next(err);
    }
  };
}
