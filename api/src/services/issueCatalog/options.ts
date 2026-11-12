/**
 * CRUD and reorder for catalog issue options (preset titles/priorities).
 */
import { IssueOptionKind, Priority } from "@prisma/client";
// Import module ../../db for this service.
import { prisma } from "../../db";
// Import module ../../errors for this service.
import { AppError } from "../../errors";

/** List issue options, optionally filtered by category; defaults to active-only. */
export async function listIssueOptions(options?: {
  // Run next step: activeOnly?: boolean;
  activeOnly?: boolean;
  // Run next step: categoryId?: string;
  categoryId?: string;
// Run next step: }) {
}) {
  // Capture active only for use in this scope.
  const activeOnly = options?.activeOnly ?? true;
  // Optional category filter for the catalog editor per-category tab.
  return prisma.issueOption.findMany({
    // Set where on the structure being built.
    where: {
      // Run next step: ...(activeOnly ? { isActive: true } : {}),
      ...(activeOnly ? { isActive: true } : {}),
      // Run next step: ...(options?.categoryId
      ...(options?.categoryId
        // Complete the ternary or optional chain started above.
        ? { maintenanceCategoryId: options.categoryId }
        // Complete the ternary or optional chain started above.
        : {}),
    },
    // Set include on the structure being built.
    include: { maintenanceCategory: true },
    // Set orderBy on the structure being built.
    orderBy: [{ sortOrder: "asc" }, { nameBg: "asc" }],
  });
}

/** Create an issue option under an existing category. */
export async function createIssueOption(input: {
  // Set maintenanceCategoryId on the structure being built.
  maintenanceCategoryId: string;
  // Set kind on the structure being built.
  kind: IssueOptionKind;
  // Set nameBg on the structure being built.
  nameBg: string;
  // Set nameEn on the structure being built.
  nameEn: string;
  // Run next step: defaultPriority?: Priority;
  defaultPriority?: Priority;
  // Run next step: defaultBlocksRoom?: boolean;
  defaultBlocksRoom?: boolean;
  // Run next step: sortOrder?: number;
  sortOrder?: number;
  // Run next step: isActive?: boolean;
  isActive?: boolean;
// Run next step: }) {
}) {
  // Parent category must exist (does not require isActive here — admin may pre-seed).
  const category = await prisma.maintenanceCategory.findUnique({
    // Set where on the structure being built.
    where: { id: input.maintenanceCategoryId },
  });
  // Branch when this condition holds so the right path runs.
  if (!category) {
    // Abort with an error so callers can react.
    throw new AppError(404, "not_found", "Category not found");
  }
  // Per-category sortOrder max so new options append at the end by default.
  const maxSort = await prisma.issueOption.aggregate({
    // Set where on the structure being built.
    where: { maintenanceCategoryId: input.maintenanceCategoryId },
    // Set _max on the structure being built.
    _max: { sortOrder: true },
  });
  // Return the computed result to the caller.
  return prisma.issueOption.create({
    // Set data on the structure being built.
    data: {
      // Set maintenanceCategoryId on the structure being built.
      maintenanceCategoryId: input.maintenanceCategoryId,
      // Set kind on the structure being built.
      kind: input.kind,
      // Set nameBg on the structure being built.
      nameBg: input.nameBg.trim(),
      // Set nameEn on the structure being built.
      nameEn: input.nameEn.trim(),
      // Set defaultPriority on the structure being built.
      defaultPriority: input.defaultPriority ?? null,
      // Set defaultBlocksRoom on the structure being built.
      defaultBlocksRoom: input.defaultBlocksRoom ?? null,
      // Set sortOrder on the structure being built.
      sortOrder: input.sortOrder ?? (maxSort._max.sortOrder ?? -1) + 1,
      // Set isActive on the structure being built.
      isActive: input.isActive ?? true,
    },
    // Set include on the structure being built.
    include: { maintenanceCategory: true },
  });
}

