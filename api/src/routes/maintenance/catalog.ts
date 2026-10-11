import { Router } from "express";
import { IssueOptionKind, Priority } from "@prisma/client";
import { z } from "zod";
import { requireAuth, requireAction } from "../../middleware/auth";
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

export function registerCatalogRoutes(router: Router): void {
  router.get(
    "/categories",
    requireAuth,
    requireAction("tickets.report"),
    async (req, res, next) => {
      try {
        const includeInactive = req.query.includeInactive === "true";
        const categories = await listCategories({ activeOnly: !includeInactive });
        return res.json(categories);
      } catch (err) {
        return next(err);
      }
    },
  );

  router.post(
    "/categories",
    requireAuth,
    requireAction("issue_options.manage"),
    async (req, res, next) => {
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
    },
  );

  router.patch(
    "/categories/:id",
    requireAuth,
    requireAction("issue_options.manage"),
    async (req, res, next) => {
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
    },
  );

  router.post(
    "/categories/:id/archive",
    requireAuth,
    requireAction("issue_options.manage"),
    async (req, res, next) => {
      try {
        const row = await archiveCategory(req.params.id);
        return res.json(row);
      } catch (err) {
        return next(err);
      }
    },
  );

  router.get(
    "/issue-options",
    requireAuth,
    requireAction("tickets.report"),
    async (req, res, next) => {
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
    },
  );

  router.post(
    "/issue-options/reorder",
    requireAuth,
    requireAction("issue_options.manage"),
    async (req, res, next) => {
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
    },
  );

  router.post(
    "/issue-options",
    requireAuth,
    requireAction("issue_options.manage"),
    async (req, res, next) => {
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
    },
  );

  router.patch(
    "/issue-options/:id",
    requireAuth,
    requireAction("issue_options.manage"),
    async (req, res, next) => {
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
    },
  );

  router.post(
    "/issue-options/:id/archive",
    requireAuth,
    requireAction("issue_options.manage"),
    async (req, res, next) => {
      try {
        const row = await archiveIssueOption(req.params.id);
        return res.json(row);
      } catch (err) {
        return next(err);
      }
    },
  );
}
