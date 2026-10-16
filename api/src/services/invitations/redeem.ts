/**
 * Redeem an invitation: claim the code, create/activate the user, register the
 * device, and issue session tokens. Concurrent redeems fail closed via FOR UPDATE
 * + conditional status claim.
 */
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { InvitationStatus } from "@prisma/client";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { publish } from "../../events/bus";
import { createSessionWithClient } from "../authSessions";
import { capabilitiesFor } from "../roleGrants";
import { hashInviteCode } from "./codes";
import { expireStaleInvitations } from "./map";

/**
 * Consume an issued invite. Password required when creating or first-activating
 * the user account. Returns tokens + capabilities for the new session.
 *
 * @param input.code - Plaintext invite code from QR or manual entry.
 * @param input.password - Required on first account create/activate (≥ 8 chars).
 * @param input.deviceLabel - Human label stored on the Device row.
 * @param input.fingerprint - Stable device id; anon fallback when blank.
 */
export async function redeemInvitation(input: {
  code: string;
  password?: string;
  deviceLabel: string;
  fingerprint: string;
}) {
  // Lazy-expire past-due invites before hashing/lookup.
  await expireStaleInvitations();
  // Lookup by hash of the normalized code (plaintext never stored).
  const codeHash = hashInviteCode(input.code);
  const inv = await prisma.invitation.findUnique({
    where: { codeHash },
    // Load employee + user for pre-tx password/blocked checks.
    include: {
      employee: { include: { user: true } },
    },
  });
  // Missing or not-issued → generic invalid (do not leak which).
  if (!inv || inv.status !== InvitationStatus.issued) {
    // Generic message — do not reveal consumed vs unknown hash.
    throw new AppError(400, "invalid_code", "Invitation code is invalid or used");
  }
  // Race with lazy expiry: stamp expired and reject.
  if (inv.expiresAt.getTime() <= Date.now()) {
    // Stamp expired outside the claim transaction (lazy housekeeping).
    await prisma.invitation.update({
      where: { id: inv.id },
      data: { status: InvitationStatus.expired },
    });
    throw new AppError(400, "expired", "Invitation code has expired");
  }

  // Blocked accounts cannot redeem even with a valid code.
  const existingUser = inv.employee.user;
  if (existingUser && !existingUser.isActive) {
    // Pre-tx guard; re-checked under FOR UPDATE inside the transaction.
    throw new AppError(403, "forbidden", "Account is blocked");
  }

  // First redeem (create or activate) requires a password ≥ 8 chars.
  const needsUserCreate = !existingUser;
  const needsActivation = Boolean(existingUser && !existingUser.activatedAt);
  // Hash password once before entering the transaction (bcrypt is slow).
  let passwordHash: string | undefined;
  if (needsUserCreate || needsActivation) {
    if (!input.password || input.password.length < 8) {
      // Create/activate paths require a real password before claim.
      throw new AppError(
        400,
        "validation",
        "Password of at least 8 characters is required",
      );
    }
    passwordHash = await bcrypt.hash(input.password, 10);
  }
  // Already-activated user adding a device — password not required above branch.

  // Normalize device fields; generate anon fingerprint when blank.
  const fingerprint =
    input.fingerprint.trim() || `anon-${randomBytes(8).toString("hex")}`;
  const deviceLabel = input.deviceLabel.trim() || "Device";

  // Claim invite + user/device/session atomically under row locks.
  const { device, fullUser, tokens } = await prisma.$transaction(
    async (tx) => {
      // Serialize concurrent redeems on this invitation row.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Invitation" WHERE id = ${inv.id} FOR UPDATE
      `;
      if (locked.length === 0) {
        // Row disappeared between pre-tx read and lock (extremely rare).
        throw new AppError(400, "invalid_code", "Invitation code is invalid or used");
      }

      // Conditional claim: only issued + not-yet-expired rows consume.
      const claimed = await tx.invitation.updateMany({
        where: {
          id: inv.id,
          status: InvitationStatus.issued,
          expiresAt: { gt: new Date() },
        },
        data: {
          status: InvitationStatus.consumed,
          consumedAt: new Date(),
        },
      });
      // Lost claim → expired or already consumed by a peer.
      if (claimed.count === 0) {
        const current = await tx.invitation.findUnique({ where: { id: inv.id } });
        if (current && current.expiresAt.getTime() <= Date.now()) {
          // Lost claim because TTL elapsed between read and updateMany.
          // Stamp expired if still showing issued.
          if (current.status === InvitationStatus.issued) {
            await tx.invitation.update({
              where: { id: inv.id },
              data: { status: InvitationStatus.expired },
            });
          }
          // Prefer expired over conflict when TTL is the root cause.
          throw new AppError(400, "expired", "Invitation code has expired");
        }
        // Peer won the claim — surface conflict (not invalid_code).
        throw new AppError(409, "conflict", "Invitation already consumed");
      }

      // Re-read user inside the TX so role/isActive/activatedAt are current
      // (e.g. Owner may have demoted the pending user after the invite was issued).
      await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "User" WHERE "employeeId" = ${inv.employeeId} FOR UPDATE
      `;
      const freshUser = await tx.user.findUnique({
        where: { employeeId: inv.employeeId },
      });

      // Re-check blocked under the lock (may have changed since pre-tx read).
      if (freshUser && !freshUser.isActive) {
        // Owner may have blocked the account after the pre-tx read.
        throw new AppError(403, "forbidden", "Account is blocked");
      }

      // Password hash must already be prepared for create/activate paths.
      const requirePassword = () => {
        if (!passwordHash) {
          // Should not happen when needsUserCreate/needsActivation were true.
          throw new AppError(
            400,
            "validation",
            "Password of at least 8 characters is required",
          );
        }
        return passwordHash;
      };

      let userId: string;
      // No user row yet → create activated account from invite role/email.
      if (!freshUser) {
        const created = await tx.user.create({
          data: {
            employeeId: inv.employeeId,
            email: inv.email,
            passwordHash: requirePassword(),
            role: inv.role,
            activatedAt: new Date(),
            isActive: true,
          },
        });
        userId = created.id;
      } else if (!freshUser.activatedAt) {
        // Activation: keep the current User.role; never restore Invitation.role.
        const updated = await tx.user.update({
          where: { id: freshUser.id },
          data: {
            passwordHash: requirePassword(),
            activatedAt: new Date(),
          },
        });
        userId = updated.id;
      } else {
        // Already activated — redeem only registers a new device + session.
        userId = freshUser.id;
      }

      // Register this browser/device under the user (multi-device allowed).
      const device = await tx.device.create({
        data: {
          userId,
          employeeId: inv.employeeId,
          label: deviceLabel,
          fingerprint,
        },
      });

      // Link the consumed invite to the device that redeemed it.
      await tx.invitation.update({
        where: { id: inv.id },
        data: { consumedDeviceId: device.id },
      });

      // Reload with employee for the response DTO.
      const fullUser = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        include: { employee: true },
      });

      // Issue session inside the same TX (shares the client).
      const tokens = await createSessionWithClient(tx, {
        userId: fullUser.id,
        deviceId: device.id,
      });

      // Return handles needed for post-tx capabilities + HTTP response.
      return { device, fullUser, tokens };
    },
  );

  // Role grants for panels/actions/landing on the client.
  // Role grants drive panels/actions/landing in the SPA bootstrap.
  const caps = await capabilitiesFor(fullUser.role);

  // People admin list should refresh.
  publish("people.changed");

  // Session tokens plus user/device DTO for the activate screen.
  return {
    ...tokens,
    user: {
      id: fullUser.id,
      email: fullUser.email,
      role: fullUser.role,
      employeeId: fullUser.employeeId,
      fullName: fullUser.employee.fullName,
      panels: caps.panels,
      actions: caps.actions,
      landing: caps.landing,
    },
    device: {
      id: device.id,
      label: device.label,
      activatedAt: device.activatedAt.toISOString(),
    },
  };
}
