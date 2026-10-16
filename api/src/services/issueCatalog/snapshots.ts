/**
 * Resolve active catalog rows into frozen snapshots for ticket creation.
 */
import { prisma } from "../../db";
import { AppError } from "../../errors";
import type { CategorySnapshot } from "./types";

/**
 * Load a category and return a {@link CategorySnapshot} (404/409 if missing/inactive).
 * Pass `requireActive=false` for admin paths that may reference inactive categories.
 */
export async function resolveCategorySnapshot(
  categoryId: string,
  requireActive = true,
): Promise<CategorySnapshot> {
  // Load the catalog row by primary key.
  const category = await prisma.maintenanceCategory.findUnique({
    where: { id: categoryId },
  });
  // Missing category → 404 (bad client id / deleted row).
  if (!category) {
    throw new AppError(404, "not_found", "Category not found");
  }
  // Ticket create requires an active category; admin may pass requireActive=false.
  if (requireActive && !category.isActive) {
    throw new AppError(409, "invalid_state", "Category is not active");
  }
  // Freeze labels onto the ticket so later catalog renames do not rewrite history.
  return {
    maintenanceCategoryId: category.id,
    categoryKey: category.key,
    categoryLabelBg: category.nameBg,
    categoryLabelEn: category.nameEn,
  };
}

/**
 * Load an issue option that is active under an active category.
 * Used when creating tickets from a preset option id.
 */
export async function getActiveIssueOption(id: string) {
  // Include parent category so we can enforce the category-active rule.
  const option = await prisma.issueOption.findUnique({
    where: { id },
    include: { maintenanceCategory: true },
  });
  // Missing option → 404.
  if (!option) {
    throw new AppError(404, "not_found", "Issue option not found");
  }
  // Soft-disabled options cannot be used for new tickets.
  if (!option.isActive) {
    throw new AppError(409, "invalid_state", "Issue option is not active");
  }
  // Parent category must also be active for new ticket presets.
  if (!option.maintenanceCategory.isActive) {
    throw new AppError(409, "invalid_state", "Category is not active");
  }
  return option;
}

/**
 * Pure mapper from a category row to {@link CategorySnapshot}.
 * Does not hit the database — used after seed / bulk loads.
 */
export function snapshotFromCategory(category: {
  id: string;
  key: string;
  nameBg: string;
  nameEn: string;
}): CategorySnapshot {
  // Field rename: catalog name* → ticket categoryLabel*.
  return {
    maintenanceCategoryId: category.id,
    categoryKey: category.key,
    categoryLabelBg: category.nameBg,
    categoryLabelEn: category.nameEn,
  };
}
