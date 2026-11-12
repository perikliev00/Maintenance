/**
 * Redeem an invitation: claim the code, create/activate the user, register the
 * device, and issue session tokens. Concurrent redeems fail closed via FOR UPDATE
 * + conditional status claim.
 */
import { randomBytes } from "crypto";
// Import module bcryptjs for this service.
import bcrypt from "bcryptjs";
// Import module @prisma/client for this service.
import { InvitationStatus } from "@prisma/client";
// Import module ../../db for this service.
import { prisma } from "../../db";
// Import module ../../errors for this service.
import { AppError } from "../../errors";
// Import module ../../events/bus for this service.
import { publish } from "../../events/bus";
// Import module ../authSessions for this service.
import { createSessionWithClient } from "../authSessions";
// Import module dependency for this service.
import {
  // Run next step: lockEmployeeRowsForUpdate,
  lockEmployeeRowsForUpdate,
  // Run next step: lockEmployeesForLiveAccess,
  lockEmployeesForLiveAccess,
// Run next step: } from "../liveAccessLocks";
} from "../liveAccessLocks";
// Import module ../roleGrants for this service.
import { capabilitiesFor } from "../roleGrants";
// Import module ./codes for this service.
import { hashInviteCode } from "./codes";
// Import module ./map for this service.
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
  // Set code on the structure being built.
  code: string;
  // Run next step: password?: string;
  password?: string;
  // Set deviceLabel on the structure being built.
  deviceLabel: string;
  // Set fingerprint on the structure being built.
  fingerprint: string;
