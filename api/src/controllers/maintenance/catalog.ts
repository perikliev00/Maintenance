/** Issue category/option catalog CRUD and reorder (manage vs report on routes). */
import type { NextFunction, Request, Response } from "express";
import { IssueOptionKind, Priority } from "@prisma/client";
import { z } from "zod/v3";
// Continue named import list.
import {
  // Bring archiveCategory into scope from the import.
  archiveCategory,
  // Bring archiveIssueOption into scope from the import.
  archiveIssueOption,
  // Bring createCategory into scope from the import.
  createCategory,
  // Bring createIssueOption into scope from the import.
  createIssueOption,
  // Bring listCategories into scope from the import.
  listCategories,
  // Bring listIssueOptions into scope from the import.
  listIssueOptions,
  // Bring reorderIssueOptions into scope from the import.
  reorderIssueOptions,
  // Bring updateCategory into scope from the import.
  updateCategory,
  // Bring updateIssueOption into scope from the import.
  updateIssueOption,
} from "../../services/issueCatalog";
// Import local module ./shared.
import { prioritySchema } from "./shared";

// Zod field / transform.
const kindSchema = z.nativeEnum(IssueOptionKind);

/** GET /categories — list issue categories (optional includeInactive). */
export async function listCategoriesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
// Continue the controller logic.
) {
  const includeInactive = req.query.includeInactive === "true";
  const categories = await listCategories({ activeOnly: !includeInactive });
  // JSON success response.
  return res.json(categories);
}

/** POST /categories — create an issue category. */
export async function createCategoryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
// Continue the controller logic.
) {
  // Zod schema for request shape.
  const schema = z.object({
    // Validate field key.
    key: z.string().min(1).max(32),
    // Validate field nameBg.
    nameBg: z.string().min(1).max(120),
    // Validate field nameEn.
    nameEn: z.string().min(1).max(120),
    // Validate field sortOrder.
    sortOrder: z.number().int().optional(),
    // Validate field isActive.
    isActive: z.boolean().optional(),
  });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body);
  // Reject invalid request payload.
  if (!parsed.success) {
    return res
      // Set response status code.
      .status(400)
      // Attach JSON body to the response.
      .json({ error: "validation", details: parsed.error.flatten() });
  }
  // Persist or load row.
  const row = await createCategory(parsed.data);
  return res.status(201).json(row);
}

/** PATCH /categories/:id — update category names/sort/active. */
export async function updateCategoryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
// Continue the controller logic.
) {
  // Zod schema for request shape.
  const schema = z.object({
    // Validate field nameBg.
    nameBg: z.string().min(1).max(120).optional(),
    // Validate field nameEn.
    nameEn: z.string().min(1).max(120).optional(),
    // Validate field sortOrder.
    sortOrder: z.number().int().optional(),
    // Validate field isActive.
    isActive: z.boolean().optional(),
  });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body ?? {});
  // Reject invalid request payload.
  if (!parsed.success) {
    return res
      // Set response status code.
      .status(400)
      // Attach JSON body to the response.
      .json({ error: "validation", details: parsed.error.flatten() });
  }
  // Persist or load row.
  const row = await updateCategory(req.params.id, parsed.data);
  // JSON success response.
  return res.json(row);
}

/** POST /categories/:id/archive — soft-archive a category. */
export async function archiveCategoryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
// Continue the controller logic.
) {
  // Persist or load row.
  const row = await archiveCategory(req.params.id);
  // JSON success response.
  return res.json(row);
}

/** GET /issue-options — list options (optional categoryId / includeInactive). */
export async function listIssueOptionsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
// Continue the controller logic.
) {
  const includeInactive = req.query.includeInactive === "true";
  const categoryId =
    // Narrow the runtime type before using the value.
    typeof req.query.categoryId === "string"
      // Continue the conditional expression.
      ? req.query.categoryId
      // Continue the conditional expression.
      : undefined;
  const options = await listIssueOptions({
    activeOnly: !includeInactive,
    categoryId,
  });
  // JSON success response.
  return res.json(options);
}