/** Update an issue option's labels, defaults, sort, or active flag. */
export async function updateIssueOption(
  // Set id on the structure being built.
  id: string,
  // Set input on the structure being built.
  input: {
    // Run next step: maintenanceCategoryId?: string;
    maintenanceCategoryId?: string;
    // Run next step: kind?: IssueOptionKind;
    kind?: IssueOptionKind;
    // Run next step: nameBg?: string;
    nameBg?: string;
    // Run next step: nameEn?: string;
    nameEn?: string;
    // Run next step: defaultPriority?: Priority | null;
    defaultPriority?: Priority | null;
    // Run next step: defaultBlocksRoom?: boolean | null;
    defaultBlocksRoom?: boolean | null;
    // Run next step: sortOrder?: number;
    sortOrder?: number;
    // Run next step: isActive?: boolean;
    isActive?: boolean;
  },
// Run next step: ) {
) {
  // Load row asynchronously for the next steps.
  const row = await prisma.issueOption.findUnique({ where: { id } });
  // Branch when this condition holds so the right path runs.
  if (!row) {
    // Abort with an error so callers can react.
    throw new AppError(404, "not_found", "Issue option not found");
  }
  // Moving to another category requires that target to exist.
  if (input.maintenanceCategoryId) {
    // Load category asynchronously for the next steps.
    const category = await prisma.maintenanceCategory.findUnique({
      // Set where on the structure being built.
      where: { id: input.maintenanceCategoryId },
    });
    // Branch when this condition holds so the right path runs.
    if (!category) {
      // Abort with an error so callers can react.
      throw new AppError(404, "not_found", "Category not found");
    }
  }
  // Partial patch of defined fields only.
  return prisma.issueOption.update({
    // Set where on the structure being built.
    where: { id },
    // Set data on the structure being built.
    data: {
      // Set maintenanceCategoryId on the structure being built.
      maintenanceCategoryId: input.maintenanceCategoryId,
      // Set kind on the structure being built.
      kind: input.kind,
      // Set nameBg on the structure being built.
      nameBg: input.nameBg !== undefined ? input.nameBg.trim() : undefined,
      // Set nameEn on the structure being built.
      nameEn: input.nameEn !== undefined ? input.nameEn.trim() : undefined,
      // Set defaultPriority on the structure being built.
      defaultPriority: input.defaultPriority,
      // Set defaultBlocksRoom on the structure being built.
      defaultBlocksRoom: input.defaultBlocksRoom,
      // Set sortOrder on the structure being built.
      sortOrder: input.sortOrder,
      // Set isActive on the structure being built.
      isActive: input.isActive,
    },
    // Set include on the structure being built.
    include: { maintenanceCategory: true },
  });
}

/** Soft-archive an issue option (isActive=false). */
export async function archiveIssueOption(id: string) {
  // 404 when the option id is unknown.
  const row = await prisma.issueOption.findUnique({ where: { id } });
  // Branch when this condition holds so the right path runs.
  if (!row) {
    // Abort with an error so callers can react.
    throw new AppError(404, "not_found", "Issue option not found");
  }
  // Soft-archive keeps historical ticket issueOptionId FKs valid.
  return prisma.issueOption.update({
    // Set where on the structure being built.
    where: { id },
    // Set data on the structure being built.
    data: { isActive: false },
    // Set include on the structure being built.
    include: { maintenanceCategory: true },
  });
}

/** Assign sortOrder from the given id sequence (0..n-1). */
export async function reorderIssueOptions(orderedIds: string[]) {
  // Branch when this condition holds so the right path runs.
  if (!orderedIds.length) {
    // Abort with an error so callers can react.
    throw new AppError(400, "validation", "ids must not be empty");
  }
  // Ensure every id exists before writing any sortOrder.
  const rows = await prisma.issueOption.findMany({
    // Set where on the structure being built.
    where: { id: { in: orderedIds } },
    // Set select on the structure being built.
    select: { id: true },
  });
  // Branch when this condition holds so the right path runs.
  if (rows.length !== orderedIds.length) {
    // Abort with an error so callers can react.
    throw new AppError(400, "validation", "Unknown issue option id in list");
  }
  // Atomic reorder: index in the array becomes sortOrder.
  await prisma.$transaction(
    // Run next step: orderedIds.map((id, index) =>
    orderedIds.map((id, index) =>
      // Persist or query via Prisma for durable state.
      prisma.issueOption.update({
        // Set where on the structure being built.
        where: { id },
        // Set data on the structure being built.
        data: { sortOrder: index },
      }),
    ),
  );
  // Return full list including archived for the admin UI.
  return listIssueOptions({ activeOnly: false });
}
