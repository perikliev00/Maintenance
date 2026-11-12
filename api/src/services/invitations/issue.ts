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
import {
  lockEmployeeRowsForUpdate,
  lockEmployeesForLiveAccess,
  lockUsersForLiveAccess,
} from "../liveAccessLocks";
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
 * Issue an invitation code (plaintext returned once).
 * TTL comes from access.invitationTtlHours. Only the code hash is persisted.
 *
 * @param actor - Issuer user id + role for assignable-role checks.
 * @param input - New employee onboarding or existing-employee re-invite.
 */
export async function issueInvitation(
  actor: { userId: string; role: Role },
  input: IssueInvitationInput,
) {
  // TTL from access settings; plaintext code returned once to the issuer.
  const access = await getSetting("access");
  // Capture ttl hours for use in this scope.
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
      // Load existing number asynchronously for the next steps.
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
      // Load existing email asynchronously for the next steps.
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
      // Load created user asynchronously for the next steps.
      const createdUser = await tx.user.create({
        data: {
          employeeId: employee.id,
          email: input.email.trim().toLowerCase(),
          passwordHash: await bcrypt.hash(`pending-${randomBytes(16).toString("hex")}`, 10),
          role: input.role,
          activatedAt: null,
          isActive: true,
        },
      });
      // Lock newly created rows in protocol order before invite insert.
      await lockUsersForLiveAccess(tx, [createdUser.id]);
      await lockEmployeeRowsForUpdate(tx, [employee.id]);

      // Update employee id as control flow progresses.
      employeeId = employee.id;
      role = input.role;
      email = input.email.trim().toLowerCase();
    } else {
      // Lock person rows before archived/blocked/role checks (anti-TOCTOU vs lifecycle).
      await lockEmployeesForLiveAccess(tx, [input.employeeId]);
      await lockEmployeeRowsForUpdate(tx, [input.employeeId]);

      const employee = await tx.employee.findUnique({
        where: { id: input.employeeId },
        include: { user: true },
      });
      if (!employee) {
        // Abort with an error so callers can react.
        throw new AppError(404, "not_found", "Employee not found");
      }

      if (employee.archivedAt) {
        // Abort with an error so callers can react.
        throw new AppError(
          400,
          "validation",
          "Cannot invite an archived employee",
        );
      }

      if (employee.user) {
        if (!employee.user.isActive) {
          // Abort with an error so callers can react.
          throw new AppError(400, "validation", "Cannot invite a blocked account");
        }
        // Re-check privileges against the locked current role (role-change race).
        assertAssignableRole(actor.role, employee.user.role);
        // Update employee id as control flow progresses.
        employeeId = employee.id;
        role = employee.user.role;
        email = employee.user.email;
      } else {
        if (!input.email || !input.role) {
          // Abort with an error so callers can react.
          throw new AppError(
            400,
            "validation",
            "Email and role are required to onboard an employee without an account",
          );
        }
        assertAssignableRole(actor.role, input.role);
        // Load existing email asynchronously for the next steps.
        const existingEmail = await tx.user.findUnique({
          where: { email: input.email.toLowerCase() },
        });
        if (existingEmail) {
          // Abort with an error so callers can react.
          throw new AppError(409, "conflict", "Email already exists");
        }
        // Load created user asynchronously for the next steps.
        const createdUser = await tx.user.create({
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
        // Take the new User lock so concurrent writers see the same order.
        await lockUsersForLiveAccess(tx, [createdUser.id]);
        await tx.employee.update({
          where: { id: employee.id },
          data: { accessVersion: { increment: 1 } },
        });
        // Update employee id as control flow progresses.
        employeeId = employee.id;
        role = input.role;
        email = input.email.trim().toLowerCase();
      }
    }

    // Serialized under Employee(+User) locks → at most one issued invite.
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

  // People admin list should refresh.
  publish("people.changed");

  // Plaintext `code` only appears in this response — never persisted.
  return {
    invitation: mapInvitation(invitation),
    code,
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
