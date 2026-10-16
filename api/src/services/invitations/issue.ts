/**
 * Issue / list / revoke staff invitations. New employees get a placeholder user
 * password until redeem; existing employees get a re-invite that revokes prior
 * issued codes for that employee.
 */
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

/** Forbid inviting roles the actor is not allowed to assign. */
function assertAssignableRole(actorRole: Role, role: Role) {
  // Owner/admin invite rules live in permissions.assignableRolesFor.
  if (!assignableRolesFor(actorRole).includes(role)) {
    // Role is outside the actor's assignable set — reject before any DB work.
    throw new AppError(
      403,
      "forbidden",
      "Cannot invite owner/admin roles",
    );
  }
}

/** Revoke any still-issued invites for this employee (re-invite path). */
async function revokeIssuedForEmployee(
  tx: Prisma.TransactionClient,
  employeeId: string,
) {
  // Soft-revoke so only one issued code is live per employee.
  await tx.invitation.updateMany({
    where: { employeeId, status: InvitationStatus.issued },
    data: { status: InvitationStatus.revoked, revokedAt: new Date() },
  });
}

/**
 * Discriminated input: onboard a brand-new employee or re-issue for an existing one.
 */
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

/**
 * Issue an invitation code (plaintext returned once) and QR payload URL.
 * TTL comes from access.invitationTtlHours. Only the code hash is persisted.
 *
 * @param actor - Issuer user id + role for assignable-role checks.
 * @param input - New employee onboarding or existing-employee re-invite.
 * @param qrBaseUrl - WEB origin used to build the activate deep link.
 */
export async function issueInvitation(
  actor: { userId: string; role: Role },
  input: IssueInvitationInput,
  qrBaseUrl: string,
) {
  // TTL from access settings; plaintext code returned once to the issuer.
  const access = await getSetting("access");
  const ttlHours = access.invitationTtlHours;
  // Absolute expiry anchored at issue time (hotel access policy).
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  const code = generateInviteCode();
  // Persist hash only; plaintext `code` is returned once below.
  const codeHash = hashInviteCode(code);
  // Last 4 chars shown in the admin UI (not enough to redeem).
  const codeHint = code.slice(-4);

  // All employee/user/invite writes share one transaction boundary.
  const invitation = await prisma.$transaction(async (tx) => {
    // Populated in the new vs existing branch below.
    let employeeId: string;
    let role: Role;
    let email: string;

    if (input.kind === "new") {
      assertAssignableRole(actor.role, input.role);
      // Unique employee number / email before insert.
      const existingNumber = await tx.employee.findUnique({
        where: { employeeNumber: input.employeeNumber },
      });
      if (existingNumber) {
        // Employee numbers are globally unique in the catalog.
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
        // One user row per email — block duplicate invites.
        throw new AppError(409, "conflict", "Email already exists");
      }

      // HR record first; user row links via employeeId.
      const employee = await tx.employee.create({
        data: {
          fullName: input.fullName.trim(),
          employeeNumber: input.employeeNumber.trim(),
          department: input.department?.trim() || null,
        },
      });
      // Placeholder password until redeem sets a real one; not activated yet.
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
      // Carry ids forward for the invitation row insert.
      employeeId = employee.id;
      role = input.role;
      email = input.email.trim().toLowerCase();
    } else {
      // Re-invite existing employee — revoke prior issued codes.
      // Load employee + optional linked user for role/email resolution.
      const employee = await tx.employee.findUnique({
        where: { id: input.employeeId },
        include: { user: true },
      });
      if (!employee) {
        // Unknown employeeId on the re-invite path.
        throw new AppError(404, "not_found", "Employee not found");
      }

      if (employee.user) {
        // Account already exists — reuse stored role/email.
        if (!employee.user.isActive) {
          // Blocked users must not receive a fresh activation code.
          throw new AppError(400, "validation", "Cannot invite a blocked account");
        }
        assertAssignableRole(actor.role, employee.user.role);
        employeeId = employee.id;
        role = employee.user.role;
        email = employee.user.email;
      } else {
        // Employee without login yet — caller must supply email + role.
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
          // Email taken by another employee's user row.
          throw new AppError(409, "conflict", "Email already exists");
        }
        // Create pending user; redeem will set the real password.
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
        // New pending user on an existing employee record.
        employeeId = employee.id;
        role = input.role;
        email = input.email.trim().toLowerCase();
      }
    }

    // Ensure only one issued invite is live per employee.
    await revokeIssuedForEmployee(tx, employeeId);

    // Persist hash only — plaintext `code` is returned to the caller once.
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

  // Deep-link for QR / share; code is query-encoded.
  const qrPayload = `${qrBaseUrl.replace(/\/$/, "")}/#/activate?code=${encodeURIComponent(code)}`;

  // People admin list should refresh.
  publish("people.changed");

  // Plaintext `code` only appears in this response — never persisted.
  return {
    invitation: mapInvitation(invitation),
    code,
    qrPayload,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * List currently issued (non-expired) invitations after running expiry housekeeping.
 * Runs lazy expiry before querying so the admin list matches redeem semantics.
 */
export async function listActiveInvitations() {
  // Lazy-expire past-due rows before listing.
  await expireStaleInvitations();
  // Still-issued and not past expiresAt.
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
  // Map Prisma rows to the stable API invitation DTO.
  return rows.map(mapInvitation);
}

/**
 * Revoke an issued invitation so its code can no longer be redeemed.
 *
 * @param id - Invitation primary key.
 */
export async function revokeInvitation(id: string) {
  // 404 when the id is unknown.
  const existing = await prisma.invitation.findUnique({ where: { id } });
  if (!existing) {
    // Unknown invitation id — distinct from "not revocable".
    throw new AppError(404, "not_found", "Invitation not found");
  }

  // Conditional update — only issued rows can be revoked.
  const revokedAt = new Date();
  // updateMany gives a count without throwing when zero rows match.
  const claimed = await prisma.invitation.updateMany({
    where: { id, status: InvitationStatus.issued },
    data: { status: InvitationStatus.revoked, revokedAt },
  });
  // Already consumed/expired/revoked → conflict.
  if (claimed.count === 0) {
    // consumed / expired / already revoked — nothing to revoke.
    throw new AppError(409, "conflict", "Only issued invitations can be revoked");
  }

  // Reload with joins for the API response.
  const updated = await prisma.invitation.findUniqueOrThrow({
    where: { id },
    include: {
      employee: true,
      createdBy: { include: { employee: true } },
    },
  });
  // Revoked row mapped to the public invitation DTO.
  return mapInvitation(updated);
}
