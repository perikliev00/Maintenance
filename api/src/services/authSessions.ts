/**
 * Auth session lifecycle: create sessions, rotate refresh tokens (with reuse
 * detection), and revoke sessions for logout / compromise response.
 */
import { createHash, randomBytes } from "crypto";
import type { Prisma, Role } from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";
import { signAccessToken, type AuthUser } from "../auth/tokens";
import { lockUsersForLiveAccess } from "./liveAccessLocks";

// Type alias DbClient.
type DbClient = Prisma.TransactionClient | typeof prisma;

export const ACCESS_TOKEN_TTL_SEC = 15 * 60; // 15 minutes
export const REFRESH_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

/** SHA-256 hex of the opaque refresh token (only the hash is stored). */
export function hashRefreshToken(token: string): string {
  // Never persist the plaintext refresh token.
  return createHash("sha256").update(token).digest("hex");
}

/** Cryptographically random opaque refresh token (base64url). */
function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Truncate client IP for storage (null when absent). */
function clientIp(ip?: string | null): string | null {
  if (!ip) return null;
  return ip.slice(0, 64);
}

/** Truncate User-Agent for storage (null when absent). */
function clientUa(ua?: string | null): string | null {
  if (!ua) return null;
  return ua.slice(0, 512);
}

/** Issued token pair; `token` mirrors `accessToken` for legacy clients. */
export type SessionTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  token: string;
  sessionId: string;
};

