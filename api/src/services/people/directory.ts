/**
 * People directory listing with optional search / role / onboarding filters.
 */
import { Prisma, Role } from "@prisma/client";
// Import module ../../db for this service.
import { prisma } from "../../db";
// Import module ../cursorCodec for this service.
import { decodeBase64UrlJson, encodeBase64UrlJson } from "../cursorCodec";
// Import module ./status for this service.
import { mapPersonDto } from "./status";

/** Opaque people directory cursor: fullName + id (orderBy match). */
export function encodePeopleCursor(row: { fullName: string; id: string }): string {
  // Return the computed result to the caller.
  return encodeBase64UrlJson({ fullName: row.fullName, id: row.id });
}

/** Decode people cursor; invalid values are ignored (first page). */
export function decodePeopleCursor(
  // Set raw on the structure being built.
  raw: string | undefined,
// Run next step: ): { fullName: string; id: string } | null {
): { fullName: string; id: string } | null {
  // Branch when this condition holds so the right path runs.
  if (!raw) return null;
  // Attempt the fallible work so errors can be handled below.
  try {
    // Capture parsed for use in this scope.
    const parsed = decodeBase64UrlJson(raw) as {
      // Run next step: fullName?: unknown;
      fullName?: unknown;
      // Run next step: id?: unknown;
      id?: unknown;
    };
    // Branch when this condition holds so the right path runs.
    if (
      // Run next step: typeof parsed.fullName === "string" &&
      typeof parsed.fullName === "string" &&
      // Run next step: typeof parsed.id === "string" &&
      typeof parsed.id === "string" &&
      // Run next step: parsed.fullName &&
      parsed.fullName &&
      // Run next step: parsed.id
      parsed.id
    // Run next step: ) {
    ) {
      // Return the computed result to the caller.
      return { fullName: parsed.fullName, id: parsed.id };
    }
  // Run next step: } catch {
  } catch {
    // Invalid cursor → treat as first page.
  }
  // Return the computed result to the caller.
  return null;
}

// Declare type ListPeopleQuery for callers and internals.
export type ListPeopleQuery = {
  // Run next step: q?: string;
  q?: string;
  // Run next step: role?: string;
  role?: string;
  // Run next step: includeInactive?: boolean;
  includeInactive?: boolean;
  // Run next step: includeArchived?: boolean;
  includeArchived?: boolean;
  // Run next step: notOnboarded?: boolean;
  notOnboarded?: boolean;
  // Run next step: limit?: number;
  limit?: number;
  // Run next step: cursor?: string;
  cursor?: string;
};

// Declare type ListPeopleResult for callers and internals.
export type ListPeopleResult =
  // Run next step: | ReturnType<typeof mapPersonDto>[]
  | ReturnType<typeof mapPersonDto>[]
  // Run next step: | {
  | {
      // Set items on the structure being built.
      items: ReturnType<typeof mapPersonDto>[];
      // Set nextCursor on the structure being built.
      nextCursor: string | null;
    };

