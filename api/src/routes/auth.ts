import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { Role } from "@prisma/client";
import { prisma } from "../db";
import { authenticateToken, requireAuth } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import { authLoginLimiter } from "../middleware/security";
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
  revokeSession,
  rotateRefresh,
} from "../services/authSessions";
import { capabilitiesFor } from "../services/roleGrants";

export const authRouter = Router();

async function publicUser(user: {
  id: string;
  email: string;
  role: Role;
  employeeId: string;
  employee: { fullName: string };
}) {
  const caps = await capabilitiesFor(user.role);
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

authRouter.post("/login", authLoginLimiter, async (req, res, next) => {
  try {
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
    }

    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email },
      include: { employee: true },
    });
    if (!user || !user.isActive) {
      return res.status(401).json({ error: "unauthorized", message: "Invalid credentials" });
    }

    if (!user.activatedAt) {
      return res.status(403).json({
        error: "not_activated",
        message: "Account is not activated. Use an invitation code on a device first.",
      });
    }

    const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: "unauthorized", message: "Invalid credentials" });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await createSession({
      userId: user.id,
      userAgent: req.get("user-agent"),
      ip: req.ip,
    });

    issueAuthCookies(res, tokens);

    // Tokens only in httpOnly cookies — never in JSON body (XSS).
    return res.json({
      user: await publicUser(user),
      expiresIn: tokens.expiresIn,
    });
  } catch (err) {
    return next(err);
  }
});

authRouter.post("/refresh", async (req, res, next) => {
  try {
    const refreshToken = readRefreshToken(req);
    if (!refreshToken) {
      return res.status(401).json({
        error: "unauthorized",
        message: "Missing refresh token",
      });
    }

    const tokens = await rotateRefresh(refreshToken, {
      userAgent: req.get("user-agent"),
      ip: req.ip,
    });

    issueAuthCookies(res, tokens);
    return res.json({ ok: true, expiresIn: tokens.expiresIn });
  } catch (err) {
    clearAuthCookies(res);
    return next(err);
  }
});

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    try {
      let revoked = false;
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

      clearAuthCookies(res);
      return res.json({ ok: true });
    } catch (err) {
      clearAuthCookies(res);
      throw err;
    }
  }),
);

authRouter.post(
  "/logout-all",
  requireAuth,
  asyncHandler(async (req, res) => {
    const count = await revokeAllForUser(req.user!.userId);
    clearAuthCookies(res);
    return res.json({ ok: true, revoked: count });
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: { employee: true },
    });
    if (!user || !user.isActive) {
      return res.status(401).json({
        error: "unauthorized",
        message: !user ? "User not found" : "Account blocked",
      });
    }
    return res.json(await publicUser(user));
  }),
);
