/**
 * People directory listing with optional search / role / onboarding filters.
 */
import { Prisma, Role } from "@prisma/client";
import { prisma } from "../../db";
import { decodeBase64UrlJson, encodeBase64UrlJson } from "../cursorCodec";
import { mapPersonDto } from "./status";

/** Opaque people directory cursor: fullName + id (orderBy match). */
export function encodePeopleCursor(row: { fullName: string; id: string }): string {
  return encodeBase64UrlJson({ fullName: row.fullName, id: row.id });
}

/** Decode people cursor; invalid values are ignored (first page). */
export function decodePeopleCursor(
  raw: string | undefined,
): { fullName: string; id: string } | null {
  if (!raw) return null;
  try {
    const parsed = decodeBase64UrlJson(raw) as {
      fullName?: unknown;
      id?: unknown;
    };
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

export type ListPeopleQuery = {
  q?: string;
  role?: string;
  includeInactive?: boolean;
  includeArchived?: boolean;
  notOnboarded?: boolean;
  limit?: number;
  cursor?: string;
};

export type ListPeopleResult =
  | ReturnType<typeof mapPersonDto>[]
  | {
      items: ReturnType<typeof mapPersonDto>[];
      nextCursor: string | null;
    };

/** List employees for the people directory (optionally paginated). */
export async function listPeopleDirectory(
  query: ListPeopleQuery,
): Promise<ListPeopleResult> {
  const q = query.q?.trim() ?? "";
  const roleParam = query.role?.trim() ?? "";
  const includeInactive = query.includeInactive === true;
  const includeArchived = query.includeArchived === true;
  const notOnboarded = query.notOnboarded === true;
  const limitRaw = query.limit;
  const limit =
    limitRaw !== undefined && Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(Math.floor(limitRaw), 100)
      : undefined;
  const cursor = decodePeopleCursor(query.cursor);

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

  if (!includeArchived) {
    and.push({ archivedAt: null });
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
    return employees.map(mapPersonDto);
  }

  const truncated = employees.length > limit;
  const page = truncated ? employees.slice(0, limit) : employees;
  const last = page[page.length - 1];
  return {
    items: page.map(mapPersonDto),
    nextCursor:
      truncated && last
        ? encodePeopleCursor({ fullName: last.fullName, id: last.id })
        : null,
  };
}
