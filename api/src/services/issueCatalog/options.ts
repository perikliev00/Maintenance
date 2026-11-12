/**
 * CRUD and reorder for catalog issue options (preset titles/priorities).
 */
import { IssueOptionKind, Priority } from "@prisma/client";
import { prisma } from "../../db";
import { AppError } from "../../errors";

/** List issue options, optionally filtered by category; defaults to active-only. */
export async function listIssueOptions(options?: {
  activeOnly?: boolean;
  categoryId?: string;
}) {
  // Capture active only for use in this scope.
  const activeOnly = options?.activeOnly ?? true;
  // Optional category filter for the catalog editor per-category tab.
  return prisma.issueOption.findMany({
    where: {
      ...(activeOnly ? { isActive: true } : {}),
      ...(options?.categoryId
        // Complete the ternary or optional chain started above.
        ? { maintenanceCategoryId: options.categoryId }
        // Complete the ternary or optional chain started above.
        : {}),
    },
    include: { maintenanceCategory: true },
    orderBy: [{ sortOrder: "asc" }, { nameBg: "asc" }],
  });
}

/** Create an issue option under an existing category. */
export async function createIssueOption(input: {
  maintenanceCategoryId: string;
  kind: IssueOptionKind;
  nameBg: string;
  nameEn: string;
  defaultPriority?: Priority;
  defaultBlocksRoom?: boolean;
  sortOrder?: number;
  isActive?: boolean;
}) {
  // Parent category must exist (does not require isActive here — admin may pre-seed).
  const category = await prisma.maintenanceCategory.findUnique({
    where: { id: input.maintenanceCategoryId },
  });
  if (!category) {
    throw new AppError(404, "not_found", "Category not found");
  }
  // Per-category sortOrder max so new options append at the end by default.
  const maxSort = await prisma.issueOption.aggregate({
    where: { maintenanceCategoryId: input.maintenanceCategoryId },
    _max: { sortOrder: true },
  });
  return prisma.issueOption.create({
    data: {
      maintenanceCategoryId: input.maintenanceCategoryId,
      kind: input.kind,
      nameBg: input.nameBg.trim(),
      nameEn: input.nameEn.trim(),
      defaultPriority: input.defaultPriority ?? null,
      defaultBlocksRoom: input.defaultBlocksRoom ?? null,
      sortOrder: input.sortOrder ?? (maxSort._max.sortOrder ?? -1) + 1,
      isActive: input.isActive ?? true,
    },
    include: { maintenanceCategory: true },
  });
}

/** Update an issue option's labels, defaults, sort, or active flag. */
export async function updateIssueOption(
  id: string,
  input: {
    maintenanceCategoryId?: string;
    kind?: IssueOptionKind;
    nameBg?: string;
    nameEn?: string;
    defaultPriority?: Priority | null;
    defaultBlocksRoom?: boolean | null;
    sortOrder?: number;
    isActive?: boolean;
  },
) {
  const row = await prisma.issueOption.findUnique({ where: { id } });
  if (!row) {
    throw new AppError(404, "not_found", "Issue option not found");
  }
  // Moving to another category requires that target to exist.
  if (input.maintenanceCategoryId) {
    const category = await prisma.maintenanceCategory.findUnique({
      where: { id: input.maintenanceCategoryId },
    });
    if (!category) {
      throw new AppError(404, "not_found", "Category not found");
    }
  }
  // Partial patch of defined fields only.
  return prisma.issueOption.update({
    where: { id },
    data: {
      maintenanceCategoryId: input.maintenanceCategoryId,
      kind: input.kind,
      nameBg: input.nameBg !== undefined ? input.nameBg.trim() : undefined,
      nameEn: input.nameEn !== undefined ? input.nameEn.trim() : undefined,
      defaultPriority: input.defaultPriority,
      defaultBlocksRoom: input.defaultBlocksRoom,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
    },
    include: { maintenanceCategory: true },
  });
}

/** Soft-archive an issue option (isActive=false). */
export async function archiveIssueOption(id: string) {
  // 404 when the option id is unknown.
  const row = await prisma.issueOption.findUnique({ where: { id } });
  if (!row) {
    throw new AppError(404, "not_found", "Issue option not found");
  }
  // Soft-archive keeps historical ticket issueOptionId FKs valid.
  return prisma.issueOption.update({
    where: { id },
    data: { isActive: false },
    include: { maintenanceCategory: true },
  });
}

/** Assign sortOrder from the given id sequence (0..n-1). */
export async function reorderIssueOptions(orderedIds: string[]) {
  if (!orderedIds.length) {
    throw new AppError(400, "validation", "ids must not be empty");
  }
  // Ensure every id exists before writing any sortOrder.
  const rows = await prisma.issueOption.findMany({
    where: { id: { in: orderedIds } },
    select: { id: true },
  });
  if (rows.length !== orderedIds.length) {
    throw new AppError(400, "validation", "Unknown issue option id in list");
  }
  // Atomic reorder: index in the array becomes sortOrder.
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      // Persist or query via Prisma for durable state.
      prisma.issueOption.update({
        where: { id },
        data: { sortOrder: index },
      }),
    ),
  );
  // Return full list including archived for the admin UI.
  return listIssueOptions({ activeOnly: false });
}
