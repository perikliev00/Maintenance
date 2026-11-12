/**
 * Centralized server-side validation for maintenance report creates.
 */
import { Priority } from "@prisma/client";
// Import module ../../../errors for this service.
import { AppError } from "../../../errors";
// Import module dependency for this service.
import {
  // Run next step: getActiveIssueOption,
  getActiveIssueOption,
  // Run next step: resolveCategorySnapshot,
  resolveCategorySnapshot,
  // Run next step: snapshotFromCategory,
  snapshotFromCategory,
  // Declare type CategorySnapshot for callers and internals.
  type CategorySnapshot,
// Run next step: } from "../../issueCatalog";
} from "../../issueCatalog";
// Import module ../../../db for this service.
import { prisma } from "../../../db";

// Declare type ValidatedReport for callers and internals.
export type ValidatedReport = {
  // Set locationId on the structure being built.
  locationId: string;
  // Set title on the structure being built.
  title: string;
  // Set description on the structure being built.
  description: string | null;
  // Set issueOptionId on the structure being built.
  issueOptionId: string | null;
  // Set categoryId on the structure being built.
  categoryId: string | null;
  // Set priority on the structure being built.
  priority: Priority;
  /** True when the client explicitly sent blocksRoom. */
  blocksRoomExplicit: boolean;
  // Set blocksRoom on the structure being built.
  blocksRoom: boolean;
  // Set catalogDefaultPriority on the structure being built.
  catalogDefaultPriority: Priority | null;
  // Set catalogDefaultBlocksRoom on the structure being built.
  catalogDefaultBlocksRoom: boolean | null;
  // Set snapshot on the structure being built.
  snapshot: CategorySnapshot;
  // Set allowDuplicate on the structure being built.
  allowDuplicate: boolean;
  // Set duplicateOverrideReason on the structure being built.
  duplicateOverrideReason: string | null;
  // Set confirmSimilar on the structure being built.
  confirmSimilar: boolean;
};

// Declare type ReportValidationInput for callers and internals.
export type ReportValidationInput = {
  // Set locationId on the structure being built.
  locationId: string;
  // Run next step: title?: string;
  title?: string;
  // Run next step: description?: string | null;
  description?: string | null;
  // Run next step: issueOptionId?: string;
  issueOptionId?: string;
  // Run next step: categoryId?: string;
  categoryId?: string;
  // Run next step: priority?: Priority;
  priority?: Priority;
  /** When undefined, catalog default (then false) is applied. */
  blocksRoom?: boolean;
  // Run next step: allowDuplicate?: boolean;
  allowDuplicate?: boolean;
  // Run next step: duplicateOverrideReason?: string | null;
  duplicateOverrideReason?: string | null;
  // Run next step: confirmSimilar?: boolean;
  confirmSimilar?: boolean;
};

/**
 * Validate XOR option/category, location existence, title/description,
 * priority, and duplicate-override fields. Applies catalog defaults for
 * priority/blocksRoom when the client omitted them.
 */
