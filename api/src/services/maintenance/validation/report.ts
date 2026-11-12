/**
 * Centralized server-side validation for maintenance report creates.
 */
import { Priority } from "@prisma/client";
import { AppError } from "../../../errors";
import {
  getActiveIssueOption,
  resolveCategorySnapshot,
  snapshotFromCategory,
  // Declare type CategorySnapshot for callers and internals.
  type CategorySnapshot,
} from "../../issueCatalog";
import { prisma } from "../../../db";

// Declare type ValidatedReport for callers and internals.
export type ValidatedReport = {
  locationId: string;
  title: string;
  description: string | null;
  issueOptionId: string | null;
  categoryId: string | null;
  priority: Priority;
  /** True when the client explicitly sent blocksRoom. */
  blocksRoomExplicit: boolean;
  blocksRoom: boolean;
  catalogDefaultPriority: Priority | null;
  catalogDefaultBlocksRoom: boolean | null;
  snapshot: CategorySnapshot;
  allowDuplicate: boolean;
  duplicateOverrideReason: string | null;
  confirmSimilar: boolean;
};

// Declare type ReportValidationInput for callers and internals.
export type ReportValidationInput = {
  locationId: string;
  title?: string;
  description?: string | null;
  issueOptionId?: string;
  categoryId?: string;
  priority?: Priority;
  /** When undefined, catalog default (then false) is applied. */
  blocksRoom?: boolean;
  allowDuplicate?: boolean;
  duplicateOverrideReason?: string | null;
  confirmSimilar?: boolean;
};

/**
 * Validate XOR option/category, location existence, title/description,
 * priority, and duplicate-override fields. Applies catalog defaults for
 * priority/blocksRoom when the client omitted them.
 */
export async function validateMaintenanceReport(
  input: ReportValidationInput,
): Promise<ValidatedReport> {
  if (input.issueOptionId && input.categoryId) {
    throw new AppError(
      400,
      "validation",
      "Provide either issueOptionId or categoryId, not both",
    );
  }
  if (!input.issueOptionId && !input.categoryId) {
    throw new AppError(
      400,
      "validation",
      "issueOptionId or categoryId is required",
    );
  }

  const location = await prisma.location.findUnique({
    where: { id: input.locationId },
    select: { id: true, catalogStatus: true },
  });
  if (!location) {
    throw new AppError(404, "not_found", "Room not found");
  }

  let title = input.title?.trim() ?? "";
  const description =
    typeof input.description === "string"
      // Complete the ternary or optional chain started above.
      ? input.description.trim() || null
      // Complete the ternary or optional chain started above.
      : null;

  let priority = input.priority ?? Priority.normal;
  // Capture catalog default priority for use in this scope.
  let catalogDefaultPriority: Priority | null = null;
  // Capture catalog default blocks room for use in this scope.
  let catalogDefaultBlocksRoom: boolean | null = null;
  // Capture issue option id for use in this scope.
  let issueOptionId: string | null = null;
  // Capture category id for use in this scope.
  let categoryId: string | null = null;
  let snapshot: CategorySnapshot;

  if (input.issueOptionId) {
    const option = await getActiveIssueOption(input.issueOptionId);
    // Update issue option id as control flow progresses.
    issueOptionId = option.id;
    snapshot = snapshotFromCategory(option.maintenanceCategory);
    // Update category id as control flow progresses.
    categoryId = option.maintenanceCategoryId;
    // Update catalog default priority as control flow progresses.
    catalogDefaultPriority = option.defaultPriority ?? null;
    // Update catalog default blocks room as control flow progresses.
    catalogDefaultBlocksRoom =
      option.defaultBlocksRoom === null || option.defaultBlocksRoom === undefined
        // Complete the ternary or optional chain started above.
        ? null
        // Complete the ternary or optional chain started above.
        : option.defaultBlocksRoom;
    if (!title) {
      title = option.nameBg;
    }
    if (input.priority === undefined && option.defaultPriority) {
      priority = option.defaultPriority;
    }
  } else {
    snapshot = await resolveCategorySnapshot(input.categoryId!, true);
    // Update category id as control flow progresses.
    categoryId = snapshot.maintenanceCategoryId;
    if (!title) {
      throw new AppError(400, "validation", "title is required");
    }
  }

  if (!title) {
    throw new AppError(400, "validation", "title is required");
  }

  if (input.priority !== undefined && !(input.priority in Priority)) {
    throw new AppError(400, "validation", "Invalid priority");
  }

  // Capture blocks room explicit for use in this scope.
  const blocksRoomExplicit = input.blocksRoom !== undefined;
  // Capture blocks room for use in this scope.
  let blocksRoom: boolean;
  if (blocksRoomExplicit) {
    // Update blocks room as control flow progresses.
    blocksRoom = Boolean(input.blocksRoom);
  } else if (catalogDefaultBlocksRoom !== null) {
    // Update blocks room as control flow progresses.
    blocksRoom = catalogDefaultBlocksRoom;
  } else {
    // Update blocks room as control flow progresses.
    blocksRoom = false;
  }

  // Capture allow duplicate for use in this scope.
  const allowDuplicate = Boolean(input.allowDuplicate);
  // Capture duplicate override reason for use in this scope.
  const duplicateOverrideReason =
    typeof input.duplicateOverrideReason === "string"
      // Complete the ternary or optional chain started above.
      ? input.duplicateOverrideReason.trim() || null
      // Complete the ternary or optional chain started above.
      : null;
  // Capture confirm similar for use in this scope.
  const confirmSimilar = Boolean(input.confirmSimilar);

  if (allowDuplicate && !duplicateOverrideReason) {
    throw new AppError(
      400,
      "validation",
      "duplicateOverrideReason is required when allowDuplicate is true",
    );
  }

  return {
    locationId: input.locationId,
    title,
    description,
    issueOptionId,
    categoryId,
    priority,
    blocksRoomExplicit,
    blocksRoom,
    catalogDefaultPriority,
    catalogDefaultBlocksRoom,
    snapshot,
    allowDuplicate,
    duplicateOverrideReason,
    confirmSimilar,
  };
}
