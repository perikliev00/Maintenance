/**
 * CRUD for maintenance categories (soft-archive via isActive=false).
 */
import { prisma } from "../../db";
// Import module ../../errors for this service.
import { AppError } from "../../errors";

/** List categories ordered by sortOrder; defaults to active-only. */
export async function listCategories(options?: { activeOnly?: boolean }) {
  // Admin catalog UI passes activeOnly=false to show archived rows.
  const activeOnly = options?.activeOnly ?? true;
  // Return the computed result to the caller.
  return prisma.maintenanceCategory.findMany({
    // Set where on the structure being built.
    where: activeOnly ? { isActive: true } : undefined,
    // Set orderBy on the structure being built.
    orderBy: [{ sortOrder: "asc" }, { key: "asc" }],
  });
}

/** Create a category with a unique lowercase slug key. */
export async function createCategory(input: {
  // Set key on the structure being built.
  key: string;
  // Set nameBg on the structure being built.
  nameBg: string;
  // Set nameEn on the structure being built.
  nameEn: string;
  // Run next step: sortOrder?: number;
  sortOrder?: number;
  // Run next step: isActive?: boolean;
  isActive?: boolean;
// Run next step: }) {
}) {
  // Normalize to a lowercase slug used as the stable categoryKey on tickets.
  const key = input.key.trim().toLowerCase().replace(/\s+/g, "_");
  // Branch when this condition holds so the right path runs.
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(key)) {
    // Abort with an error so callers can react.
    throw new AppError(
      // Run next step: 400,
      400,
      // Run next step: "validation",
      "validation",
      // Run next step: "Category key must be lowercase slug (a-z, 0-9, underscore)"…
      "Category key must be lowercase slug (a-z, 0-9, underscore)",
    );
  }
  // Unique key check before insert (Prisma would also throw P2002).
  const existing = await prisma.maintenanceCategory.findUnique({
    // Set where on the structure being built.
    where: { key },
  });
  // Branch when this condition holds so the right path runs.
  if (existing) {
    // Abort with an error so callers can react.
    throw new AppError(409, "conflict", "Category key already exists");
  }
  // Default sortOrder to max+1 when the client omits it.
  const maxSort = await prisma.maintenanceCategory.aggregate({
    // Set _max on the structure being built.
    _max: { sortOrder: true },
  });
  // Return the computed result to the caller.
  return prisma.maintenanceCategory.create({
    // Set data on the structure being built.
    data: {
      // Run next step: key,
      key,
      // Set nameBg on the structure being built.
      nameBg: input.nameBg.trim(),
      // Set nameEn on the structure being built.
      nameEn: input.nameEn.trim(),
      // Set sortOrder on the structure being built.
      sortOrder: input.sortOrder ?? (maxSort._max.sortOrder ?? -1) + 1,
      // Set isActive on the structure being built.
      isActive: input.isActive ?? true,
    },
  });
}

/** Update category labels / sort / active flag (key is immutable after create). */
export async function updateCategory(
  // Set id on the structure being built.
  id: string,
  // Set input on the structure being built.
  input: {
    // Run next step: nameBg?: string;
    nameBg?: string;
    // Run next step: nameEn?: string;
    nameEn?: string;
    // Run next step: sortOrder?: number;
    sortOrder?: number;
    // Run next step: isActive?: boolean;
    isActive?: boolean;
  },
// Run next step: ) {
) {
  // 404 when the category id is unknown.
  const row = await prisma.maintenanceCategory.findUnique({ where: { id } });
  // Branch when this condition holds so the right path runs.
  if (!row) {
    // Abort with an error so callers can react.
    throw new AppError(404, "not_found", "Category not found");
  }
  // Partial patch — only defined fields are written; key never changes.
  return prisma.maintenanceCategory.update({
    // Set where on the structure being built.
    where: { id },
    // Set data on the structure being built.
    data: {
      // Set nameBg on the structure being built.
      nameBg: input.nameBg !== undefined ? input.nameBg.trim() : undefined,
      // Set nameEn on the structure being built.
      nameEn: input.nameEn !== undefined ? input.nameEn.trim() : undefined,
      // Set sortOrder on the structure being built.
      sortOrder: input.sortOrder,
      // Set isActive on the structure being built.
      isActive: input.isActive,
    },
  });
}

/** Soft-archive by setting isActive=false. */
export async function archiveCategory(id: string) {
  // Load row asynchronously for the next steps.
  const row = await prisma.maintenanceCategory.findUnique({ where: { id } });
  // Branch when this condition holds so the right path runs.
  if (!row) {
    // Abort with an error so callers can react.
    throw new AppError(404, "not_found", "Category not found");
  }
  // Soft-archive keeps historical ticket snapshots valid.
  return prisma.maintenanceCategory.update({
    // Set where on the structure being built.
    where: { id },
    // Set data on the structure being built.
    data: { isActive: false },
  });
}