// Run next step: }) {
}) {
  // Lazy-expire past-due invites before hashing/lookup.
  await expireStaleInvitations();
  // Lookup by hash of the normalized code (plaintext never stored).
  const codeHash = hashInviteCode(input.code);
  // Load inv asynchronously for the next steps.
  const inv = await prisma.invitation.findUnique({
    // Set where on the structure being built.
    where: { codeHash },
    // Load employee + user for pre-tx password/blocked checks.
    include: {
      // Set employee on the structure being built.
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
      // Set where on the structure being built.
      where: { id: inv.id },
      // Set data on the structure being built.
      data: { status: InvitationStatus.expired },
    });
    // Abort with an error so callers can react.
    throw new AppError(400, "expired", "Invitation code has expired");
  }

  // Archived or blocked accounts cannot redeem even with a valid code.
  if (inv.employee.archivedAt) {
    // Abort with an error so callers can react.
    throw new AppError(403, "forbidden", "Account is archived");
  }
  // Capture existing user for use in this scope.
  const existingUser = inv.employee.user;
  // Branch when this condition holds so the right path runs.
  if (existingUser && !existingUser.isActive) {
    // Pre-tx guard; re-checked under FOR UPDATE inside the transaction.
    throw new AppError(403, "forbidden", "Account is blocked");
  }

  // First redeem (create or activate) requires a password ≥ 8 chars.
  const needsUserCreate = !existingUser;
  // Capture needs activation for use in this scope.
  const needsActivation = Boolean(existingUser && !existingUser.activatedAt);
  // Hash password once before entering the transaction (bcrypt is slow).
  let passwordHash: string | undefined;
  // Branch when this condition holds so the right path runs.
  if (needsUserCreate || needsActivation) {
    // Branch when this condition holds so the right path runs.
    if (!input.password || input.password.length < 8) {
      // Create/activate paths require a real password before claim.
      throw new AppError(
        // Run next step: 400,
        400,
        // Run next step: "validation",
        "validation",
        // Run next step: "Password of at least 8 characters is required",
        "Password of at least 8 characters is required",
      );
    }
    // Update password hash as control flow progresses.
    passwordHash = await bcrypt.hash(input.password, 10);
  }
  // Already-activated user adding a device — password not required above branch.

  // Normalize device fields; generate anon fingerprint when blank.
  const fingerprint =
    // Run next step: input.fingerprint.trim() || `anon-${randomBytes(8).toString(…
    input.fingerprint.trim() || `anon-${randomBytes(8).toString("hex")}`;
  // Capture device label for use in this scope.
  const deviceLabel = input.deviceLabel.trim() || "Device";

  // Claim invite + user/device/session atomically under User→Employee→Invitation.
  const { device, fullUser, tokens } = await prisma.$transaction(
    // Run next step: async (tx) => {
    async (tx) => {
      // Align with lifecycle/assign: User first (empty OK), then Employee, then Invitation.
      await lockEmployeesForLiveAccess(tx, [inv.employeeId]);
      // Wait for the async step before continuing.
      await lockEmployeeRowsForUpdate(tx, [inv.employeeId]);

      // Load fresh employee asynchronously for the next steps.
      const freshEmployee = await tx.employee.findUnique({
        // Set where on the structure being built.
        where: { id: inv.employeeId },
        // Set include on the structure being built.
        include: { user: true },
      });
      // Branch when this condition holds so the right path runs.
      if (!freshEmployee) {
        // Abort with an error so callers can react.
        throw new AppError(400, "invalid_code", "Invitation code is invalid or used");
      }
      // Branch when this condition holds so the right path runs.
      if (freshEmployee.archivedAt) {
        // Abort with an error so callers can react.
        throw new AppError(403, "forbidden", "Account is archived");
      }
      // Capture fresh user for use in this scope.
      const freshUser = freshEmployee.user;
      // Branch when this condition holds so the right path runs.
      if (freshUser && !freshUser.isActive) {
        // Abort with an error so callers can react.
        throw new AppError(403, "forbidden", "Account is blocked");
      }

      // Load locked asynchronously for the next steps.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Invitation" WHERE id = ${inv.id} FOR UPDATE
      `;
      // Branch when this condition holds so the right path runs.
      if (locked.length === 0) {
        // Abort with an error so callers can react.
        throw new AppError(400, "invalid_code", "Invitation code is invalid or used");
      }

      // Conditional claim: only issued + not-yet-expired rows consume.
      const claimed = await tx.invitation.updateMany({
        // Set where on the structure being built.
        where: {
          // Set id on the structure being built.
          id: inv.id,
          // Set status on the structure being built.
          status: InvitationStatus.issued,
          // Set expiresAt on the structure being built.
          expiresAt: { gt: new Date() },
        },
        // Set data on the structure being built.
        data: {
          // Set status on the structure being built.
          status: InvitationStatus.consumed,
          // Set consumedAt on the structure being built.
          consumedAt: new Date(),
        },
      });
      // Branch when this condition holds so the right path runs.
      if (claimed.count === 0) {
        // Load current asynchronously for the next steps.
        const current = await tx.invitation.findUnique({ where: { id: inv.id } });
        // Branch when this condition holds so the right path runs.
        if (current && current.expiresAt.getTime() <= Date.now()) {
          // Branch when this condition holds so the right path runs.
          if (current.status === InvitationStatus.issued) {
            // Wait for the async step before continuing.
            await tx.invitation.update({
              // Set where on the structure being built.
              where: { id: inv.id },
              // Set data on the structure being built.
              data: { status: InvitationStatus.expired },
            });
          }
          // Abort with an error so callers can react.
          throw new AppError(400, "expired", "Invitation code has expired");
        }
        // Abort with an error so callers can react.
        throw new AppError(409, "conflict", "Invitation already consumed");
      }

      // Define requirePassword as a callable used by this flow.
      const requirePassword = () => {
        // Branch when this condition holds so the right path runs.
        if (!passwordHash) {
          // Abort with an error so callers can react.
          throw new AppError(
            // Run next step: 400,
            400,
            // Run next step: "validation",
            "validation",
            // Run next step: "Password of at least 8 characters is required",
            "Password of at least 8 characters is required",
          );
        }
        // Return the computed result to the caller.
        return passwordHash;
      };

      // Capture user id for use in this scope.
      let userId: string;
      // Capture bumped access for use in this scope.
      let bumpedAccess = false;
      // No user row yet → create activated account from invite role/email.
      if (!freshUser) {
        // Load created asynchronously for the next steps.
        const created = await tx.user.create({
          // Set data on the structure being built.
          data: {
            // Set employeeId on the structure being built.
            employeeId: inv.employeeId,
            // Set email on the structure being built.
            email: inv.email,
            // Set passwordHash on the structure being built.
            passwordHash: requirePassword(),
            // Set role on the structure being built.
            role: inv.role,
            // Set activatedAt on the structure being built.
            activatedAt: new Date(),
            // Set isActive on the structure being built.
            isActive: true,
          },
        });
        // Update user id as control flow progresses.
        userId = created.id;
        // Update bumped access as control flow progresses.
        bumpedAccess = true;
      // Run next step: } else if (!freshUser.activatedAt) {
      } else if (!freshUser.activatedAt) {
        // Activation: keep the current User.role; never restore Invitation.role.
        const updated = await tx.user.update({
          // Set where on the structure being built.
          where: { id: freshUser.id },
          // Set data on the structure being built.
          data: {
            // Set passwordHash on the structure being built.
            passwordHash: requirePassword(),
            // Set activatedAt on the structure being built.
            activatedAt: new Date(),
          },
        });
        // Update user id as control flow progresses.
        userId = updated.id;
        // Update bumped access as control flow progresses.
        bumpedAccess = true;
      // Run next step: } else {
      } else {
        // Already activated — redeem only registers a new device + session.
        userId = freshUser.id;
      }

      // Branch when this condition holds so the right path runs.
      if (bumpedAccess) {
        // Wait for the async step before continuing.
        await tx.employee.update({
          // Set where on the structure being built.
          where: { id: inv.employeeId },
          // Set data on the structure being built.
          data: { accessVersion: { increment: 1 } },
        });
      }

      // Same browser re-activate: revoke prior non-revoked rows for this user
      // fingerprint (history kept; do not merge into a foreign user's device).
      const now = new Date();
      // Load prior same fingerprint asynchronously for the next steps.
      const priorSameFingerprint = await tx.device.findMany({
        // Set where on the structure being built.
        where: { userId, fingerprint, revokedAt: null },
        // Set select on the structure being built.
        select: { id: true },
      });
      // Capture prior ids for use in this scope.
      const priorIds = priorSameFingerprint.map((d) => d.id);
      // Branch when this condition holds so the right path runs.
      if (priorIds.length > 0) {
        // Wait for the async step before continuing.
        await tx.device.updateMany({
          // Set where on the structure being built.
          where: { id: { in: priorIds }, revokedAt: null },
          // Set data on the structure being built.
          data: { revokedAt: now },
        });
        // Wait for the async step before continuing.
        await tx.authSession.updateMany({
          // Set where on the structure being built.
          where: { deviceId: { in: priorIds }, revokedAt: null },
          // Set data on the structure being built.
          data: { revokedAt: now },
        });
      }

      // Register this browser/device under the user (multi-device allowed).
      const device = await tx.device.create({
        // Set data on the structure being built.
        data: {
          // Run next step: userId,
          userId,
          // Set employeeId on the structure being built.
          employeeId: inv.employeeId,
          // Set label on the structure being built.
          label: deviceLabel,
          // Run next step: fingerprint,
          fingerprint,
        },
      });

      // Link the consumed invite to the device that redeemed it.
      await tx.invitation.update({
        // Set where on the structure being built.
        where: { id: inv.id },
        // Set data on the structure being built.
        data: { consumedDeviceId: device.id },
      });

      // Reload with employee for the response DTO.
      const fullUser = await tx.user.findUniqueOrThrow({
        // Set where on the structure being built.
        where: { id: userId },
        // Set include on the structure being built.
        include: { employee: true },
      });

      // Issue session inside the same TX (shares the client).
      const tokens = await createSessionWithClient(tx, {
        // Set userId on the structure being built.
        userId: fullUser.id,
        // Set deviceId on the structure being built.
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
    // Run next step: ...tokens,
    ...tokens,
    // Set user on the structure being built.
    user: {
      // Set id on the structure being built.
      id: fullUser.id,
      // Set email on the structure being built.
      email: fullUser.email,
      // Set role on the structure being built.
      role: fullUser.role,
      // Set employeeId on the structure being built.
      employeeId: fullUser.employeeId,
      // Set fullName on the structure being built.
      fullName: fullUser.employee.fullName,
      // Set panels on the structure being built.
      panels: caps.panels,
      // Set actions on the structure being built.
      actions: caps.actions,
      // Set landing on the structure being built.
      landing: caps.landing,
    },
    // Set device on the structure being built.
    device: {
      // Set id on the structure being built.
      id: device.id,
      // Set label on the structure being built.
      label: device.label,
      // Set activatedAt on the structure being built.
      activatedAt: device.activatedAt.toISOString(),
    },
  };
}
