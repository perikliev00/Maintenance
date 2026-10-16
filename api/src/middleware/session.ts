/**
 * Auth cookie issuance/clearing, token extraction, and CSRF double-submit.
 * Access/refresh are httpOnly; CSRF cookie is readable by JS for the header mirror.
 */
import type { CookieOptions, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import {
  ACCESS_TOKEN_TTL_SEC,
  REFRESH_TOKEN_TTL_MS,
} from "../services/authSessions";

export const SESSION_COOKIE = "session";
export const REFRESH_COOKIE = "refresh";
export const CSRF_COOKIE = "csrf";
export const CSRF_HEADER = "x-csrf-token";

/** Secure cookies in production, or when COOKIE_SECURE=1 (e.g. HTTPS local). */
function cookieSecure(): boolean {
  return process.env.NODE_ENV === "production" || process.env.COOKIE_SECURE === "1";
}

/** Shared path/sameSite/secure/maxAge for auth-related cookies. */
function baseCookieOptions(maxAge: number): CookieOptions {
  return {
    path: "/",
    sameSite: "lax",
    secure: cookieSecure(),
    maxAge,
  };
}

/** Set the httpOnly short-lived access-token cookie. */
export function setSessionCookie(res: Response, accessToken: string): void {
  res.cookie(SESSION_COOKIE, accessToken, {
    ...baseCookieOptions(ACCESS_TOKEN_TTL_SEC * 1000),
    httpOnly: true,
  });
}

/** Set the httpOnly refresh-token cookie (longer TTL). */
export function setRefreshCookie(res: Response, refreshToken: string): void {
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...baseCookieOptions(REFRESH_TOKEN_TTL_MS),
    httpOnly: true,
  });
}

/** Non-httpOnly so the SPA can mirror the value into x-csrf-token. */
export function setCsrfCookie(res: Response, value?: string): string {
  // Generate a fresh random CSRF secret when the caller does not supply one.
  const csrf = value ?? crypto.randomBytes(32).toString("hex");
  res.cookie(CSRF_COOKIE, csrf, {
    ...baseCookieOptions(REFRESH_TOKEN_TTL_MS),
    httpOnly: false,
  });
  return csrf;
}

/** Set access + refresh + a fresh CSRF cookie after login/refresh. */
export function issueAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string },
): void {
  setSessionCookie(res, tokens.accessToken);
  setRefreshCookie(res, tokens.refreshToken);
  // Always rotate CSRF on auth so a stolen old CSRF cookie cannot pair with new session cookies.
  setCsrfCookie(res);
}

/** Clear access, refresh, and CSRF cookies (logout / session revoke). */
export function clearAuthCookies(res: Response): void {
  // Match path/sameSite/secure so browsers actually clear the cookies that were set.
  const opts: CookieOptions = {
    path: "/",
    sameSite: "lax",
    secure: cookieSecure(),
  };
  res.clearCookie(SESSION_COOKIE, { ...opts, httpOnly: true });
  res.clearCookie(REFRESH_COOKIE, { ...opts, httpOnly: true });
  res.clearCookie(CSRF_COOKIE, { ...opts, httpOnly: false });
}

export type AuthVia = "bearer" | "cookie";

/**
 * Non-empty Bearer access token after trimming (incl. Unicode whitespace like U+00A0).
 * Empty/whitespace-only "Bearer …" is not usable auth — callers fall through to cookies.
 */
export function readBearerAccessToken(req: Request): string | null {
  const header = req.headers.authorization;
  // Must be the Bearer scheme (case-sensitive prefix as sent by clients).
  if (!header?.startsWith("Bearer ")) return null;
  // Trim so "Bearer \u00A0" does not count as a usable token.
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

/** Prefer Authorization Bearer; fall back to the httpOnly session cookie. */
export function extractAccessToken(req: Request): {
  token: string;
  via: AuthVia;
} | null {
  // Mobile / API clients typically send Bearer.
  const bearer = readBearerAccessToken(req);
  if (bearer) return { token: bearer, via: "bearer" };
  // Browser SPA uses the httpOnly session cookie.
  const cookieToken = req.cookies?.[SESSION_COOKIE];
  if (typeof cookieToken === "string" && cookieToken) {
    return { token: cookieToken, via: "cookie" };
  }
  return null;
}

/** Refresh from cookie first, then JSON body (mobile / non-browser clients). */
export function readRefreshToken(req: Request): string | null {
  // Prefer cookie so browser clients do not need to store refresh in JS.
  const fromCookie = req.cookies?.[REFRESH_COOKIE];
  if (typeof fromCookie === "string" && fromCookie) return fromCookie;
  // Body fallback for clients that cannot use cookies.
  const fromBody = (req.body as { refreshToken?: unknown } | undefined)
    ?.refreshToken;
  if (typeof fromBody === "string" && fromBody) return fromBody;
  return null;
}

/** Methods that never mutate state — CSRF is not required. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF double-submit for cookie-authenticated mutating requests.
 *
 * Skip only when a usable Bearer token will authenticate the request and no
 * refresh cookie is present (refresh/logout prefer the cookie over Bearer).
 * Whitespace-only Bearer (e.g. "Bearer \\u00A0") does not skip — auth falls
 * through to cookies, so CSRF must apply.
 */
export function requireCsrf(req: Request, res: Response, next: NextFunction) {
  // Safe methods cannot change server state via cookies alone.
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    return next();
  }

  // Detect whether cookie-based auth material is present.
  const hasSessionCookie =
    typeof req.cookies?.[SESSION_COOKIE] === "string" &&
    Boolean(req.cookies[SESSION_COOKIE]);
  const hasRefreshCookie =
    typeof req.cookies?.[REFRESH_COOKIE] === "string" &&
    Boolean(req.cookies[REFRESH_COOKIE]);

  // Usable Bearer authenticates access without cookies; refresh cookie means
  // /auth/refresh (and logout fallback) still act via cookie → require CSRF.
  if (readBearerAccessToken(req) && !hasRefreshCookie) {
    return next();
  }

  // No cookie session at all — nothing for an attacker to ride; skip CSRF.
  if (!hasSessionCookie && !hasRefreshCookie) {
    return next();
  }

  // Double-submit: cookie value must equal the mirrored header.
  const cookieCsrf =
    typeof req.cookies?.[CSRF_COOKIE] === "string"
      ? req.cookies[CSRF_COOKIE]
      : null;
  const headerCsrfRaw = req.headers[CSRF_HEADER];
  const headerCsrf =
    typeof headerCsrfRaw === "string"
      ? headerCsrfRaw
      : Array.isArray(headerCsrfRaw)
        ? headerCsrfRaw[0]
        : null;

  // Missing or mismatched pair → reject the mutating request.
  if (!cookieCsrf || !headerCsrf || cookieCsrf !== headerCsrf) {
    return res.status(403).json({
      error: "csrf",
      message: "Invalid CSRF token",
    });
  }

  return next();
}
