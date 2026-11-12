/**
 * Change a user's role with last-owner protection and session revoke.
 */
import { Role } from "@prisma/client";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { publish } from "../../events/bus";
import { canChangeUserRole } from "../../permissions";
import { lockUsersForLiveAccess } from "../liveAccessLocks";
import { mapPersonDto } from "./status";

/**
 * Update role for User id `userId`. Revokes sessions when the role actually changes.
 */
export async function changePersonRole(input: {
  actorRole: Role;
  userId: string;
  nextRole: Role;
}) {
  const { actorRole, userId, nextRole } = input;

  const updated = await prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({
      where: { id: userId },
      include: {
        employee: true,
        _count: { select: { devices: { where: { revokedAt: null } } } },
      },
    });
    if (!target) {
      throw new AppError(404, "not_found", "User not found");
    }

    if (target.role === Role.owner && nextRole !== Role.owner) {
      await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "User"
        WHERE role = CAST('owner' AS "Role") AND "isActive" = true
        ORDER BY id
        FOR UPDATE
      `;
      // Load owner count asynchronously for the next steps.
      const ownerCount = await tx.user.count({
        where: { role: Role.owner, isActive: true },
      });
      if (ownerCount <= 1) {
        throw new AppError(
          409,
          "conflict",
          "Cannot demote the last active owner",
        );
      }
    } else {
      await lockUsersForLiveAccess(tx, [target.id]);
    }

    const locked = await tx.user.findUnique({
      where: { id: target.id },
      include: {
        employee: true,
        _count: { select: { devices: { where: { revokedAt: null } } } },
      },
    });
    if (!locked) {
      throw new AppError(404, "not_found", "User not found");
    }
    if (!canChangeUserRole(actorRole, locked.role, nextRole)) {
      throw new AppError(
        403,
        "forbidden",
        "Cannot assign or change owner/admin roles",
      );
    }

    const row = await tx.user.update({
      where: { id: locked.id },
      data: { role: nextRole },
      include: {
        employee: true,
        _count: { select: { devices: { where: { revokedAt: null } } } },
      },
    });
    if (locked.role !== nextRole) {
      await tx.authSession.updateMany({
        where: { userId: locked.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const bumped = await tx.employee.update({
        where: { id: locked.employeeId },
        data: { accessVersion: { increment: 1 } },
      });
      return {
        ...row,
        employee: { ...row.employee, accessVersion: bumped.accessVersion },
      };
    }
    return row;
  });

  publish("people.changed");
  return mapPersonDto({
    id: updated.employeeId,
    fullName: updated.employee.fullName,
    employeeNumber: updated.employee.employeeNumber,
    department: updated.employee.department,
    archivedAt: updated.employee.archivedAt,
    accessVersion: updated.employee.accessVersion,
    createdAt: updated.createdAt,
    user: {
      id: updated.id,
      email: updated.email,
      role: updated.role,
      isActive: updated.isActive,
      activatedAt: updated.activatedAt,
      createdAt: updated.createdAt,
    },
    _count: { devices: updated._count?.devices ?? 0 },
  });
}
