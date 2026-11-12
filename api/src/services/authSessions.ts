/**
 * Auth session lifecycle: create sessions, rotate refresh tokens (with reuse
 * detection), and revoke sessions for logout / compromise response.
 */
import { createHash, randomBytes } from "crypto";
// Type-only import from @prisma/client (erased at runtime).
import type { Prisma, Role } from "@prisma/client";
// Shared Prisma client singleton.
import { prisma } from "../db";
// Runtime import from ../errors.
import { AppError } from "../errors";
// Runtime import from ../auth/tokens.
import { signAccessToken, type AuthUser } from "../auth/tokens";
// Runtime import from ./liveAccessLocks.
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
  // Return computed result.
  return randomBytes(32).toString("base64url");
}

/** Truncate client IP for storage (null when absent). */
function clientIp(ip?: string | null): string | null {
  // Guard missing required data.
  if (!ip) return null;
  // Return computed result.
  return ip.slice(0, 64);
}

/** Truncate User-Agent for storage (null when absent). */
function clientUa(ua?: string | null): string | null {
  // Guard missing required data.
  if (!ua) return null;
  // Return computed result.
  return ua.slice(0, 512);
}

/** Issued token pair; `token` mirrors `accessToken` for legacy clients. */
export type SessionTokens = {
  // Param accessToken required by this function.
  accessToken: string;
  // Param refreshToken required by this function.
  refreshToken: string;
  // Param expiresIn required by this function.
  expiresIn: number;
  // Param token required by this function.
  token: string;
  // Param sessionId required by this function.
  sessionId: string;
};

