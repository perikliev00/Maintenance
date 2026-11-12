/**
 * Resolve active catalog rows into frozen snapshots for ticket creation.
 */
import { prisma } from "../../db";
// Import module ../../errors for this service.
import { AppError } from "../../errors";
// Import type(s) CategorySnapshot for typing without runtime cost.
import type { CategorySnapshot } from "./types";

/**
 * Load a category and return a {@link CategorySnapshot} (404/409 if missing/inactive).
 * Pass `requireActive=false` for admin paths that may reference inactive categories.
 */
export async function resolveCategorySnapshot(
  // Set categoryId on the structure being built.
  categoryId: string,
  // Update require active as control flow progresses.
  requireActive = true,
// Run next step: ): Promise<CategorySnapshot> {
): Promise<CategorySnapshot> {
  // Load the catalog row by primary key.
  const category = await prisma.maintenanceCategory.findUnique({
    // Set where on the structure being built.
    where: { id: categoryId },
  });
  // Missing category → 404 (bad client id / deleted row).
  if (!category) {
    // Abort with an error so callers can react.
    throw new AppError(404, "not_found", "Category not found");
  }
  // Ticket create requires an active category; admin may pass requireActive=false.
  if (requireActive && !category.isActive) {
    // Abort with an error so callers can react.
    throw new AppError(409, "invalid_state", "Category is not active");
  }
  // Freeze labels onto the ticket so later catalog renames do not rewrite history.
  return {
    // Set maintenanceCategoryId on the structure being built.
    maintenanceCategoryId: category.id,
    // Set categoryKey on the structure being built.
    categoryKey: category.key,
    // Set categoryLabelBg on the structure being built.
    categoryLabelBg: category.nameBg,
    // Set categoryLabelEn on the structure being built.
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
    // Set where on the structure being built.
    where: { id },
    // Set include on the structure being built.
    include: { maintenanceCategory: true },
  });
  // Missing option → 404.
  if (!option) {
    // Abort with an error so callers can react.
    throw new AppError(404, "not_found", "Issue option not found");
  }
  // Soft-disabled options cannot be used for new tickets.
  if (!option.isActive) {
    // Abort with an error so callers can react.
    throw new AppError(409, "invalid_state", "Issue option is not active");
  }
  // Parent category must also be active for new ticket presets.
  if (!option.maintenanceCategory.isActive) {
    // Abort with an error so callers can react.
    throw new AppError(409, "invalid_state", "Category is not active");
  }
  // Return the computed result to the caller.
  return option;
}

/**
 * Pure mapper from a category row to {@link CategorySnapshot}.
 * Does not hit the database — used after seed / bulk loads.
 */
export function snapshotFromCategory(category: {
  // Set id on the structure being built.
  id: string;
  // Set key on the structure being built.
  key: string;
  // Set nameBg on the structure being built.
  nameBg: string;
  // Set nameEn on the structure being built.
  nameEn: string;
// Run next step: }): CategorySnapshot {
}): CategorySnapshot {
  // Field rename: catalog name* → ticket categoryLabel*.
  return {
    // Set maintenanceCategoryId on the structure being built.
    maintenanceCategoryId: category.id,
    // Set categoryKey on the structure being built.
    categoryKey: category.key,
    // Set categoryLabelBg on the structure being built.
    categoryLabelBg: category.nameBg,
    // Set categoryLabelEn on the structure being built.
    categoryLabelEn: category.nameEn,
  };
}
