/**
 * CRUD for maintenance categories (soft-archive via isActive=false).
 */
import { prisma } from "../../db";
import { AppError } from "../../errors";

/** List categories ordered by sortOrder; defaults to active-only. */
export async function listCategories(options?: { activeOnly?: boolean }) {
  // Admin catalog UI passes activeOnly=false to show archived rows.
  const activeOnly = options?.activeOnly ?? true;
  return prisma.maintenanceCategory.findMany({
    where: activeOnly ? { isActive: true } : undefined,
    orderBy: [{ sortOrder: "asc" }, { key: "asc" }],
  });
}

/** Create a category with a unique lowercase slug key. */
export async function createCategory(input: {
  key: string;
  nameBg: string;
  nameEn: string;
  sortOrder?: number;
  isActive?: boolean;
}) {
  // Normalize to a lowercase slug used as the stable categoryKey on tickets.
  const key = input.key.trim().toLowerCase().replace(/\s+/g, "_");
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(key)) {
    throw new AppError(
      400,
      "validation",
      "Category key must be lowercase slug (a-z, 0-9, underscore)",
    );
  }
  // Unique key check before insert (Prisma would also throw P2002).
  const existing = await prisma.maintenanceCategory.findUnique({
    where: { key },
  });
  if (existing) {
    throw new AppError(409, "conflict", "Category key already exists");
  }
  // Default sortOrder to max+1 when the client omits it.
  const maxSort = await prisma.maintenanceCategory.aggregate({
    _max: { sortOrder: true },
  });
  return prisma.maintenanceCategory.create({
    data: {
      key,
      nameBg: input.nameBg.trim(),
      nameEn: input.nameEn.trim(),
      sortOrder: input.sortOrder ?? (maxSort._max.sortOrder ?? -1) + 1,
      isActive: input.isActive ?? true,
    },
  });
}

/** Update category labels / sort / active flag (key is immutable after create). */
export async function updateCategory(
  id: string,
  input: {
    nameBg?: string;
    nameEn?: string;
    sortOrder?: number;
    isActive?: boolean;
  },
) {
  // 404 when the category id is unknown.
  const row = await prisma.maintenanceCategory.findUnique({ where: { id } });
  if (!row) {
    throw new AppError(404, "not_found", "Category not found");
  }
  // Partial patch — only defined fields are written; key never changes.
  return prisma.maintenanceCategory.update({
    where: { id },
    data: {
      ...(input.nameBg !== undefined ? { nameBg: input.nameBg.trim() } : {}),
      ...(input.nameEn !== undefined ? { nameEn: input.nameEn.trim() } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
}

/** Soft-archive by setting isActive=false. */
export async function archiveCategory(id: string) {
  const row = await prisma.maintenanceCategory.findUnique({ where: { id } });
  if (!row) {
    throw new AppError(404, "not_found", "Category not found");
  }
  // Soft-archive keeps historical ticket snapshots valid.
  return prisma.maintenanceCategory.update({
    where: { id },
    data: { isActive: false },
  });
}
