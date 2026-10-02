import { Router } from "express";
import { Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, requireAction } from "../middleware/auth";
import { AppError } from "../services/cleaning";

export const peopleRouter = Router();

function mapPerson(u: {
  id: string;
  employeeId: string;
  email: string;
  role: Role;
  isActive: boolean;
  createdAt: Date;
  employee: {
    fullName: string;
    employeeNumber: string;
    department: string | null;
  };
}) {
  return {
    id: u.id,
    employeeId: u.employeeId,
    fullName: u.employee.fullName,
    employeeNumber: u.employee.employeeNumber,
    email: u.email,
    role: u.role,
    department: u.employee.department,
    isActive: u.isActive,
    createdAt: u.createdAt,
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

      const validRoles = new Set(Object.values(Role));
      const roleFilter =
        roleParam && validRoles.has(roleParam as Role)
          ? (roleParam as Role)
          : undefined;

      const where: Prisma.UserWhereInput = {
        ...(includeInactive ? {} : { isActive: true }),
        ...(roleFilter ? { role: roleFilter } : {}),
        ...(q
          ? {
              OR: [
                { email: { contains: q, mode: "insensitive" } },
                { employee: { fullName: { contains: q, mode: "insensitive" } } },
                {
                  employee: {
                    employeeNumber: { contains: q, mode: "insensitive" },
                  },
                },
              ],
            }
          : {}),
      };

      const users = await prisma.user.findMany({
        where,
        include: { employee: true },
        orderBy: [{ role: "asc" }, { employee: { fullName: "asc" } }],
      });

      return res.json(users.map(mapPerson));
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
        include: { employee: true },
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
        include: { employee: true },
      });

      return res.json(mapPerson(updated));
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
