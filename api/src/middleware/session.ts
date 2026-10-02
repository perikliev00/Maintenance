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

function cookieSecure(): boolean {
  return process.env.NODE_ENV === "production" || process.env.COOKIE_SECURE === "1";
}

function baseCookieOptions(maxAge: number): CookieOptions {
  return {
    path: "/",
    sameSite: "lax",
    secure: cookieSecure(),
    maxAge,
  };
}

export function setSessionCookie(res: Response, accessToken: string): void {
  res.cookie(SESSION_COOKIE, accessToken, {
    ...baseCookieOptions(ACCESS_TOKEN_TTL_SEC * 1000),
    httpOnly: true,
  });
}

export function setRefreshCookie(res: Response, refreshToken: string): void {
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...baseCookieOptions(REFRESH_TOKEN_TTL_MS),
    httpOnly: true,
  });
}

export function setCsrfCookie(res: Response, value?: string): string {
  const csrf = value ?? crypto.randomBytes(32).toString("hex");
  res.cookie(CSRF_COOKIE, csrf, {
    ...baseCookieOptions(REFRESH_TOKEN_TTL_MS),
    httpOnly: false,
  });
  return csrf;
}

export function issueAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string },
): void {
  setSessionCookie(res, tokens.accessToken);
  setRefreshCookie(res, tokens.refreshToken);
  setCsrfCookie(res);
}

export function clearAuthCookies(res: Response): void {
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

export function extractAccessToken(req: Request): {
  token: string;
  via: AuthVia;
} | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length).trim();
    if (token) return { token, via: "bearer" };
  }
  const cookieToken = req.cookies?.[SESSION_COOKIE];
  if (typeof cookieToken === "string" && cookieToken) {
    return { token: cookieToken, via: "cookie" };
  }
  return null;
}

export function readRefreshToken(req: Request): string | null {
  const fromCookie = req.cookies?.[REFRESH_COOKIE];
  if (typeof fromCookie === "string" && fromCookie) return fromCookie;
  const fromBody = (req.body as { refreshToken?: unknown } | undefined)
    ?.refreshToken;
  if (typeof fromBody === "string" && fromBody) return fromBody;
  return null;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF double-submit for cookie-authenticated mutating requests.
 * Bearer clients (scripts) skip this check.
 */
export function requireCsrf(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    return next();
  }

  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    return next();
  }

  const hasSessionCookie =
    typeof req.cookies?.[SESSION_COOKIE] === "string" &&
    Boolean(req.cookies[SESSION_COOKIE]);
  const hasRefreshCookie =
    typeof req.cookies?.[REFRESH_COOKIE] === "string" &&
    Boolean(req.cookies[REFRESH_COOKIE]);

  if (!hasSessionCookie && !hasRefreshCookie) {
    return next();
  }

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

  if (!cookieCsrf || !headerCsrf || cookieCsrf !== headerCsrf) {
    return res.status(403).json({
      error: "csrf",
      message: "Invalid CSRF token",
    });
  }

  return next();
}
