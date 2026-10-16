/**
 * People directory and role changes. changeRole enforces assignableRolesFor /
 * canChangeUserRole, blocks demoting the last owner, and revokes sessions on role change.
 */
import type { NextFunction, Request, Response } from "express";
import { Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { canChangeUserRole } from "../permissions";
import { AppError } from "../errors";
import { revokeAllForUser } from "../services/authSessions";
import { publish } from "../events/bus";

/** Map Employee (+ optional User) row to the people-directory DTO. */
function mapEmployee(e: {
  id: string;
  fullName: string;
  employeeNumber: string;
  department: string | null;
  createdAt: Date;
  user: {
    id: string;
    email: string;
    role: Role;
    isActive: boolean;
    activatedAt: Date | null;
    createdAt: Date;
  } | null;
  _count: { devices: number };
}) {
  // Onboarded = user exists and has activated on a device.
  const onboarded = Boolean(e.user?.activatedAt);
  // Return value / early exit.
  return {
    id: e.id,
    employeeId: e.id,
    userId: e.user?.id ?? null,
    fullName: e.fullName,
    employeeNumber: e.employeeNumber,
    email: e.user?.email ?? null,
    role: e.user?.role ?? null,
    department: e.department,
    // Employees without a user row are treated as active placeholders.
    isActive: e.user ? e.user.isActive : true,
    onboarded,
    deviceCount: e._count.devices,
    createdAt: (e.user?.createdAt ?? e.createdAt).toISOString(),
  };
}

/** Map User (+ employee) row after a role change to the same DTO shape. */
function mapPersonFromUser(u: {
  id: string;
  employeeId: string;
  email: string;
  role: Role;
  isActive: boolean;
  activatedAt: Date | null;
  createdAt: Date;
  employee: {
    fullName: string;
    employeeNumber: string;
    department: string | null;
  };
  _count?: { devices: number };
}) {
  // Return value / early exit.
  return {
    id: u.employeeId,
    employeeId: u.employeeId,
    userId: u.id,
    fullName: u.employee.fullName,
    employeeNumber: u.employee.employeeNumber,
    email: u.email,
    role: u.role,
    department: u.employee.department,
    isActive: u.isActive,
    onboarded: Boolean(u.activatedAt),
    deviceCount: u._count?.devices ?? 0,
    createdAt: u.createdAt.toISOString(),
  };
}

/** GET /people — employee directory with optional search/role/onboarding filters. */
export async function list(req: Request, res: Response, next: NextFunction) {
  // Try block for fallible work.
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const roleParam =
      typeof req.query.role === "string" ? req.query.role.trim() : "";
    const includeInactive = req.query.includeInactive === "true";
    const notOnboarded = req.query.notOnboarded === "true";

    // Ignore unknown role query strings.
    const validRoles = new Set(Object.values(Role));
    const roleFilter =
      roleParam && validRoles.has(roleParam as Role)
        ? (roleParam as Role)
        : undefined;

    const and: Prisma.EmployeeWhereInput[] = [];

    // Search across name, employee number, and linked user email.
    if (q) {
      and.push({
        OR: [
          { fullName: { contains: q, mode: "insensitive" } },
          { employeeNumber: { contains: q, mode: "insensitive" } },
          {
            user: {
              email: { contains: q, mode: "insensitive" },
            },
          },
        ],
      });
    }

    // Branch: conditional gate.
    if (roleFilter) {
      and.push({ user: { is: { role: roleFilter } } });
    }

    // Default: hide inactive users (employees without users still show).
    if (!includeInactive) {
      and.push({
        OR: [{ user: null }, { user: { is: { isActive: true } } }],
      });
    }

    // Only people who have not activated yet (or have no user).
    if (notOnboarded) {
      and.push({
        OR: [{ user: null }, { user: { is: { activatedAt: null } } }],
      });
    }

    const where: Prisma.EmployeeWhereInput =
      and.length > 0 ? { AND: and } : {};

    const employees = await prisma.employee.findMany({
      where,
      include: {
        user: true,
        _count: {
          select: { devices: { where: { revokedAt: null } } },
        },
      },
      orderBy: [{ fullName: "asc" }],
    });

    // JSON success response.
    return res.json(employees.map(mapEmployee));
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}

/**
 * PATCH body `{ role }`. Param `:id` is the User id (not employee id).
 * Successful role changes invalidate all sessions for that user.
 */
export async function changeRole(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // Try block for fallible work.
  try {
    // Zod schema for request shape.
    const schema = z.object({
      role: z.nativeEnum(Role),
    });
    // Parse and validate input.
    const parsed = schema.safeParse(req.body);
    // Reject invalid request payload.
    if (!parsed.success) {
      // Validation error response.
      return res.status(400).json({
        error: "validation",
        details: parsed.error.flatten(),
      });
    }

    const actorRole = req.user!.role;
    const nextRole = parsed.data.role;

    // :id is User id (route documents this).
    const target = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        employee: true,
        _count: { select: { devices: { where: { revokedAt: null } } } },
      },
    });
    // Branch: conditional gate.
    if (!target) {
      // Throw error path.
      throw new AppError(404, "not_found", "User not found");
    }

    // Policy: non-owners cannot assign/modify privileged roles.
    if (!canChangeUserRole(actorRole, target.role, nextRole)) {
      // Throw error path.
      throw new AppError(
        403,
        "forbidden",
        "Cannot assign or change owner/admin roles",
      );
    }

    // Demote owner under row locks so concurrent demotions cannot leave zero owners.
    const updated = await prisma.$transaction(async (tx) => {
      if (target.role === Role.owner && nextRole !== Role.owner) {
        // Serialize all active-owner demotions against each other.
        await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "User"
          WHERE role = CAST('owner' AS "Role") AND "isActive" = true
          FOR UPDATE
        `;
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
      }

      return tx.user.update({
        where: { id: target.id },
        data: { role: nextRole },
        include: {
          employee: true,
          _count: { select: { devices: { where: { revokedAt: null } } } },
        },
      });
    });

    // Force re-login so JWT/session capabilities match the new role immediately.
    if (target.role !== nextRole) {
      // Await async step.
      await revokeAllForUser(target.id);
    }

    // Invalidate people lists on live clients.
    publish("people.changed");
    // JSON success response.
    return res.json(mapPersonFromUser(updated));
  } catch (err) {
    // Forward error to Express.
    return next(err);
  }
}
