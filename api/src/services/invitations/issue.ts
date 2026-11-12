/**
 * Issue / list / revoke staff invitations. New employees get a placeholder user
 * password until redeem; existing employees get a re-invite that revokes prior
 * issued codes for that employee.
 */
import { randomBytes } from "crypto";
// Import module bcryptjs for this service.
import bcrypt from "bcryptjs";
// Import module @prisma/client for this service.
import { InvitationStatus, Prisma, Role } from "@prisma/client";
// Import module ../../db for this service.
import { prisma } from "../../db";
// Import module ../../errors for this service.
import { AppError } from "../../errors";
// Import module ../../permissions for this service.
import { assignableRolesFor } from "../../permissions";
// Import module ../../events/bus for this service.
import { publish } from "../../events/bus";
// Import module dependency for this service.
import {
  // Run next step: lockEmployeeRowsForUpdate,
  lockEmployeeRowsForUpdate,
  // Run next step: lockEmployeesForLiveAccess,
  lockEmployeesForLiveAccess,
  // Run next step: lockUsersForLiveAccess,
  lockUsersForLiveAccess,
// Run next step: } from "../liveAccessLocks";
} from "../liveAccessLocks";
// Import module ../settings for this service.
import { getSetting } from "../settings";
// Import module ./codes for this service.
import { generateInviteCode, hashInviteCode } from "./codes";
// Import module ./map for this service.
import { expireStaleInvitations, mapInvitation } from "./map";

/** Forbid inviting roles the actor is not allowed to assign. */
function assertAssignableRole(actorRole: Role, role: Role) {
  // Owner/admin invite rules live in permissions.assignableRolesFor.
  if (!assignableRolesFor(actorRole).includes(role)) {
    // Role is outside the actor's assignable set — reject before any DB work.
    throw new AppError(
      // Run next step: 403,
      403,
      // Run next step: "forbidden",
      "forbidden",
      // Run next step: "Cannot invite owner/admin roles",
      "Cannot invite owner/admin roles",
    );
  }
}

/** Revoke any still-issued invites for this employee (re-invite path). */
async function revokeIssuedForEmployee(
  // Set tx on the structure being built.
  tx: Prisma.TransactionClient,
  // Set employeeId on the structure being built.
  employeeId: string,
// Run next step: ) {
) {
  // Soft-revoke so only one issued code is live per employee.
  await tx.invitation.updateMany({
    // Set where on the structure being built.
    where: { employeeId, status: InvitationStatus.issued },
    // Set data on the structure being built.
    data: { status: InvitationStatus.revoked, revokedAt: new Date() },
  });
}

/**
 * Discriminated input: onboard a brand-new employee or re-issue for an existing one.
 */
