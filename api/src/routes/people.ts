import { Router } from "express";
import { Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, requireAction } from "../middleware/auth";
import { AppError } from "../services/cleaning";
import { revokeAllForUser } from "../services/authSessions";
import { publish } from "../events/bus";

export const peopleRouter = Router();

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
  const onboarded = Boolean(e.user?.activatedAt);
  return {
    id: e.id,
    employeeId: e.id,
    userId: e.user?.id ?? null,
    fullName: e.fullName,
    employeeNumber: e.employeeNumber,
    email: e.user?.email ?? null,
    role: e.user?.role ?? null,
    department: e.department,
    isActive: e.user ? e.user.isActive : true,
    onboarded,
    deviceCount: e._count.devices,
    createdAt: (e.user?.createdAt ?? e.createdAt).toISOString(),
  };
}

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

peopleRouter.get(
  "/",
  requireAuth,
  requireAction("people.view"),
  async (req, res, next) => {
    try {
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const roleParam =
        typeof req.query.role === "string" ? req.query.role.trim() : "";
      const includeInactive = req.query.includeInactive === "true";
      const notOnboarded = req.query.notOnboarded === "true";

      const validRoles = new Set(Object.values(Role));
      const roleFilter =
        roleParam && validRoles.has(roleParam as Role)
          ? (roleParam as Role)
          : undefined;

      const and: Prisma.EmployeeWhereInput[] = [];

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

      if (roleFilter) {
        and.push({ user: { is: { role: roleFilter } } });
      }

      if (!includeInactive) {
        and.push({
          OR: [{ user: null }, { user: { is: { isActive: true } } }],
        });
      }

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

      return res.json(employees.map(mapEmployee));
    } catch (err) {
      return next(err);
    }
  },
);

peopleRouter.patch(
  "/:id/role",
  requireAuth,
  requireAction("people.change_role"),
  async (req, res, next) => {
    try {
      const schema = z.object({
        role: z.nativeEnum(Role),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "validation",
          details: parsed.error.flatten(),
        });
      }

      const actorRole = req.user!.role;
      const nextRole = parsed.data.role;

      const target = await prisma.user.findUnique({
        where: { id: req.params.id },
        include: {
          employee: true,
          _count: { select: { devices: { where: { revokedAt: null } } } },
        },
      });
      if (!target) {
        throw new AppError(404, "not_found", "User not found");
      }

      if (actorRole === Role.manager) {
        if (
          nextRole === Role.owner ||
          nextRole === Role.admin ||
          target.role === Role.owner ||
          target.role === Role.admin
        ) {
          throw new AppError(
            403,
            "forbidden",
            "Managers cannot assign or change owner/admin roles",
          );
        }
      }

      if (target.role === Role.owner && nextRole !== Role.owner) {
        const ownerCount = await prisma.user.count({
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

      const updated = await prisma.user.update({
        where: { id: target.id },
        data: { role: nextRole },
        include: {
          employee: true,
          _count: { select: { devices: { where: { revokedAt: null } } } },
        },
      });

      if (target.role !== nextRole) {
        await revokeAllForUser(target.id);
      }

      publish("people.changed");
      return res.json(mapPersonFromUser(updated));
    } catch (err) {
      return next(err);
    }
  },
);

peopleRouter.use((err: unknown, _req: any, res: any, next: any) => {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: err.code,
      message: err.message,
      details: err.details,
    });
  }
  return next(err);
});
