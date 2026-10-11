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

export async function redeemInvitation(input: {
  code: string;
  password?: string;
  deviceLabel: string;
  fingerprint: string;
}) {
  await expireStaleInvitations();
  const codeHash = hashInviteCode(input.code);
  const inv = await prisma.invitation.findUnique({
    where: { codeHash },
    include: {
      employee: { include: { user: true } },
    },
  });
  if (!inv || inv.status !== InvitationStatus.issued) {
    throw new AppError(400, "invalid_code", "Invitation code is invalid or used");
  }
  if (inv.expiresAt.getTime() <= Date.now()) {
    await prisma.invitation.update({
      where: { id: inv.id },
      data: { status: InvitationStatus.expired },
    });
    throw new AppError(400, "expired", "Invitation code has expired");
  }

  const existingUser = inv.employee.user;
  if (existingUser && !existingUser.isActive) {
    throw new AppError(403, "forbidden", "Account is blocked");
  }

  const needsUserCreate = !existingUser;
  const needsActivation = Boolean(existingUser && !existingUser.activatedAt);
  let passwordHash: string | undefined;
  if (needsUserCreate || needsActivation) {
    if (!input.password || input.password.length < 8) {
      throw new AppError(
        400,
        "validation",
        "Password of at least 8 characters is required",
      );
    }
    passwordHash = await bcrypt.hash(input.password, 10);
  }

  const fingerprint =
    input.fingerprint.trim() || `anon-${randomBytes(8).toString("hex")}`;
  const deviceLabel = input.deviceLabel.trim() || "Device";

  const { device, fullUser, tokens } = await prisma.$transaction(
    async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Invitation" WHERE id = ${inv.id} FOR UPDATE
      `;
      if (locked.length === 0) {
        throw new AppError(400, "invalid_code", "Invitation code is invalid or used");
      }

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
      if (claimed.count === 0) {
        const current = await tx.invitation.findUnique({ where: { id: inv.id } });
        if (current && current.expiresAt.getTime() <= Date.now()) {
          if (current.status === InvitationStatus.issued) {
            await tx.invitation.update({
              where: { id: inv.id },
              data: { status: InvitationStatus.expired },
            });
          }
          throw new AppError(400, "expired", "Invitation code has expired");
        }
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

      if (freshUser && !freshUser.isActive) {
        throw new AppError(403, "forbidden", "Account is blocked");
      }

      const requirePassword = () => {
        if (!passwordHash) {
          throw new AppError(
            400,
            "validation",
            "Password of at least 8 characters is required",
          );
        }
        return passwordHash;
      };

      let userId: string;
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
        userId = freshUser.id;
      }

      const device = await tx.device.create({
        data: {
          userId,
          employeeId: inv.employeeId,
          label: deviceLabel,
          fingerprint,
        },
      });

      await tx.invitation.update({
        where: { id: inv.id },
        data: { consumedDeviceId: device.id },
      });

      const fullUser = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        include: { employee: true },
      });

      const tokens = await createSessionWithClient(tx, {
        userId: fullUser.id,
        deviceId: device.id,
      });

      return { device, fullUser, tokens };
    },
  );

  const caps = await capabilitiesFor(fullUser.role);

  publish("people.changed");

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
