/**
 * People directory, role changes, and lifecycle (block/unblock/archive/restore).
 * changeRole enforces assignableRolesFor / canChangeUserRole, blocks demoting
 * the last owner, and revokes sessions on role change.
 */
import type { NextFunction, Request, Response } from "express";
import { Prisma, Role } from "@prisma/client";
import { z } from "zod/v3";
import { prisma } from "../db";
import { canChangeUserRole } from "../permissions";
import { AppError } from "../errors";
import { lockUsersForLiveAccess } from "../services/liveAccessLocks";
import { publish } from "../events/bus";
import {
  archivePerson,
  blockPerson,
  getPerson,
  mapPersonDto,
  restorePerson,
  unblockPerson,
  PERSON_STATUSES,
  type PersonStatus,
} from "../services/people";

/** Opaque people directory cursor: fullName + id (orderBy match). */
function encodePeopleCursor(row: { fullName: string; id: string }): string {
  return Buffer.from(
    JSON.stringify({ fullName: row.fullName, id: row.id }),
    "utf8",
  ).toString("base64url");
}

/** Decode people cursor; invalid values are ignored (first page). */
function decodePeopleCursor(
  raw: string | undefined,
): { fullName: string; id: string } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    ) as { fullName?: unknown; id?: unknown };
    if (
      typeof parsed.fullName === "string" &&
      typeof parsed.id === "string" &&
      parsed.fullName &&
      parsed.id
    ) {
      return { fullName: parsed.fullName, id: parsed.id };
    }
  } catch {
    // Invalid cursor → treat as first page.
  }
  return null;
}

const lifecycleBodySchema = z.object({
  expectedStatus: z.enum(PERSON_STATUSES),
  accessVersion: z.number().int().nonnegative(),
});

function lifecycleActor(req: Request) {
  return {
    userId: req.user!.userId,
    employeeId: req.user!.employeeId,
    role: req.user!.role,
  };
}

/** GET /people — employee directory with optional search/role/onboarding filters. */
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const roleParam =
      typeof req.query.role === "string" ? req.query.role.trim() : "";
    const includeInactive = req.query.includeInactive === "true";
    const includeArchived = req.query.includeArchived === "true";
    const notOnboarded = req.query.notOnboarded === "true";
    const limitRaw =
      typeof req.query.limit === "string"
        ? Number(req.query.limit)
        : undefined;
    const limit =
      limitRaw !== undefined && Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(Math.floor(limitRaw), 100)
        : undefined;
    const cursorRaw =
      typeof req.query.cursor === "string" && req.query.cursor.trim()
        ? req.query.cursor.trim()
        : undefined;
    const cursor = decodePeopleCursor(cursorRaw);

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

    // Default: hide archived employees.
    if (!includeArchived) {
      and.push({ archivedAt: null });
    }

    // Default: hide inactive (blocked) users; placeholders without users still show.
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

    if (cursor && limit !== undefined) {
      and.push({
        OR: [
          { fullName: { gt: cursor.fullName } },
          {
            AND: [
              { fullName: cursor.fullName },
              { id: { gt: cursor.id } },
            ],
          },
        ],
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
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
      ...(limit !== undefined ? { take: limit + 1 } : {}),
    });

    if (limit === undefined) {
      return res.json(employees.map(mapPersonDto));
    }

    const truncated = employees.length > limit;
    const page = truncated ? employees.slice(0, limit) : employees;
    const last = page[page.length - 1];
    return res.json({
      items: page.map(mapPersonDto),
      nextCursor:
        truncated && last
          ? encodePeopleCursor({ fullName: last.fullName, id: last.id })
          : null,
    });
  } catch (err) {
    return next(err);
  }
}

/** GET /people/:employeeId — single person detail. */
export async function getOne(req: Request, res: Response, next: NextFunction) {
  try {
    const person = await getPerson(req.params.employeeId);
    return res.json(person);
  } catch (err) {
    return next(err);
  }
}

/** POST /people/:employeeId/block */
export async function block(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = lifecycleBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "validation",
        details: parsed.error.flatten(),
      });
    }
    const person = await blockPerson(
      lifecycleActor(req),
      req.params.employeeId,
      parsed.data.expectedStatus as PersonStatus,
      parsed.data.accessVersion,
    );
    return res.json(person);
  } catch (err) {
    return next(err);
  }
}

/** POST /people/:employeeId/unblock */
export async function unblock(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = lifecycleBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "validation",
        details: parsed.error.flatten(),
      });
    }
    const person = await unblockPerson(
      lifecycleActor(req),
      req.params.employeeId,
      parsed.data.expectedStatus as PersonStatus,
      parsed.data.accessVersion,
    );
    return res.json(person);
  } catch (err) {
    return next(err);
  }
}

/** POST /people/:employeeId/archive */
export async function archive(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = lifecycleBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "validation",
        details: parsed.error.flatten(),
      });
    }
    const person = await archivePerson(
      lifecycleActor(req),
      req.params.employeeId,
      parsed.data.expectedStatus as PersonStatus,
      parsed.data.accessVersion,
    );
    return res.json(person);
  } catch (err) {
    return next(err);
  }
}

/** POST /people/:employeeId/restore */
export async function restore(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = lifecycleBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "validation",
        details: parsed.error.flatten(),
      });
    }
    const person = await restorePerson(
      lifecycleActor(req),
      req.params.employeeId,
      parsed.data.expectedStatus as PersonStatus,
      parsed.data.accessVersion,
    );
    return res.json(person);
  } catch (err) {
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

    const updated = await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: req.params.id },
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

      // Re-read under lock so concurrent privilege / role races are visible.
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
    return res.json(
      mapPersonDto({
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
      }),
    );
  } catch (err) {
    return next(err);
  }
}
