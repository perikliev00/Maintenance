import { prisma } from "../../db";
import { AppError } from "../../errors";

export async function listCategories(options?: { activeOnly?: boolean }) {
  const activeOnly = options?.activeOnly ?? true;
  return prisma.maintenanceCategory.findMany({
    where: activeOnly ? { isActive: true } : undefined,
    orderBy: [{ sortOrder: "asc" }, { key: "asc" }],
  });
}

export async function createCategory(input: {
  key: string;
  nameBg: string;
  nameEn: string;
  sortOrder?: number;
  isActive?: boolean;
}) {
  const key = input.key.trim().toLowerCase().replace(/\s+/g, "_");
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(key)) {
    throw new AppError(
      400,
      "validation",
      "Category key must be lowercase slug (a-z, 0-9, underscore)",
    );
  }
  const existing = await prisma.maintenanceCategory.findUnique({
    where: { key },
  });
  if (existing) {
    throw new AppError(409, "conflict", "Category key already exists");
  }
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

export async function updateCategory(
  id: string,
  input: {
    nameBg?: string;
    nameEn?: string;
    sortOrder?: number;
    isActive?: boolean;
  },
) {
  const row = await prisma.maintenanceCategory.findUnique({ where: { id } });
  if (!row) {
    throw new AppError(404, "not_found", "Category not found");
  }
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

export async function archiveCategory(id: string) {
  const row = await prisma.maintenanceCategory.findUnique({ where: { id } });
  if (!row) {
    throw new AppError(404, "not_found", "Category not found");
  }
  return prisma.maintenanceCategory.update({
    where: { id },
    data: { isActive: false },
  });
}
