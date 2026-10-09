import { createHash, randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import {
  InvitationStatus,
  Prisma,
  Role,
} from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";
import { assignableRolesFor } from "../permissions";
import { getSetting } from "./settings";
import { capabilitiesFor } from "./roleGrants";
import {
  createSessionWithClient,
  revokeAllForDevice,
} from "./authSessions";
import { publish } from "../events/bus";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function hashInviteCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

export function generateInviteCode(): string {
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

function assertAssignableRole(actorRole: Role, role: Role) {
  if (!assignableRolesFor(actorRole).includes(role)) {
    throw new AppError(
      403,
      "forbidden",
      "Cannot invite owner/admin roles",
    );
  }
}

export function mapInvitation(inv: {
  id: string;
  codeHint: string;
  employeeId: string;
  role: Role;
  email: string;
  status: InvitationStatus;
  expiresAt: Date;
  createdAt: Date;
  consumedAt: Date | null;
  revokedAt: Date | null;
  employee: { fullName: string; employeeNumber: string };
  createdBy: { id: string; email: string; employee: { fullName: string } };
}) {
  return {
    id: inv.id,
    codeHint: inv.codeHint,
    employeeId: inv.employeeId,
    fullName: inv.employee.fullName,
    employeeNumber: inv.employee.employeeNumber,
    role: inv.role,
    email: inv.email,
    status: inv.status,
    expiresAt: inv.expiresAt.toISOString(),
    createdAt: inv.createdAt.toISOString(),
    consumedAt: inv.consumedAt?.toISOString() ?? null,
    revokedAt: inv.revokedAt?.toISOString() ?? null,
    createdBy: {
      id: inv.createdBy.id,
      email: inv.createdBy.email,
      fullName: inv.createdBy.employee.fullName,
    },
  };
}

async function expireStaleInvitations() {
  await prisma.invitation.updateMany({
    where: {
      status: InvitationStatus.issued,
      expiresAt: { lt: new Date() },
    },
    data: { status: InvitationStatus.expired },
  });
}

async function revokeIssuedForEmployee(
  tx: Prisma.TransactionClient,
  employeeId: string,
) {
  await tx.invitation.updateMany({
    where: { employeeId, status: InvitationStatus.issued },
    data: { status: InvitationStatus.revoked, revokedAt: new Date() },
  });
}

export type IssueInvitationInput =
  | {
      kind: "new";
      fullName: string;
      employeeNumber: string;
      email: string;
      role: Role;
      department?: string | null;
    }
  | {
      kind: "existing";
      employeeId: string;
      email?: string;
      role?: Role;
    };

export async function issueInvitation(
  actor: { userId: string; role: Role },
  input: IssueInvitationInput,
  qrBaseUrl: string,
) {
  const access = await getSetting("access");
  const ttlHours = access.invitationTtlHours;
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  const code = generateInviteCode();
  const codeHash = hashInviteCode(code);
  const codeHint = code.slice(-4);

  const invitation = await prisma.$transaction(async (tx) => {
    let employeeId: string;
    let role: Role;
    let email: string;

    if (input.kind === "new") {
      assertAssignableRole(actor.role, input.role);
      const existingNumber = await tx.employee.findUnique({
        where: { employeeNumber: input.employeeNumber },
      });
      if (existingNumber) {
        throw new AppError(
          409,
          "conflict",
          "Employee number already exists",
        );
      }
      const existingEmail = await tx.user.findUnique({
        where: { email: input.email.toLowerCase() },
      });
      if (existingEmail) {
        throw new AppError(409, "conflict", "Email already exists");
      }

      const employee = await tx.employee.create({
        data: {
          fullName: input.fullName.trim(),
          employeeNumber: input.employeeNumber.trim(),
          department: input.department?.trim() || null,
        },
      });
      await tx.user.create({
        data: {
          employeeId: employee.id,
          email: input.email.trim().toLowerCase(),
          passwordHash: await bcrypt.hash(`pending-${randomBytes(16).toString("hex")}`, 10),
          role: input.role,
          activatedAt: null,
          isActive: true,
        },
      });
      employeeId = employee.id;
      role = input.role;
      email = input.email.trim().toLowerCase();
    } else {
      const employee = await tx.employee.findUnique({
        where: { id: input.employeeId },
        include: { user: true },
      });
      if (!employee) {
        throw new AppError(404, "not_found", "Employee not found");
      }

      if (employee.user) {
        if (!employee.user.isActive) {
          throw new AppError(400, "validation", "Cannot invite a blocked account");
        }
        assertAssignableRole(actor.role, employee.user.role);
        employeeId = employee.id;
        role = employee.user.role;
        email = employee.user.email;
      } else {
        if (!input.email || !input.role) {
          throw new AppError(
            400,
            "validation",
            "Email and role are required to onboard an employee without an account",
          );
        }
        assertAssignableRole(actor.role, input.role);
        const existingEmail = await tx.user.findUnique({
          where: { email: input.email.toLowerCase() },
        });
        if (existingEmail) {
          throw new AppError(409, "conflict", "Email already exists");
        }
        await tx.user.create({
          data: {
            employeeId: employee.id,
            email: input.email.trim().toLowerCase(),
            passwordHash: await bcrypt.hash(
              `pending-${randomBytes(16).toString("hex")}`,
              10,
            ),
            role: input.role,
            activatedAt: null,
            isActive: true,
          },
        });
        employeeId = employee.id;
        role = input.role;
        email = input.email.trim().toLowerCase();
      }
    }

    await revokeIssuedForEmployee(tx, employeeId);

    return tx.invitation.create({
      data: {
        codeHash,
        codeHint,
        employeeId,
        role,
        email,
        status: InvitationStatus.issued,
        expiresAt,
        createdByUserId: actor.userId,
      },
      include: {
        employee: true,
        createdBy: { include: { employee: true } },
      },
    });
  });

  const qrPayload = `${qrBaseUrl.replace(/\/$/, "")}/#/activate?code=${encodeURIComponent(code)}`;

  publish("people.changed");

  return {
    invitation: mapInvitation(invitation),
    code,
    qrPayload,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function listActiveInvitations() {
  await expireStaleInvitations();
  const rows = await prisma.invitation.findMany({
    where: {
      status: InvitationStatus.issued,
      expiresAt: { gt: new Date() },
    },
    include: {
      employee: true,
      createdBy: { include: { employee: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(mapInvitation);
}

export async function revokeInvitation(id: string) {
  const existing = await prisma.invitation.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, "not_found", "Invitation not found");
  }

  const revokedAt = new Date();
  const claimed = await prisma.invitation.updateMany({
    where: { id, status: InvitationStatus.issued },
    data: { status: InvitationStatus.revoked, revokedAt },
  });
  if (claimed.count === 0) {
    throw new AppError(409, "conflict", "Only issued invitations can be revoked");
  }

  const updated = await prisma.invitation.findUniqueOrThrow({
    where: { id },
    include: {
      employee: true,
      createdBy: { include: { employee: true } },
    },
  });
  return mapInvitation(updated);
}

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

export async function listDevices(employeeId?: string) {
  const devices = await prisma.device.findMany({
    where: {
      revokedAt: null,
      ...(employeeId ? { employeeId } : {}),
    },
    include: {
      employee: true,
      user: { select: { email: true, role: true } },
    },
    orderBy: { activatedAt: "desc" },
  });
  return devices.map((d) => ({
    id: d.id,
    label: d.label,
    fingerprint: d.fingerprint,
    employeeId: d.employeeId,
    userId: d.userId,
    fullName: d.employee.fullName,
    employeeNumber: d.employee.employeeNumber,
    email: d.user.email,
    role: d.user.role,
    activatedAt: d.activatedAt.toISOString(),
    lastSeenAt: d.lastSeenAt.toISOString(),
  }));
}

export async function revokeDevice(id: string) {
  const device = await prisma.device.findUnique({ where: { id } });
  if (!device) {
    throw new AppError(404, "not_found", "Device not found");
  }
  if (device.revokedAt) {
    throw new AppError(409, "conflict", "Device already revoked");
  }
  const updated = await prisma.device.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
  await revokeAllForDevice(id);
  return {
    id: updated.id,
    revokedAt: updated.revokedAt!.toISOString(),
  };
}
