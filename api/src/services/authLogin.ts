/**
 * Credential lookup / verification and login session creation (no Express).
 */
import bcrypt from "bcryptjs";
// Shared Prisma client singleton.
import { prisma } from "../db";
// Runtime import from ../errors.
import { AppError } from "../errors";
// Runtime import from ./authProfile.
import { publicUser } from "./authProfile";
// Runtime import from ./authSessions.
import { createSession } from "./authSessions";

// Public type LoginCredentials for callers of this service.
export type LoginCredentials = {
  // Credential field email.
  email: string;
  // Credential field password.
  password: string;
};

// Public type LoginClientMeta for callers of this service.
export type LoginClientMeta = {
  // Optional client metadata: userAgent.
  userAgent?: string;
  // Optional client metadata: ip.
  ip?: string;
};

// Public type LoginSuccess for callers of this service.
export type LoginSuccess = {
  // Field user on this type/payload.
  user: Awaited<ReturnType<typeof publicUser>>;
  // Time field tokens.
  tokens: Awaited<ReturnType<typeof createSession>>;
};

/**
 * Verify email/password and create an AuthSession.
 * Throws AppError with the same status/code contracts as the former controller path.
 */
export async function loginWithCredentials(
  // Param credentials required by this function.
  credentials: LoginCredentials,
  // Param meta required by this function.
  meta: LoginClientMeta = {},
): Promise<LoginSuccess> {
  // Fetch user by unique/first match.
  const user = await prisma.user.findUnique({
    // Filter matching rows.
    where: { email: credentials.email },
    // Include relations for labels/checks.
    include: { employee: true },
  });
  // Same 401 for missing vs inactive/archived to avoid account enumeration.
  if (!user || !user.isActive || user.employee.archivedAt) {
    // Throw typed AppError for HTTP mapping.
    throw new AppError(401, "unauthorized", "Invalid credentials");
  }

  // Invited but not yet redeemed on a device.
  if (!user.activatedAt) {
    // Throw typed AppError for HTTP mapping.
    throw new AppError(
      403,
      "not_activated",
      "Account is not activated. Use an invitation code on a device first.",
    );
  }

  // ok: password compare result.
  const ok = await bcrypt.compare(credentials.password, user.passwordHash);
  // Reject bad credentials without leaking which check failed.
  if (!ok) {
    // Throw typed AppError for HTTP mapping.
    throw new AppError(401, "unauthorized", "Invalid credentials");
  }

  // Persist field updates.
  await prisma.user.update({
    // Filter matching rows.
    where: { id: user.id },
    // Mutation data payload.
    data: { lastLoginAt: new Date() },
  });

  // Build tokens for the login response.
  const tokens = await createSession({
    // Set userId.
    userId: user.id,
    // Set userAgent.
    userAgent: meta.userAgent,
    // Set ip.
    ip: meta.ip,
  });

  // Return response object.
  return {
    // Set user.
    user: await publicUser(user),
    tokens,
  };
}