export type IssueInvitationInput =
  // Run next step: | {
  | {
      // Set kind on the structure being built.
      kind: "new";
      // Set fullName on the structure being built.
      fullName: string;
      // Set employeeNumber on the structure being built.
      employeeNumber: string;
      // Set email on the structure being built.
      email: string;
      // Set role on the structure being built.
      role: Role;
      // Run next step: department?: string | null;
      department?: string | null;
    }
  // Run next step: | {
  | {
      // Set kind on the structure being built.
      kind: "existing";
      // Set employeeId on the structure being built.
      employeeId: string;
      // Run next step: email?: string;
      email?: string;
      // Run next step: role?: Role;
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
  // Set actor on the structure being built.
  actor: { userId: string; role: Role },
  // Set input on the structure being built.
  input: IssueInvitationInput,
// Run next step: ) {
) {
  // TTL from access settings; plaintext code returned once to the issuer.
  const access = await getSetting("access");
  // Capture ttl hours for use in this scope.
  const ttlHours = access.invitationTtlHours;
  // Absolute expiry anchored at issue time (hotel access policy).
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  // Capture code for use in this scope.
  const code = generateInviteCode();
  // Persist hash only; plaintext `code` is returned once below.
  const codeHash = hashInviteCode(code);
  // Last 4 chars shown in the admin UI (not enough to redeem).
  const codeHint = code.slice(-4);

  // All employee/user/invite writes share one transaction boundary.
  const invitation = await prisma.$transaction(async (tx) => {
    // Populated in the new vs existing branch below.
    let employeeId: string;
    // Capture role for use in this scope.
    let role: Role;
    // Capture email for use in this scope.
    let email: string;

    // Branch when this condition holds so the right path runs.
    if (input.kind === "new") {
      // Run next step: assertAssignableRole(actor.role, input.role);
      assertAssignableRole(actor.role, input.role);
      // Load existing number asynchronously for the next steps.
      const existingNumber = await tx.employee.findUnique({
        // Set where on the structure being built.
        where: { employeeNumber: input.employeeNumber },
      });
      // Branch when this condition holds so the right path runs.
      if (existingNumber) {
        // Abort with an error so callers can react.
        throw new AppError(
          // Run next step: 409,
          409,
          // Run next step: "conflict",
          "conflict",
          // Run next step: "Employee number already exists",
          "Employee number already exists",
        );
      }
      // Load existing email asynchronously for the next steps.
      const existingEmail = await tx.user.findUnique({
        // Set where on the structure being built.
        where: { email: input.email.toLowerCase() },
      });
      // Branch when this condition holds so the right path runs.
      if (existingEmail) {
        // Abort with an error so callers can react.
        throw new AppError(409, "conflict", "Email already exists");
      }

      // Load employee asynchronously for the next steps.
      const employee = await tx.employee.create({
        // Set data on the structure being built.
        data: {
          // Set fullName on the structure being built.
          fullName: input.fullName.trim(),
          // Set employeeNumber on the structure being built.
          employeeNumber: input.employeeNumber.trim(),
          // Set department on the structure being built.
          department: input.department?.trim() || null,
        },
      });
      // Load created user asynchronously for the next steps.
      const createdUser = await tx.user.create({
        // Set data on the structure being built.
        data: {
          // Set employeeId on the structure being built.
          employeeId: employee.id,
          // Set email on the structure being built.
          email: input.email.trim().toLowerCase(),
          // Set passwordHash on the structure being built.
          passwordHash: await bcrypt.hash(`pending-${randomBytes(16).toString("hex")}`, 10),
          // Set role on the structure being built.
          role: input.role,
          // Set activatedAt on the structure being built.
          activatedAt: null,
          // Set isActive on the structure being built.
          isActive: true,
        },
      });
      // Lock newly created rows in protocol order before invite insert.
      await lockUsersForLiveAccess(tx, [createdUser.id]);
      // Wait for the async step before continuing.
      await lockEmployeeRowsForUpdate(tx, [employee.id]);

      // Update employee id as control flow progresses.
      employeeId = employee.id;
      // Update role as control flow progresses.
      role = input.role;
      // Update email as control flow progresses.
      email = input.email.trim().toLowerCase();
    // Run next step: } else {
    } else {
      // Lock person rows before archived/blocked/role checks (anti-TOCTOU vs lifecycle).
      await lockEmployeesForLiveAccess(tx, [input.employeeId]);
      // Wait for the async step before continuing.
      await lockEmployeeRowsForUpdate(tx, [input.employeeId]);

      // Load employee asynchronously for the next steps.
      const employee = await tx.employee.findUnique({
        // Set where on the structure being built.
        where: { id: input.employeeId },
        // Set include on the structure being built.
        include: { user: true },
      });
      // Branch when this condition holds so the right path runs.
      if (!employee) {
        // Abort with an error so callers can react.
        throw new AppError(404, "not_found", "Employee not found");
      }

      // Branch when this condition holds so the right path runs.
      if (employee.archivedAt) {
        // Abort with an error so callers can react.
        throw new AppError(
          // Run next step: 400,
          400,
          // Run next step: "validation",
          "validation",
          // Run next step: "Cannot invite an archived employee",
          "Cannot invite an archived employee",
        );
      }

      // Branch when this condition holds so the right path runs.
      if (employee.user) {
        // Branch when this condition holds so the right path runs.
        if (!employee.user.isActive) {
          // Abort with an error so callers can react.
          throw new AppError(400, "validation", "Cannot invite a blocked account");
        }
        // Re-check privileges against the locked current role (role-change race).
        assertAssignableRole(actor.role, employee.user.role);
        // Update employee id as control flow progresses.
        employeeId = employee.id;
        // Update role as control flow progresses.
        role = employee.user.role;
        // Update email as control flow progresses.
        email = employee.user.email;
      // Run next step: } else {
      } else {
        // Branch when this condition holds so the right path runs.
        if (!input.email || !input.role) {
          // Abort with an error so callers can react.
          throw new AppError(
            // Run next step: 400,
            400,
            // Run next step: "validation",
            "validation",
            // Run next step: "Email and role are required to onboard an employee without …
            "Email and role are required to onboard an employee without an account",
          );
        }
        // Run next step: assertAssignableRole(actor.role, input.role);
        assertAssignableRole(actor.role, input.role);
        // Load existing email asynchronously for the next steps.
        const existingEmail = await tx.user.findUnique({
          // Set where on the structure being built.
          where: { email: input.email.toLowerCase() },
        });
        // Branch when this condition holds so the right path runs.
        if (existingEmail) {
          // Abort with an error so callers can react.
          throw new AppError(409, "conflict", "Email already exists");
        }
        // Load created user asynchronously for the next steps.
        const createdUser = await tx.user.create({
          // Set data on the structure being built.
          data: {
            // Set employeeId on the structure being built.
            employeeId: employee.id,
            // Set email on the structure being built.
            email: input.email.trim().toLowerCase(),
            // Set passwordHash on the structure being built.
            passwordHash: await bcrypt.hash(
              // Run next step: `pending-${randomBytes(16).toString("hex")}`,
              `pending-${randomBytes(16).toString("hex")}`,
              // Run next step: 10,
              10,
            ),
            // Set role on the structure being built.
            role: input.role,
            // Set activatedAt on the structure being built.
            activatedAt: null,
            // Set isActive on the structure being built.
            isActive: true,
          },
        });
        // Take the new User lock so concurrent writers see the same order.
        await lockUsersForLiveAccess(tx, [createdUser.id]);
        // Wait for the async step before continuing.
        await tx.employee.update({
          // Set where on the structure being built.
          where: { id: employee.id },
          // Set data on the structure being built.
          data: { accessVersion: { increment: 1 } },
        });
        // Update employee id as control flow progresses.
        employeeId = employee.id;
        // Update role as control flow progresses.
        role = input.role;
        // Update email as control flow progresses.
        email = input.email.trim().toLowerCase();
      }
    }

    // Serialized under Employee(+User) locks → at most one issued invite.
    await revokeIssuedForEmployee(tx, employeeId);

    // Return the computed result to the caller.
    return tx.invitation.create({
      // Set data on the structure being built.
      data: {
        // Run next step: codeHash,
        codeHash,
        // Run next step: codeHint,
        codeHint,
        // Run next step: employeeId,
        employeeId,
        // Run next step: role,
        role,
        // Run next step: email,
        email,
        // Set status on the structure being built.
        status: InvitationStatus.issued,
        // Run next step: expiresAt,
        expiresAt,
        // Set createdByUserId on the structure being built.
        createdByUserId: actor.userId,
      },
      // Set include on the structure being built.
      include: {
        // Set employee on the structure being built.
        employee: true,
        // Set createdBy on the structure being built.
        createdBy: { include: { employee: true } },
      },
    });
  });

  // People admin list should refresh.
  publish("people.changed");

  // Plaintext `code` only appears in this response — never persisted.
  return {
    // Set invitation on the structure being built.
    invitation: mapInvitation(invitation),
    // Run next step: code,
    code,
    // Set expiresAt on the structure being built.
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
    // Set where on the structure being built.
    where: {
      // Set status on the structure being built.
      status: InvitationStatus.issued,
      // Set expiresAt on the structure being built.
      expiresAt: { gt: new Date() },
    },
    // Set include on the structure being built.
    include: {
      // Set employee on the structure being built.
      employee: true,
      // Set createdBy on the structure being built.
      createdBy: { include: { employee: true } },
    },
    // Set orderBy on the structure being built.
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
  // Branch when this condition holds so the right path runs.
  if (!existing) {
    // Unknown invitation id — distinct from "not revocable".
    throw new AppError(404, "not_found", "Invitation not found");
  }

  // Conditional update — only issued rows can be revoked.
  const revokedAt = new Date();
  // updateMany gives a count without throwing when zero rows match.
  const claimed = await prisma.invitation.updateMany({
    // Set where on the structure being built.
    where: { id, status: InvitationStatus.issued },
    // Set data on the structure being built.
    data: { status: InvitationStatus.revoked, revokedAt },
  });
  // Already consumed/expired/revoked → conflict.
  if (claimed.count === 0) {
    // consumed / expired / already revoked — nothing to revoke.
    throw new AppError(409, "conflict", "Only issued invitations can be revoked");
  }

  // Reload with joins for the API response.
  const updated = await prisma.invitation.findUniqueOrThrow({
    // Set where on the structure being built.
    where: { id },
    // Set include on the structure being built.
    include: {
      // Set employee on the structure being built.
      employee: true,
      // Set createdBy on the structure being built.
      createdBy: { include: { employee: true } },
    },
  });
  // Revoked row mapped to the public invitation DTO.
  return mapInvitation(updated);
}
