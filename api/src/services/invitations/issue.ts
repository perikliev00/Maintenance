import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { InvitationStatus, Prisma, Role } from "@prisma/client";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { assignableRolesFor } from "../../permissions";
import { publish } from "../../events/bus";
import { getSetting } from "../settings";
import { generateInviteCode, hashInviteCode } from "./codes";
import { expireStaleInvitations, mapInvitation } from "./map";

function assertAssignableRole(actorRole: Role, role: Role) {
  if (!assignableRolesFor(actorRole).includes(role)) {
    throw new AppError(
      403,
      "forbidden",
      "Cannot invite owner/admin roles",
    );
  }
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
