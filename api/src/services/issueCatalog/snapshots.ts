import { prisma } from "../../db";
import { AppError } from "../../errors";
import type { CategorySnapshot } from "./types";

export async function resolveCategorySnapshot(
  categoryId: string,
  requireActive = true,
): Promise<CategorySnapshot> {
  const category = await prisma.maintenanceCategory.findUnique({
    where: { id: categoryId },
  });
  if (!category) {
    throw new AppError(404, "not_found", "Category not found");
  }
  if (requireActive && !category.isActive) {
    throw new AppError(409, "invalid_state", "Category is not active");
  }
  return {
    maintenanceCategoryId: category.id,
    categoryKey: category.key,
    categoryLabelBg: category.nameBg,
    categoryLabelEn: category.nameEn,
  };
}

export async function getActiveIssueOption(id: string) {
  const option = await prisma.issueOption.findUnique({
    where: { id },
    include: { maintenanceCategory: true },
  });
  if (!option) {
    throw new AppError(404, "not_found", "Issue option not found");
  }
  if (!option.isActive) {
    throw new AppError(409, "invalid_state", "Issue option is not active");
  }
  if (!option.maintenanceCategory.isActive) {
    throw new AppError(409, "invalid_state", "Category is not active");
  }
  return option;
}

export function snapshotFromCategory(category: {
  id: string;
  key: string;
  nameBg: string;
  nameEn: string;
}): CategorySnapshot {
  return {
    maintenanceCategoryId: category.id,
    categoryKey: category.key,
    categoryLabelBg: category.nameBg,
    categoryLabelEn: category.nameEn,
  };
}
