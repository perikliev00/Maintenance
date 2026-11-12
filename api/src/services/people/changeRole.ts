/**
 * Change a user's role with last-owner protection and session revoke.
 */
import { Role } from "@prisma/client";
// Import module ../../db for this service.
import { prisma } from "../../db";
// Import module ../../errors for this service.
import { AppError } from "../../errors";
// Import module ../../events/bus for this service.
import { publish } from "../../events/bus";
// Import module ../../permissions for this service.
import { canChangeUserRole } from "../../permissions";
// Import module ../liveAccessLocks for this service.
import { lockUsersForLiveAccess } from "../liveAccessLocks";
// Import module ./status for this service.
import { mapPersonDto } from "./status";

/**
 * Update role for User id `userId`. Revokes sessions when the role actually changes.
 */
export async function changePersonRole(input: {
  // Set actorRole on the structure being built.
  actorRole: Role;
  // Set userId on the structure being built.
  userId: string;
  // Set nextRole on the structure being built.
  nextRole: Role;
// Run next step: }) {
}) {
  // Destructure value fields needed locally.
  const { actorRole, userId, nextRole } = input;

  // Load updated asynchronously for the next steps.
  const updated = await prisma.$transaction(async (tx) => {
    // Load target asynchronously for the next steps.
    const target = await tx.user.findUnique({
      // Set where on the structure being built.
      where: { id: userId },
      // Set include on the structure being built.
      include: {
        // Set employee on the structure being built.
        employee: true,
        // Set _count on the structure being built.
        _count: { select: { devices: { where: { revokedAt: null } } } },
      },
    });
    // Branch when this condition holds so the right path runs.
    if (!target) {
      // Abort with an error so callers can react.
      throw new AppError(404, "not_found", "User not found");
    }

    // Branch when this condition holds so the right path runs.
    if (target.role === Role.owner && nextRole !== Role.owner) {
      // Wait for the async step before continuing.
      await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "User"
        WHERE role = CAST('owner' AS "Role") AND "isActive" = true
        ORDER BY id
        FOR UPDATE
      `;
      // Load owner count asynchronously for the next steps.
      const ownerCount = await tx.user.count({
        // Set where on the structure being built.
        where: { role: Role.owner, isActive: true },
      });
      // Branch when this condition holds so the right path runs.
      if (ownerCount <= 1) {
        // Abort with an error so callers can react.
        throw new AppError(
          // Run next step: 409,
          409,
          // Run next step: "conflict",
          "conflict",
          // Run next step: "Cannot demote the last active owner",
          "Cannot demote the last active owner",
        );
      }
    // Run next step: } else {
    } else {
      // Wait for the async step before continuing.
      await lockUsersForLiveAccess(tx, [target.id]);
    }

    // Load locked asynchronously for the next steps.
    const locked = await tx.user.findUnique({
      // Set where on the structure being built.
      where: { id: target.id },
      // Set include on the structure being built.
      include: {
        // Set employee on the structure being built.
        employee: true,
        // Set _count on the structure being built.
        _count: { select: { devices: { where: { revokedAt: null } } } },
      },
    });
    // Branch when this condition holds so the right path runs.
    if (!locked) {
      // Abort with an error so callers can react.
      throw new AppError(404, "not_found", "User not found");
    }
    // Branch when this condition holds so the right path runs.
    if (!canChangeUserRole(actorRole, locked.role, nextRole)) {
      // Abort with an error so callers can react.
      throw new AppError(
        // Run next step: 403,
        403,
        // Run next step: "forbidden",
        "forbidden",
        // Run next step: "Cannot assign or change owner/admin roles",
        "Cannot assign or change owner/admin roles",
      );
    }

    // Load row asynchronously for the next steps.
    const row = await tx.user.update({
      // Set where on the structure being built.
      where: { id: locked.id },
      // Set data on the structure being built.
      data: { role: nextRole },
      // Set include on the structure being built.
      include: {
        // Set employee on the structure being built.
        employee: true,
        // Set _count on the structure being built.
        _count: { select: { devices: { where: { revokedAt: null } } } },
      },
    });
    // Branch when this condition holds so the right path runs.
    if (locked.role !== nextRole) {
      // Wait for the async step before continuing.
      await tx.authSession.updateMany({
        // Set where on the structure being built.
        where: { userId: locked.id, revokedAt: null },
        // Set data on the structure being built.
        data: { revokedAt: new Date() },
      });
      // Load bumped asynchronously for the next steps.
      const bumped = await tx.employee.update({
        // Set where on the structure being built.
        where: { id: locked.employeeId },
        // Set data on the structure being built.
        data: { accessVersion: { increment: 1 } },
      });
      // Return the computed result to the caller.
      return {
        // Run next step: ...row,
        ...row,
        // Set employee on the structure being built.
        employee: { ...row.employee, accessVersion: bumped.accessVersion },
      };
    }
    // Return the computed result to the caller.
    return row;
  });

  // Run next step: publish("people.changed");
  publish("people.changed");
  // Return the computed result to the caller.
  return mapPersonDto({
    // Set id on the structure being built.
    id: updated.employeeId,
    // Set fullName on the structure being built.
    fullName: updated.employee.fullName,
    // Set employeeNumber on the structure being built.
    employeeNumber: updated.employee.employeeNumber,
    // Set department on the structure being built.
    department: updated.employee.department,
    // Set archivedAt on the structure being built.
    archivedAt: updated.employee.archivedAt,
    // Set accessVersion on the structure being built.
    accessVersion: updated.employee.accessVersion,
    // Set createdAt on the structure being built.
    createdAt: updated.createdAt,
    // Set user on the structure being built.
    user: {
      // Set id on the structure being built.
      id: updated.id,
      // Set email on the structure being built.
      email: updated.email,
      // Set role on the structure being built.
      role: updated.role,
      // Set isActive on the structure being built.
      isActive: updated.isActive,
      // Set activatedAt on the structure being built.
      activatedAt: updated.activatedAt,
      // Set createdAt on the structure being built.
      createdAt: updated.createdAt,
    },
    // Set _count on the structure being built.
    _count: { devices: updated._count?.devices ?? 0 },
  });
}