/** List employees for the people directory (optionally paginated). */
export async function listPeopleDirectory(
  // Set query on the structure being built.
  query: ListPeopleQuery,
// Run next step: ): Promise<ListPeopleResult> {
): Promise<ListPeopleResult> {
  // Capture q for use in this scope.
  const q = query.q?.trim() ?? "";
  // Capture role param for use in this scope.
  const roleParam = query.role?.trim() ?? "";
  // Capture include inactive for use in this scope.
  const includeInactive = query.includeInactive === true;
  // Capture include archived for use in this scope.
  const includeArchived = query.includeArchived === true;
  // Capture not onboarded for use in this scope.
  const notOnboarded = query.notOnboarded === true;
  // Capture limit raw for use in this scope.
  const limitRaw = query.limit;
  // Capture limit for use in this scope.
  const limit =
    // Run next step: limitRaw !== undefined && Number.isFinite(limitRaw) && limit…
    limitRaw !== undefined && Number.isFinite(limitRaw) && limitRaw > 0
      // Complete the ternary or optional chain started above.
      ? Math.min(Math.floor(limitRaw), 100)
      // Complete the ternary or optional chain started above.
      : undefined;
  // Capture cursor for use in this scope.
  const cursor = decodePeopleCursor(query.cursor);

  // Capture valid roles for use in this scope.
  const validRoles = new Set(Object.values(Role));
  // Capture role filter for use in this scope.
  const roleFilter =
    // Run next step: roleParam && validRoles.has(roleParam as Role)
    roleParam && validRoles.has(roleParam as Role)
      // Complete the ternary or optional chain started above.
      ? (roleParam as Role)
      // Complete the ternary or optional chain started above.
      : undefined;

  // Capture and for use in this scope.
  const and: Prisma.EmployeeWhereInput[] = [];

  // Branch when this condition holds so the right path runs.
  if (q) {
    // Append an entry to the accumulating collection.
    and.push({
      // Set OR on the structure being built.
      OR: [
        // Run next step: { fullName: { contains: q, mode: "insensitive" } },
        { fullName: { contains: q, mode: "insensitive" } },
        // Run next step: { employeeNumber: { contains: q, mode: "insensitive" } },
        { employeeNumber: { contains: q, mode: "insensitive" } },
        // Run next step: {
        {
          // Set user on the structure being built.
          user: {
            // Set email on the structure being built.
            email: { contains: q, mode: "insensitive" },
          },
        },
      ],
    });
  }

  // Branch when this condition holds so the right path runs.
  if (roleFilter) {
    // Append an entry to the accumulating collection.
    and.push({ user: { is: { role: roleFilter } } });
  }

  // Branch when this condition holds so the right path runs.
  if (!includeArchived) {
    // Append an entry to the accumulating collection.
    and.push({ archivedAt: null });
  }

  // Branch when this condition holds so the right path runs.
  if (!includeInactive) {
    // Append an entry to the accumulating collection.
    and.push({
      // Set OR on the structure being built.
      OR: [{ user: null }, { user: { is: { isActive: true } } }],
    });
  }

  // Branch when this condition holds so the right path runs.
  if (notOnboarded) {
    // Append an entry to the accumulating collection.
    and.push({
      // Set OR on the structure being built.
      OR: [{ user: null }, { user: { is: { activatedAt: null } } }],
    });
  }

  // Branch when this condition holds so the right path runs.
  if (cursor && limit !== undefined) {
    // Append an entry to the accumulating collection.
    and.push({
      // Set OR on the structure being built.
      OR: [
        // Run next step: { fullName: { gt: cursor.fullName } },
        { fullName: { gt: cursor.fullName } },
        // Run next step: {
        {
          // Set AND on the structure being built.
          AND: [
            // Run next step: { fullName: cursor.fullName },
            { fullName: cursor.fullName },
            // Run next step: { id: { gt: cursor.id } },
            { id: { gt: cursor.id } },
          ],
        },
      ],
    });
  }

  // Capture where for use in this scope.
  const where: Prisma.EmployeeWhereInput =
    // Run next step: and.length > 0 ? { AND: and } : {};
    and.length > 0 ? { AND: and } : {};

  // Load employees asynchronously for the next steps.
  const employees = await prisma.employee.findMany({
    // Run next step: where,
    where,
    // Set include on the structure being built.
    include: {
      // Set user on the structure being built.
      user: true,
      // Set _count on the structure being built.
      _count: {
        // Set select on the structure being built.
        select: { devices: { where: { revokedAt: null } } },
      },
    },
    // Set orderBy on the structure being built.
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
    // Run next step: ...(limit !== undefined ? { take: limit + 1 } : {}),
    ...(limit !== undefined ? { take: limit + 1 } : {}),
  });

  // Branch when this condition holds so the right path runs.
  if (limit === undefined) {
    // Return the computed result to the caller.
    return employees.map(mapPersonDto);
  }

  // Capture truncated for use in this scope.
  const truncated = employees.length > limit;
  // Capture page for use in this scope.
  const page = truncated ? employees.slice(0, limit) : employees;
  // Capture last for use in this scope.
  const last = page[page.length - 1];
  // Return the computed result to the caller.
  return {
    // Set items on the structure being built.
    items: page.map(mapPersonDto),
    // Set nextCursor on the structure being built.
    nextCursor:
      // Run next step: truncated && last
      truncated && last
        // Complete the ternary or optional chain started above.
        ? encodePeopleCursor({ fullName: last.fullName, id: last.id })
        // Complete the ternary or optional chain started above.
        : null,
  };
}
