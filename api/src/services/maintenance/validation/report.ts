/**
 * Centralized server-side validation for maintenance report creates.
 */
import { Priority } from "@prisma/client";
import { AppError } from "../../../errors";
import {
  getActiveIssueOption,
  resolveCategorySnapshot,
  snapshotFromCategory,
  type CategorySnapshot,
} from "../../issueCatalog";
import { prisma } from "../../../db";

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
      ? input.description.trim() || null
      : null;

  let priority = input.priority ?? Priority.normal;
  let catalogDefaultPriority: Priority | null = null;
  let catalogDefaultBlocksRoom: boolean | null = null;
  let issueOptionId: string | null = null;
  let categoryId: string | null = null;
  let snapshot: CategorySnapshot;

  if (input.issueOptionId) {
    const option = await getActiveIssueOption(input.issueOptionId);
    issueOptionId = option.id;
    snapshot = snapshotFromCategory(option.maintenanceCategory);
    categoryId = option.maintenanceCategoryId;
    catalogDefaultPriority = option.defaultPriority ?? null;
    catalogDefaultBlocksRoom =
      option.defaultBlocksRoom === null || option.defaultBlocksRoom === undefined
        ? null
        : option.defaultBlocksRoom;
    if (!title) {
      title = option.nameBg;
    }
    if (input.priority === undefined && option.defaultPriority) {
      priority = option.defaultPriority;
    }
  } else {
    snapshot = await resolveCategorySnapshot(input.categoryId!, true);
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

  const blocksRoomExplicit = input.blocksRoom !== undefined;
  let blocksRoom: boolean;
  if (blocksRoomExplicit) {
    blocksRoom = Boolean(input.blocksRoom);
  } else if (catalogDefaultBlocksRoom !== null) {
    blocksRoom = catalogDefaultBlocksRoom;
  } else {
    blocksRoom = false;
  }

  const allowDuplicate = Boolean(input.allowDuplicate);
  const duplicateOverrideReason =
    typeof input.duplicateOverrideReason === "string"
      ? input.duplicateOverrideReason.trim() || null
      : null;
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
