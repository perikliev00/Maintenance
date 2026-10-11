import type { NextFunction, Request, Response } from "express";
import { IssueOptionKind, Priority } from "@prisma/client";
import { z } from "zod";
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

const kindSchema = z.nativeEnum(IssueOptionKind);

export async function listCategoriesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const includeInactive = req.query.includeInactive === "true";
    const categories = await listCategories({ activeOnly: !includeInactive });
    return res.json(categories);
  } catch (err) {
    return next(err);
  }
}

export async function createCategoryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const schema = z.object({
      key: z.string().min(1).max(32),
      nameBg: z.string().min(1).max(120),
      nameEn: z.string().min(1).max(120),
      sortOrder: z.number().int().optional(),
      isActive: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "validation", details: parsed.error.flatten() });
    }
    const row = await createCategory(parsed.data);
    return res.status(201).json(row);
  } catch (err) {
    return next(err);
  }
}

export async function updateCategoryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const schema = z.object({
      nameBg: z.string().min(1).max(120).optional(),
      nameEn: z.string().min(1).max(120).optional(),
      sortOrder: z.number().int().optional(),
      isActive: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "validation", details: parsed.error.flatten() });
    }
    const row = await updateCategory(req.params.id, parsed.data);
    return res.json(row);
  } catch (err) {
    return next(err);
  }
}

export async function archiveCategoryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const row = await archiveCategory(req.params.id);
    return res.json(row);
  } catch (err) {
    return next(err);
  }
}

export async function listIssueOptionsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const includeInactive = req.query.includeInactive === "true";
    const categoryId =
      typeof req.query.categoryId === "string"
        ? req.query.categoryId
        : undefined;
    const options = await listIssueOptions({
      activeOnly: !includeInactive,
      categoryId,
    });
    return res.json(options);
  } catch (err) {
    return next(err);
  }
}

export async function reorderIssueOptionsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const schema = z.object({ ids: z.array(z.string().min(1)).min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "validation", details: parsed.error.flatten() });
    }
    const rows = await reorderIssueOptions(parsed.data.ids);
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
}

export async function createIssueOptionHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
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
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "validation", details: parsed.error.flatten() });
    }
    const row = await createIssueOption({
      ...parsed.data,
      defaultPriority: parsed.data.defaultPriority as Priority | undefined,
    });
    return res.status(201).json(row);
  } catch (err) {
    return next(err);
  }
}

export async function updateIssueOptionHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
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
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "validation", details: parsed.error.flatten() });
    }
    const row = await updateIssueOption(req.params.id, {
      ...parsed.data,
      defaultPriority: parsed.data.defaultPriority as
        | Priority
        | null
        | undefined,
    });
    return res.json(row);
  } catch (err) {
    return next(err);
  }
}

export async function archiveIssueOptionHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const row = await archiveIssueOption(req.params.id);
    return res.json(row);
  } catch (err) {
    return next(err);
  }
}