/** Sign an access JWT and package it with the plaintext refresh token. */
async function issueTokensForSession(
  // Param sessionId required by this function.
  sessionId: string,
  // Param user required by this function.
  user: { id: string; employeeId: string; role: Role; email: string },
  // Param refreshToken required by this function.
  refreshToken: string,
): Promise<SessionTokens> {
  // Access JWT carries sid so middleware can assertSessionActive.
  const payload: AuthUser = {
    // Field userId on this type/payload.
    userId: user.id,
    // Field employeeId on this type/payload.
    employeeId: user.employeeId,
    // Field role on this type/payload.
    role: user.role,
    // Credential field email.
    email: user.email,
    // Field sid on this type/payload.
    sid: sessionId,
  };
  // Local accessToken used below.
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

// Public type CreateSessionInput for callers of this service.
export type CreateSessionInput = {
  // Field userId on this type/payload.
  userId: string;
  // Optional deviceId.
  deviceId?: string | null;
  // Optional client metadata: userAgent.
  userAgent?: string | null;
  // Optional client metadata: ip.
  ip?: string | null;
};

/**
 * Create an AuthSession using either a transaction client or the global prisma.
 * Stores only the refresh-token hash; returns the plaintext refresh once.
 */
export async function createSessionWithClient(
  // Param client required by this function.
  client: DbClient,
  // Param input required by this function.
  input: CreateSessionInput,
): Promise<SessionTokens> {
  // Load user inside the same client (tx-safe for invite redeem).
  const user = await client.user.findUnique({
    // Filter matching rows.
    where: { id: input.userId },
    // Include relations for labels/checks.
    include: { employee: { select: { archivedAt: true } } },
  });
  // Inactive / archived / missing users cannot obtain sessions.
  if (!user || !user.isActive || user.employee.archivedAt) {
    // Throw typed AppError for HTTP mapping.
    throw new AppError(401, "unauthorized", "User not found or inactive");
  }

  // Plaintext refresh is returned once; only the hash is persisted.
  const refreshToken = generateRefreshToken();
  // Await session before dependent work.
  const session = await client.authSession.create({
    // Mutation data payload.
    data: {
      // Field userId on this type/payload.
      userId: user.id,
      // Field deviceId on this type/payload.
      deviceId: input.deviceId ?? null,
      // Field refreshTokenHash on this type/payload.
      refreshTokenHash: hashRefreshToken(refreshToken),
      // Time field expiresAt.
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      // Optional client metadata: userAgent.
      userAgent: clientUa(input.userAgent),
      // Optional client metadata: ip.
      ip: clientIp(input.ip),
      // Time field lastUsedAt.
      lastUsedAt: new Date(),
    },
  });

  // Return computed result.
  return issueTokensForSession(session.id, user, refreshToken);
}

/** Create a session with the global Prisma client. */
export async function createSession(
  // Param input required by this function.
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
  // Param refreshToken required by this function.
  refreshToken: string,
  // Param meta required by this function.
  meta?: { userAgent?: string | null; ip?: string | null },
): Promise<SessionTokens> {
  // Look up by hash of the presented plaintext refresh.
  const hash = hashRefreshToken(refreshToken);
  // Fetch existing by unique/first match.
  const existing = await prisma.authSession.findUnique({
    // Filter matching rows.
    where: { refreshTokenHash: hash },
    // Include relations for labels/checks.
    include: { user: { include: { employee: { select: { archivedAt: true } } } } },
  });

  // Unknown hash → invalid refresh (do not leak whether it ever existed).
  if (!existing) {
    // Throw typed AppError for HTTP mapping.
    throw new AppError(401, "unauthorized", "Invalid refresh token");
  }

  // Already revoked: reuse of a rotated token is a compromise signal.
  if (existing.revokedAt) {
    // Reuse of a rotated token → compromise signal
    if (existing.replacedById) {
      // Await side effect before continuing.
      await revokeAllForUser(existing.userId);
    }
    // Throw typed AppError for HTTP mapping.
    throw new AppError(401, "unauthorized", "Refresh token revoked");
  }

  // Expired sessions are soft-revoked then rejected.
  if (existing.expiresAt.getTime() <= Date.now()) {
    // Prisma side effect for this step.
    await prisma.$transaction(async (tx) => {
      // Await side effect before continuing.
      await lockUsersForLiveAccess(tx, [existing.userId]);
      // Await side effect before continuing.
      await tx.authSession.updateMany({
        // Filter matching rows.
        where: { id: existing.id, revokedAt: null },
        // Mutation data payload.
        data: { revokedAt: new Date() },
      });
    });
    // Throw typed AppError for HTTP mapping.
    throw new AppError(401, "unauthorized", "Refresh token expired");
  }

  // Deactivated or archived users lose all sessions.
  if (!existing.user.isActive || existing.user.employee.archivedAt) {
    // Await side effect before continuing.
    await revokeAllForUser(existing.userId);
    // Throw typed AppError for HTTP mapping.
    throw new AppError(401, "unauthorized", "User inactive");
  }

  // Mint the replacement refresh before opening the transaction.
  const newRefresh = generateRefreshToken();
  // Await newSession before dependent work.
  const newSession = await prisma.$transaction(async (tx) => {
    // Serialize against open SSE deliveries for this user.
    await lockUsersForLiveAccess(tx, [existing.userId]);
    // Conditional revoke: if another rotate already claimed this row, fail closed.
    const claimed = await tx.authSession.updateMany({
      // Filter matching rows.
      where: { id: existing.id, revokedAt: null },
      // Mutation data payload.
      data: { revokedAt: new Date() },
    });
    // Lost the race → treat as already used.
    if (claimed.count === 0) {
      // Throw typed AppError for HTTP mapping.
      throw new AppError(401, "unauthorized", "Refresh token already used");
    }

    // New session inherits device binding; refresh UA/IP from this request when present.
    const created = await tx.authSession.create({
      // Mutation data payload.
      data: {
        // Field userId on this type/payload.
        userId: existing.userId,
        // Field deviceId on this type/payload.
        deviceId: existing.deviceId,
        // Field refreshTokenHash on this type/payload.
        refreshTokenHash: hashRefreshToken(newRefresh),
        // Time field expiresAt.
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        // Optional client metadata: userAgent.
        userAgent: clientUa(meta?.userAgent) ?? existing.userAgent,
        // Optional client metadata: ip.
        ip: clientIp(meta?.ip) ?? existing.ip,
        // Time field lastUsedAt.
        lastUsedAt: new Date(),
      },
    });

    // Link old → new so reuse detection can revoke-all on replay.
    await tx.authSession.update({
      // Filter matching rows.
      where: { id: existing.id },
      // Mutation data payload.
      data: { replacedById: created.id },
    });

    // Return computed result.
    return created;
  });

  // Return computed result.
  return issueTokensForSession(newSession.id, existing.user, newRefresh);
}

/**
 * Soft-revoke a logical session if still active (idempotent).
 * Follows `replacedById` under the same User lock as rotateRefresh so logout
 * after a concurrent refresh still ends the live replacement.
 */
export async function revokeSession(sessionId: string): Promise<void> {
  // Prisma side effect for this step.
  await prisma.$transaction(async (tx) => {
    // Await seed before dependent work.
    const seed = await tx.authSession.findUnique({
      // Filter matching rows.
      where: { id: sessionId },
      // Select only needed columns.
      select: { userId: true },
    });
    // Conditional path for this guard.
    if (!seed) return;
    // Await side effect before continuing.
    await lockUsersForLiveAccess(tx, [seed.userId]);

    // Type alias SessionLink.
    type SessionLink = {
      // Param id required by this function.
      id: string;
      // Param userId required by this function.
      userId: string;
      // Param replacedById required by this function.
      replacedById: string | null;
    };

    // Re-read after the User lock; walk the replacement chain for this user only.
    const initial = await tx.authSession.findUnique({
      // Filter matching rows.
      where: { id: sessionId },
      // Select only needed columns.
      select: {
        // Param id required by this function.
        id: true,
        // Param userId required by this function.
        userId: true,
        // Param replacedById required by this function.
        replacedById: true,
      },
    });
    // Guard missing required data.
    if (!initial || initial.userId !== seed.userId) return;

    // Local current used below.
    let current: SessionLink = initial;
    // Set seen for dedupe/membership.
    const seen = new Set<string>();
    // Loop until stop condition.
    while (current.replacedById) {
      // Conditional path for this guard.
      if (seen.has(current.id)) break;
      // Support the surrounding control flow.
      seen.add(current.id);
      // Await next before dependent work.
      const next: SessionLink | null = await tx.authSession.findUnique({
        // Filter matching rows.
        where: { id: current.replacedById },
        // Select only needed columns.
        select: {
          // Param id required by this function.
          id: true,
          // Param userId required by this function.
          userId: true,
          // Param replacedById required by this function.
          replacedById: true,
        },
      });
      // Broken / cross-user link: stop at the last trusted row in this chain.
      if (!next || next.userId !== seed.userId) break;
      // Assign current.
      current = next;
    }

    // Await side effect before continuing.
    await tx.authSession.updateMany({
      // Filter matching rows.
      where: {
        // Param id required by this function.
        id: current.id,
        // Param userId required by this function.
        userId: seed.userId,
        // Param revokedAt required by this function.
        revokedAt: null,
      },
      // Mutation data payload.
      data: { revokedAt: new Date() },
    });
  });
}

/** Revoke every active session for a user; returns how many were revoked. */
export async function revokeAllForUser(userId: string): Promise<number> {
  // Return computed result.
  return prisma.$transaction(async (tx) => {
    // Await side effect before continuing.
    await lockUsersForLiveAccess(tx, [userId]);
    // Await result before dependent work.
    const result = await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    // Return computed result.
    return result.count;
  });
}

/** Authenticate a refresh token and revoke its user's sessions under one lock. */
export async function revokeAllUsingRefreshToken(refreshToken: string): Promise<number> {
  // Fetch session by unique/first match.
  const session = await prisma.authSession.findUnique({
    // Filter matching rows.
    where: { refreshTokenHash: hashRefreshToken(refreshToken) },
    // Select only needed columns.
    select: { id: true, userId: true },
  });
  // Conditional path for this guard.
  if (!session) throw new AppError(401, "unauthorized", "Invalid refresh token");
  // Return computed result.
  return prisma.$transaction(async tx => {
    // Await side effect before continuing.
    await lockUsersForLiveAccess(tx, [session.userId]);
    // Await side effect before continuing.
    await assertSessionActive(session.id, session.userId, tx);
    // Await result before dependent work.
    const result = await tx.authSession.updateMany({
      // Filter matching rows.
      where: { userId: session.userId, revokedAt: null },
      // Mutation data payload.
      data: { revokedAt: new Date() },
    });
    // Return computed result.
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
    // Filter matching rows.
    where: { id: sessionId },
    // Include relations for labels/checks.
    include: {
      // Param user required by this function.
      user: {
        // Select only needed columns.
        select: {
          // Param id required by this function.
          id: true,
          // Param isActive required by this function.
          isActive: true,
          // Param role required by this function.
          role: true,
          // Param email required by this function.
          email: true,
          // Param employeeId required by this function.
          employeeId: true,
          // Param employee required by this function.
          employee: { select: { archivedAt: true } },
        },
      },
    },
  });
  // Missing session or wrong owner → unauthorized.
  if (!session || session.userId !== userId) {
    // Throw typed AppError for HTTP mapping.
    throw new AppError(401, "unauthorized", "Invalid session");
  }
  // Soft-revoked (logout / rotate / revoke-all).
  if (session.revokedAt) {
    // Throw typed AppError for HTTP mapping.
    throw new AppError(401, "unauthorized", "Session revoked");
  }
  // Absolute refresh expiry — access JWT may still be valid until its own TTL.
  if (session.expiresAt.getTime() <= Date.now()) {
    // Throw typed AppError for HTTP mapping.
    throw new AppError(401, "unauthorized", "Session expired");
  }
  // Deactivated or archived accounts cannot keep using an otherwise-valid session.
  if (!session.user.isActive || session.user.employee.archivedAt) {
    // Throw typed AppError for HTTP mapping.
    throw new AppError(401, "unauthorized", "User inactive");
  }
  // Return computed result.
  return session;
}
