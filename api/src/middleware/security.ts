/**
 * HTTP security middleware: Helmet headers, trust-proxy for rate-limit keys,
 * and named limiters for login, invitation redeem, and global API traffic.
 */
import type { Application, Request, Response } from "express";
import helmet from "helmet";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";

/** Normalize client IP for rate-limit keys (IPv6-safe via ipKeyGenerator). */
function clientIpKey(req: Request): string {
  // Prefer Express req.ip (honors trust proxy); fall back to socket address.
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  return ipKeyGenerator(ip);
}

/** Shared 429 JSON body for all named limiters. */
function rateLimitedHandler(_req: Request, res: Response): void {
  res.status(429).json({
    error: "rate_limited",
    message: "Too many requests. Please try again later.",
  });
}

/** E2E / local suites issue many logins + mutations from one IP; skip when set. */
function rateLimitsDisabled(): boolean {
  return process.env.E2E_DISABLE_RATE_LIMIT === "1";
}

/** Enable when behind a reverse proxy so req.ip / rate limits use X-Forwarded-For. */
export function configureTrustProxy(app: Application): void {
  // Opt-in only — enabling blindly would trust spoofed X-Forwarded-For.
  if (process.env.TRUST_PROXY === "1") {
    app.set("trust proxy", 1);
  }
}

/** Helmet default security headers for all responses. */
export const securityHeaders = helmet();

/** Per IP+email: slows credential stuffing on /auth/login. */
export const authLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitedHandler,
  skip: () => rateLimitsDisabled(),
  keyGenerator: (req) => {
    // Bucket by normalized email when present so one IP cannot spray many accounts freely.
    const email =
      typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";
    const ip = clientIpKey(req);
    return email ? `${ip}:${email}` : ip;
  },
});

/** Per IP: limits invitation code guessing on public redeem. */
export const invitationRedeemLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitedHandler,
  skip: () => rateLimitsDisabled(),
  keyGenerator: (req) => clientIpKey(req),
});

/** Broad per-IP ceiling; /health skipped for load balancer probes. */
export const globalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitedHandler,
  keyGenerator: (req) => clientIpKey(req),
  // Health checks must not consume the global budget; E2E skips entirely.
  skip: (req) => req.path === "/health" || rateLimitsDisabled(),
});