/** POST /issue-options/reorder — set sort order from an ordered id list. */
export async function reorderIssueOptionsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
// Continue the controller logic.
) {
  // Zod schema for request shape.
  const schema = z.object({ ids: z.array(z.string().min(1)).min(1) });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body);
  // Reject invalid request payload.
  if (!parsed.success) {
    return res
      // Set response status code.
      .status(400)
      // Attach JSON body to the response.
      .json({ error: "validation", details: parsed.error.flatten() });
  }
  const rows = await reorderIssueOptions(parsed.data.ids);
  // JSON success response.
  return res.json(rows);
}

/** POST /issue-options — create an issue option under a category. */
export async function createIssueOptionHandler(
  req: Request,
  res: Response,
  next: NextFunction,
// Continue the controller logic.
) {
  // Zod schema for request shape.
  const schema = z.object({
    // Validate field maintenanceCategoryId.
    maintenanceCategoryId: z.string().min(1),
    kind: kindSchema,
    // Validate field nameBg.
    nameBg: z.string().min(1).max(200),
    // Validate field nameEn.
    nameEn: z.string().min(1).max(200),
    defaultPriority: prioritySchema.optional(),
    // Validate field defaultBlocksRoom.
    defaultBlocksRoom: z.boolean().optional(),
    // Validate field sortOrder.
    sortOrder: z.number().int().optional(),
    // Validate field isActive.
    isActive: z.boolean().optional(),
  });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body);
  // Reject invalid request payload.
  if (!parsed.success) {
    return res
      // Set response status code.
      .status(400)
      // Attach JSON body to the response.
      .json({ error: "validation", details: parsed.error.flatten() });
  }
  // Persist or load row.
  const row = await createIssueOption({
    // Continue the controller logic.
    ...parsed.data,
    defaultPriority: parsed.data.defaultPriority as Priority | undefined,
  });
  return res.status(201).json(row);
}

/** PATCH /issue-options/:id — update an issue option. */
export async function updateIssueOptionHandler(
  req: Request,
  res: Response,
  next: NextFunction,
// Continue the controller logic.
) {
  // Zod schema for request shape.
  const schema = z.object({
    // Validate field maintenanceCategoryId.
    maintenanceCategoryId: z.string().min(1).optional(),
    kind: kindSchema.optional(),
    // Validate field nameBg.
    nameBg: z.string().min(1).max(200).optional(),
    // Validate field nameEn.
    nameEn: z.string().min(1).max(200).optional(),
    defaultPriority: prioritySchema.nullable().optional(),
    // Validate field defaultBlocksRoom.
    defaultBlocksRoom: z.boolean().nullable().optional(),
    // Validate field sortOrder.
    sortOrder: z.number().int().optional(),
    // Validate field isActive.
    isActive: z.boolean().optional(),
  });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body ?? {});
  // Reject invalid request payload.
  if (!parsed.success) {
    return res
      // Set response status code.
      .status(400)
      // Attach JSON body to the response.
      .json({ error: "validation", details: parsed.error.flatten() });
  }
  // Persist or load row.
  const row = await updateIssueOption(req.params.id, {
    // Continue the controller logic.
    ...parsed.data,
    defaultPriority: parsed.data.defaultPriority as
      // Continue the controller logic.
      | Priority
      // Continue the controller logic.
      | null
      // Continue the controller logic.
      | undefined,
  });
  // JSON success response.
  return res.json(row);
}

/** POST /issue-options/:id/archive — soft-archive an issue option. */
export async function archiveIssueOptionHandler(
  req: Request,
  res: Response,
  next: NextFunction,
// Continue the controller logic.
) {
  // Persist or load row.
  const row = await archiveIssueOption(req.params.id);
  // JSON success response.
  return res.json(row);
}
