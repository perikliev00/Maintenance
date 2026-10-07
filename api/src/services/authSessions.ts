import { createHash, randomBytes } from "crypto";
import type { Prisma, Role } from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";
import { signAccessToken, type AuthUser } from "../auth/tokens";

type DbClient = Prisma.TransactionClient | typeof prisma;

export const ACCESS_TOKEN_TTL_SEC = 15 * 60; // 15 minutes
export const REFRESH_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

function clientIp(ip?: string | null): string | null {
  if (!ip) return null;
  return ip.slice(0, 64);
}

function clientUa(ua?: string | null): string | null {
  if (!ua) return null;
  return ua.slice(0, 512);
}

export type SessionTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  token: string;
  sessionId: string;
};

async function issueTokensForSession(
  sessionId: string,
  user: { id: string; employeeId: string; role: Role; email: string },
  refreshToken: string,
): Promise<SessionTokens> {
  const payload: AuthUser = {
    userId: user.id,
    employeeId: user.employeeId,
    role: user.role,
    email: user.email,
    sid: sessionId,
  };
  const accessToken = signAccessToken(payload);
  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SEC,
    token: accessToken,
    sessionId,
  };
}

export type CreateSessionInput = {
  userId: string;
  deviceId?: string | null;
  userAgent?: string | null;
  ip?: string | null;
};

/** Create an AuthSession using either a transaction client or the global prisma. */
export async function createSessionWithClient(
  client: DbClient,
  input: CreateSessionInput,
): Promise<SessionTokens> {
  const user = await client.user.findUnique({ where: { id: input.userId } });
  if (!user || !user.isActive) {
    throw new AppError(401, "unauthorized", "User not found or inactive");
  }

  const refreshToken = generateRefreshToken();
  const session = await client.authSession.create({
    data: {
      userId: user.id,
      deviceId: input.deviceId ?? null,
      refreshTokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      userAgent: clientUa(input.userAgent),
      ip: clientIp(input.ip),
      lastUsedAt: new Date(),
    },
  });

  return issueTokensForSession(session.id, user, refreshToken);
}

export async function createSession(
  input: CreateSessionInput,
): Promise<SessionTokens> {
  return createSessionWithClient(prisma, input);
}

export async function rotateRefresh(
  refreshToken: string,
  meta?: { userAgent?: string | null; ip?: string | null },
): Promise<SessionTokens> {
  const hash = hashRefreshToken(refreshToken);
  const existing = await prisma.authSession.findUnique({
    where: { refreshTokenHash: hash },
    include: { user: true },
  });

  if (!existing) {
    throw new AppError(401, "unauthorized", "Invalid refresh token");
  }

  if (existing.revokedAt) {
    // Reuse of a rotated token → compromise signal
    if (existing.replacedById) {
      await revokeAllForUser(existing.userId);
    }
    throw new AppError(401, "unauthorized", "Refresh token revoked");
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    await prisma.authSession.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });
    throw new AppError(401, "unauthorized", "Refresh token expired");
  }

  if (!existing.user.isActive) {
    await revokeAllForUser(existing.userId);
    throw new AppError(401, "unauthorized", "User inactive");
  }

  const newRefresh = generateRefreshToken();
  const newSession = await prisma.$transaction(async (tx) => {
    const claimed = await tx.authSession.updateMany({
      where: { id: existing.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new AppError(401, "unauthorized", "Refresh token already used");
    }

    const created = await tx.authSession.create({
      data: {
        userId: existing.userId,
        deviceId: existing.deviceId,
        refreshTokenHash: hashRefreshToken(newRefresh),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        userAgent: clientUa(meta?.userAgent) ?? existing.userAgent,
        ip: clientIp(meta?.ip) ?? existing.ip,
        lastUsedAt: new Date(),
      },
    });

    await tx.authSession.update({
      where: { id: existing.id },
      data: { replacedById: created.id },
    });

    return created;
  });

  return issueTokensForSession(newSession.id, existing.user, newRefresh);
}

export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.authSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllForUser(userId: string): Promise<number> {
  const result = await prisma.authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function revokeAllForDevice(deviceId: string): Promise<number> {
  const result = await prisma.authSession.updateMany({
    where: { deviceId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function assertSessionActive(sessionId: string, userId: string) {
  const session = await prisma.authSession.findUnique({
    where: { id: sessionId },
    include: {
      user: {
        select: {
          id: true,
          isActive: true,
          role: true,
          email: true,
          employeeId: true,
        },
      },
    },
  });
  if (!session || session.userId !== userId) {
    throw new AppError(401, "unauthorized", "Invalid session");
  }
  if (session.revokedAt) {
    throw new AppError(401, "unauthorized", "Session revoked");
  }
  if (session.expiresAt.getTime() <= Date.now()) {
    throw new AppError(401, "unauthorized", "Session expired");
  }
  if (!session.user.isActive) {
    throw new AppError(401, "unauthorized", "User inactive");
  }
  return session;
}
