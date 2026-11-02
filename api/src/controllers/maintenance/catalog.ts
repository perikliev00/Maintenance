/** Issue category/option catalog CRUD and reorder (manage vs report on routes). */
import type { NextFunction, Request, Response } from "express";
import { IssueOptionKind, Priority } from "@prisma/client";
import { z } from "zod/v3";
import {
  archiveCategory,
  archiveIssueOption,
  createCategory,
  createIssueOption,
  listCategories,
  listIssueOptions,
  reorderIssueOptions,
  updateCategory,
  updateIssueOption,
} from "../../services/issueCatalog";
import { prioritySchema } from "./shared";

// Zod field / transform.
const kindSchema = z.nativeEnum(IssueOptionKind);

/** GET /categories — list issue categories (optional includeInactive). */
export async function listCategoriesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
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
) {
  // Zod schema for request shape.
  const schema = z.object({
    key: z.string().min(1).max(32),
    nameBg: z.string().min(1).max(120),
    nameEn: z.string().min(1).max(120),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
  });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body);
  // Reject invalid request payload.
  if (!parsed.success) {
    // Return value / early exit.
    return res
      .status(400)
      .json({ error: "validation", details: parsed.error.flatten() });
  }
  // Persist or load row.
  const row = await createCategory(parsed.data);
  // Return value / early exit.
  return res.status(201).json(row);
}

/** PATCH /categories/:id — update category names/sort/active. */
export async function updateCategoryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // Zod schema for request shape.
  const schema = z.object({
    nameBg: z.string().min(1).max(120).optional(),
    nameEn: z.string().min(1).max(120).optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
  });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body ?? {});
  // Reject invalid request payload.
  if (!parsed.success) {
    // Return value / early exit.
    return res
      .status(400)
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
) {
  const includeInactive = req.query.includeInactive === "true";
  const categoryId =
    typeof req.query.categoryId === "string"
      ? req.query.categoryId
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
) {
  // Zod schema for request shape.
  const schema = z.object({ ids: z.array(z.string().min(1)).min(1) });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body);
  // Reject invalid request payload.
  if (!parsed.success) {
    // Return value / early exit.
    return res
      .status(400)
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
) {
  // Zod schema for request shape.
  const schema = z.object({
    maintenanceCategoryId: z.string().min(1),
    kind: kindSchema,
    nameBg: z.string().min(1).max(200),
    nameEn: z.string().min(1).max(200),
    defaultPriority: prioritySchema.optional(),
    defaultBlocksRoom: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
  });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body);
  // Reject invalid request payload.
  if (!parsed.success) {
    // Return value / early exit.
    return res
      .status(400)
      .json({ error: "validation", details: parsed.error.flatten() });
  }
  // Persist or load row.
  const row = await createIssueOption({
    ...parsed.data,
    defaultPriority: parsed.data.defaultPriority as Priority | undefined,
  });
  // Return value / early exit.
  return res.status(201).json(row);
}

/** PATCH /issue-options/:id — update an issue option. */
export async function updateIssueOptionHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // Zod schema for request shape.
  const schema = z.object({
    maintenanceCategoryId: z.string().min(1).optional(),
    kind: kindSchema.optional(),
    nameBg: z.string().min(1).max(200).optional(),
    nameEn: z.string().min(1).max(200).optional(),
    defaultPriority: prioritySchema.nullable().optional(),
    defaultBlocksRoom: z.boolean().nullable().optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
  });
  // Parse and validate input.
  const parsed = schema.safeParse(req.body ?? {});
  // Reject invalid request payload.
  if (!parsed.success) {
    // Return value / early exit.
    return res
      .status(400)
      .json({ error: "validation", details: parsed.error.flatten() });
  }
  // Persist or load row.
  const row = await updateIssueOption(req.params.id, {
    ...parsed.data,
    defaultPriority: parsed.data.defaultPriority as
      | Priority
      | null
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
) {
  // Persist or load row.
  const row = await archiveIssueOption(req.params.id);
  // JSON success response.
  return res.json(row);
}
