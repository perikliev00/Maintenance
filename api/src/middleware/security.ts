import type { Application, Request, Response } from "express";
import helmet from "helmet";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";

function clientIpKey(req: Request): string {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  return ipKeyGenerator(ip);
}

function rateLimitedHandler(_req: Request, res: Response): void {
  res.status(429).json({
    error: "rate_limited",
    message: "Too many requests. Please try again later.",
  });
}

export function configureTrustProxy(app: Application): void {
  if (process.env.TRUST_PROXY === "1") {
    app.set("trust proxy", 1);
  }
}

export const securityHeaders = helmet();

export const authLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitedHandler,
  keyGenerator: (req) => {
    const email =
      typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";
    const ip = clientIpKey(req);
    return email ? `${ip}:${email}` : ip;
  },
});

export const invitationRedeemLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitedHandler,
  keyGenerator: (req) => clientIpKey(req),
});

export const globalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitedHandler,
  keyGenerator: (req) => clientIpKey(req),
  skip: (req) => req.path === "/health",
});