export async function validateMaintenanceReport(
  // Set input on the structure being built.
  input: ReportValidationInput,
// Run next step: ): Promise<ValidatedReport> {
): Promise<ValidatedReport> {
  // Branch when this condition holds so the right path runs.
  if (input.issueOptionId && input.categoryId) {
    // Abort with an error so callers can react.
    throw new AppError(
      // Run next step: 400,
      400,
      // Run next step: "validation",
      "validation",
      // Run next step: "Provide either issueOptionId or categoryId, not both",
      "Provide either issueOptionId or categoryId, not both",
    );
  }
  // Branch when this condition holds so the right path runs.
  if (!input.issueOptionId && !input.categoryId) {
    // Abort with an error so callers can react.
    throw new AppError(
      // Run next step: 400,
      400,
      // Run next step: "validation",
      "validation",
      // Run next step: "issueOptionId or categoryId is required",
      "issueOptionId or categoryId is required",
    );
  }

  // Load location asynchronously for the next steps.
  const location = await prisma.location.findUnique({
    // Set where on the structure being built.
    where: { id: input.locationId },
    // Set select on the structure being built.
    select: { id: true, catalogStatus: true },
  });
  // Branch when this condition holds so the right path runs.
  if (!location) {
    // Abort with an error so callers can react.
    throw new AppError(404, "not_found", "Room not found");
  }

  // Capture title for use in this scope.
  let title = input.title?.trim() ?? "";
  // Capture description for use in this scope.
  const description =
    // Run next step: typeof input.description === "string"
    typeof input.description === "string"
      // Complete the ternary or optional chain started above.
      ? input.description.trim() || null
      // Complete the ternary or optional chain started above.
      : null;

  // Capture priority for use in this scope.
  let priority = input.priority ?? Priority.normal;
  // Capture catalog default priority for use in this scope.
  let catalogDefaultPriority: Priority | null = null;
  // Capture catalog default blocks room for use in this scope.
  let catalogDefaultBlocksRoom: boolean | null = null;
  // Capture issue option id for use in this scope.
  let issueOptionId: string | null = null;
  // Capture category id for use in this scope.
  let categoryId: string | null = null;
  // Capture snapshot for use in this scope.
  let snapshot: CategorySnapshot;

  // Branch when this condition holds so the right path runs.
  if (input.issueOptionId) {
    // Load option asynchronously for the next steps.
    const option = await getActiveIssueOption(input.issueOptionId);
    // Update issue option id as control flow progresses.
    issueOptionId = option.id;
    // Update snapshot as control flow progresses.
    snapshot = snapshotFromCategory(option.maintenanceCategory);
    // Update category id as control flow progresses.
    categoryId = option.maintenanceCategoryId;
    // Update catalog default priority as control flow progresses.
    catalogDefaultPriority = option.defaultPriority ?? null;
    // Update catalog default blocks room as control flow progresses.
    catalogDefaultBlocksRoom =
      // Run next step: option.defaultBlocksRoom === null || option.defaultBlocksRoo…
      option.defaultBlocksRoom === null || option.defaultBlocksRoom === undefined
        // Complete the ternary or optional chain started above.
        ? null
        // Complete the ternary or optional chain started above.
        : option.defaultBlocksRoom;
    // Branch when this condition holds so the right path runs.
    if (!title) {
      // Update title as control flow progresses.
      title = option.nameBg;
    }
    // Branch when this condition holds so the right path runs.
    if (input.priority === undefined && option.defaultPriority) {
      // Update priority as control flow progresses.
      priority = option.defaultPriority;
    }
  // Run next step: } else {
  } else {
    // Update snapshot as control flow progresses.
    snapshot = await resolveCategorySnapshot(input.categoryId!, true);
    // Update category id as control flow progresses.
    categoryId = snapshot.maintenanceCategoryId;
    // Branch when this condition holds so the right path runs.
    if (!title) {
      // Abort with an error so callers can react.
      throw new AppError(400, "validation", "title is required");
    }
  }

  // Branch when this condition holds so the right path runs.
  if (!title) {
    // Abort with an error so callers can react.
    throw new AppError(400, "validation", "title is required");
  }

  // Branch when this condition holds so the right path runs.
  if (input.priority !== undefined && !(input.priority in Priority)) {
    // Abort with an error so callers can react.
    throw new AppError(400, "validation", "Invalid priority");
  }

  // Capture blocks room explicit for use in this scope.
  const blocksRoomExplicit = input.blocksRoom !== undefined;
  // Capture blocks room for use in this scope.
  let blocksRoom: boolean;
  // Branch when this condition holds so the right path runs.
  if (blocksRoomExplicit) {
    // Update blocks room as control flow progresses.
    blocksRoom = Boolean(input.blocksRoom);
  // Run next step: } else if (catalogDefaultBlocksRoom !== null) {
  } else if (catalogDefaultBlocksRoom !== null) {
    // Update blocks room as control flow progresses.
    blocksRoom = catalogDefaultBlocksRoom;
  // Run next step: } else {
  } else {
    // Update blocks room as control flow progresses.
    blocksRoom = false;
  }

  // Capture allow duplicate for use in this scope.
  const allowDuplicate = Boolean(input.allowDuplicate);
  // Capture duplicate override reason for use in this scope.
  const duplicateOverrideReason =
    // Run next step: typeof input.duplicateOverrideReason === "string"
    typeof input.duplicateOverrideReason === "string"
      // Complete the ternary or optional chain started above.
      ? input.duplicateOverrideReason.trim() || null
      // Complete the ternary or optional chain started above.
      : null;
  // Capture confirm similar for use in this scope.
  const confirmSimilar = Boolean(input.confirmSimilar);

  // Branch when this condition holds so the right path runs.
  if (allowDuplicate && !duplicateOverrideReason) {
    // Abort with an error so callers can react.
    throw new AppError(
      // Run next step: 400,
      400,
      // Run next step: "validation",
      "validation",
      // Run next step: "duplicateOverrideReason is required when allowDuplicate is …
      "duplicateOverrideReason is required when allowDuplicate is true",
    );
  }

  // Return the computed result to the caller.
  return {
    // Set locationId on the structure being built.
    locationId: input.locationId,
    // Run next step: title,
    title,
    // Run next step: description,
    description,
    // Run next step: issueOptionId,
    issueOptionId,
    // Run next step: categoryId,
    categoryId,
    // Run next step: priority,
    priority,
    // Run next step: blocksRoomExplicit,
    blocksRoomExplicit,
    // Run next step: blocksRoom,
    blocksRoom,
    // Run next step: catalogDefaultPriority,
    catalogDefaultPriority,
    // Run next step: catalogDefaultBlocksRoom,
    catalogDefaultBlocksRoom,
    // Run next step: snapshot,
    snapshot,
    // Run next step: allowDuplicate,
    allowDuplicate,
    // Run next step: duplicateOverrideReason,
    duplicateOverrideReason,
    // Run next step: confirmSimilar,
    confirmSimilar,
  };
}
