/**
 * Credential lookup / verification and login session creation (no Express).
 */
import bcrypt from "bcryptjs";
import { prisma } from "../db";
import { AppError } from "../errors";
import { publicUser } from "./authProfile";
import { createSession } from "./authSessions";

export type LoginCredentials = {
  email: string;
  password: string;
};

export type LoginClientMeta = {
  userAgent?: string;
  ip?: string;
};

export type LoginSuccess = {
  user: Awaited<ReturnType<typeof publicUser>>;
  tokens: Awaited<ReturnType<typeof createSession>>;
};

/**
 * Verify email/password and create an AuthSession.
 * Throws AppError with the same status/code contracts as the former controller path.
 */
export async function loginWithCredentials(
  credentials: LoginCredentials,
  meta: LoginClientMeta = {},
): Promise<LoginSuccess> {
  const user = await prisma.user.findUnique({
    where: { email: credentials.email },
    include: { employee: true },
  });
  // Same 401 for missing vs inactive/archived to avoid account enumeration.
  if (!user || !user.isActive || user.employee.archivedAt) {
    throw new AppError(401, "unauthorized", "Invalid credentials");
  }

  // Invited but not yet redeemed on a device.
  if (!user.activatedAt) {
    throw new AppError(
      403,
      "not_activated",
      "Account is not activated. Use an invitation code on a device first.",
    );
  }

  const ok = await bcrypt.compare(credentials.password, user.passwordHash);
  if (!ok) {
    throw new AppError(401, "unauthorized", "Invalid credentials");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const tokens = await createSession({
    userId: user.id,
    userAgent: meta.userAgent,
    ip: meta.ip,
  });

  return {
    user: await publicUser(user),
    tokens,
  };
}