/** Sign an access JWT and package it with the plaintext refresh token. */
async function issueTokensForSession(
  sessionId: string,
  user: { id: string; employeeId: string; role: Role; email: string },
  refreshToken: string,
): Promise<SessionTokens> {
  // Access JWT carries sid so middleware can assertSessionActive.
  const payload: AuthUser = {
    userId: user.id,
    employeeId: user.employeeId,
    role: user.role,
    email: user.email,
    sid: sessionId,
  };
  const accessToken = signAccessToken(payload);
  // `token` duplicates accessToken for older clients that still expect it.
  return {
    accessToken,
    refreshToken,
    // Set expiresIn.
    expiresIn: ACCESS_TOKEN_TTL_SEC,
    // Set token.
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

/**
 * Create an AuthSession using either a transaction client or the global prisma.
 * Stores only the refresh-token hash; returns the plaintext refresh once.
 */
export async function createSessionWithClient(
  client: DbClient,
  input: CreateSessionInput,
): Promise<SessionTokens> {
  // Load user inside the same client (tx-safe for invite redeem).
  const user = await client.user.findUnique({
    where: { id: input.userId },
    include: { employee: { select: { archivedAt: true } } },
  });
  // Inactive / archived / missing users cannot obtain sessions.
  if (!user || !user.isActive || user.employee.archivedAt) {
    throw new AppError(401, "unauthorized", "User not found or inactive");
  }

  // Plaintext refresh is returned once; only the hash is persisted.
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

/** Create a session with the global Prisma client. */
export async function createSession(
  input: CreateSessionInput,
): Promise<SessionTokens> {
  // Thin wrapper for call sites outside a transaction.
  return createSessionWithClient(prisma, input);
}

/**
 * Rotate a refresh token: revoke the old session, issue a new one, and link
 * via `replacedById`. Reuse of an already-rotated token revokes all sessions
 * for that user (theft / replay signal).
 */
export async function rotateRefresh(
  refreshToken: string,
  meta?: { userAgent?: string | null; ip?: string | null },
): Promise<SessionTokens> {
  // Look up by hash of the presented plaintext refresh.
  const hash = hashRefreshToken(refreshToken);
  const existing = await prisma.authSession.findUnique({
    where: { refreshTokenHash: hash },
    include: { user: { include: { employee: { select: { archivedAt: true } } } } },
  });

  // Unknown hash → invalid refresh (do not leak whether it ever existed).
  if (!existing) {
    throw new AppError(401, "unauthorized", "Invalid refresh token");
  }

  // Already revoked: reuse of a rotated token is a compromise signal.
  if (existing.revokedAt) {
    // Reuse of a rotated token → compromise signal
    if (existing.replacedById) {
      await revokeAllForUser(existing.userId);
    }
    throw new AppError(401, "unauthorized", "Refresh token revoked");
  }

  // Expired sessions are soft-revoked then rejected.
  if (existing.expiresAt.getTime() <= Date.now()) {
    await prisma.$transaction(async (tx) => {
      await lockUsersForLiveAccess(tx, [existing.userId]);
      await tx.authSession.updateMany({
        where: { id: existing.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    throw new AppError(401, "unauthorized", "Refresh token expired");
  }

  // Deactivated or archived users lose all sessions.
  if (!existing.user.isActive || existing.user.employee.archivedAt) {
    await revokeAllForUser(existing.userId);
    throw new AppError(401, "unauthorized", "User inactive");
  }

  // Mint the replacement refresh before opening the transaction.
  const newRefresh = generateRefreshToken();
  const newSession = await prisma.$transaction(async (tx) => {
    // Serialize against open SSE deliveries for this user.
    await lockUsersForLiveAccess(tx, [existing.userId]);
    // Conditional revoke: if another rotate already claimed this row, fail closed.
    const claimed = await tx.authSession.updateMany({
      where: { id: existing.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // Lost the race → treat as already used.
    if (claimed.count === 0) {
      throw new AppError(401, "unauthorized", "Refresh token already used");
    }

    // New session inherits device binding; refresh UA/IP from this request when present.
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

    // Link old → new so reuse detection can revoke-all on replay.
    await tx.authSession.update({
      where: { id: existing.id },
      data: { replacedById: created.id },
    });

    return created;
  });

  return issueTokensForSession(newSession.id, existing.user, newRefresh);
}

/**
 * Soft-revoke a logical session if still active (idempotent).
 * Follows `replacedById` under the same User lock as rotateRefresh so logout
 * after a concurrent refresh still ends the live replacement.
 */
export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const seed = await tx.authSession.findUnique({
      where: { id: sessionId },
      select: { userId: true },
    });
    if (!seed) return;
    await lockUsersForLiveAccess(tx, [seed.userId]);

    // Type alias SessionLink.
    type SessionLink = {
      id: string;
      userId: string;
      replacedById: string | null;
    };

    // Re-read after the User lock; walk the replacement chain for this user only.
    const initial = await tx.authSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        userId: true,
        replacedById: true,
      },
    });
    if (!initial || initial.userId !== seed.userId) return;

    let current: SessionLink = initial;
    const seen = new Set<string>();
    while (current.replacedById) {
      if (seen.has(current.id)) break;
      seen.add(current.id);
      const next: SessionLink | null = await tx.authSession.findUnique({
        where: { id: current.replacedById },
        select: {
          id: true,
          userId: true,
          replacedById: true,
        },
      });
      // Broken / cross-user link: stop at the last trusted row in this chain.
      if (!next || next.userId !== seed.userId) break;
      // Assign current.
      current = next;
    }

    await tx.authSession.updateMany({
      where: {
        id: current.id,
        userId: seed.userId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  });
}

/** Revoke every active session for a user; returns how many were revoked. */
export async function revokeAllForUser(userId: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await lockUsersForLiveAccess(tx, [userId]);
    const result = await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    return result.count;
  });
}

/** Authenticate a refresh token and revoke its user's sessions under one lock. */
export async function revokeAllUsingRefreshToken(refreshToken: string): Promise<number> {
  const session = await prisma.authSession.findUnique({
    where: { refreshTokenHash: hashRefreshToken(refreshToken) },
    select: { id: true, userId: true },
  });
  if (!session) throw new AppError(401, "unauthorized", "Invalid refresh token");
  return prisma.$transaction(async tx => {
    await lockUsersForLiveAccess(tx, [session.userId]);
    await assertSessionActive(session.id, session.userId, tx);
    const result = await tx.authSession.updateMany({
      where: { userId: session.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  });
}

/**
 * Validate that `sessionId` belongs to `userId`, is not revoked/expired,
 * and the user is still active. Used on authenticated requests that carry `sid`.
 */
export async function assertSessionActive(sessionId: string, userId: string, db: DbClient = prisma) {
  // Load session + user flags needed for auth checks.
  const session = await db.authSession.findUnique({
    where: { id: sessionId },
    include: {
      user: {
        select: {
          id: true,
          isActive: true,
          role: true,
          email: true,
          employeeId: true,
          employee: { select: { archivedAt: true } },
        },
      },
    },
  });
  // Missing session or wrong owner → unauthorized.
  if (!session || session.userId !== userId) {
    throw new AppError(401, "unauthorized", "Invalid session");
  }
  // Soft-revoked (logout / rotate / revoke-all).
  if (session.revokedAt) {
    throw new AppError(401, "unauthorized", "Session revoked");
  }
  // Absolute refresh expiry — access JWT may still be valid until its own TTL.
  if (session.expiresAt.getTime() <= Date.now()) {
    throw new AppError(401, "unauthorized", "Session expired");
  }
  // Deactivated or archived accounts cannot keep using an otherwise-valid session.
  if (!session.user.isActive || session.user.employee.archivedAt) {
    throw new AppError(401, "unauthorized", "User inactive");
  }
  return session;
}
