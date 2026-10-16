/**
 * Issue categories and options. Read paths require tickets.report;
 * mutations require issue_options.manage.
 */
import { Router } from "express";
import { requireAuth, requireAction } from "../../middleware/auth";
import * as catalogController from "../../controllers/maintenance/catalog";

/** Register issue category/option catalog routes on the maintenance router. */
export function registerCatalogRoutes(router: Router): void {
  // GET /categories — list issue categories (for ticket report UI).
  router.get(
    "/categories",
    requireAuth,
    requireAction("tickets.report"),
    catalogController.listCategoriesHandler,
  );

  // POST /categories — create an issue category.
  router.post(
    "/categories",
    requireAuth,
    requireAction("issue_options.manage"),
    catalogController.createCategoryHandler,
  );

  // PATCH /categories/:id — update an issue category.
  router.patch(
    "/categories/:id",
    requireAuth,
    requireAction("issue_options.manage"),
    catalogController.updateCategoryHandler,
  );

  // POST /categories/:id/archive — archive an issue category.
  router.post(
    "/categories/:id/archive",
    requireAuth,
    requireAction("issue_options.manage"),
    catalogController.archiveCategoryHandler,
  );

  // GET /issue-options — list issue options (for ticket report UI).
  router.get(
    "/issue-options",
    requireAuth,
    requireAction("tickets.report"),
    catalogController.listIssueOptionsHandler,
  );

  // POST /issue-options/reorder — reorder issue options within a category.
  router.post(
    "/issue-options/reorder",
    requireAuth,
    requireAction("issue_options.manage"),
    catalogController.reorderIssueOptionsHandler,
  );

  // POST /issue-options — create an issue option.
  router.post(
    "/issue-options",
    requireAuth,
    requireAction("issue_options.manage"),
    catalogController.createIssueOptionHandler,
  );

  // PATCH /issue-options/:id — update an issue option.
  router.patch(
    "/issue-options/:id",
    requireAuth,
    requireAction("issue_options.manage"),
    catalogController.updateIssueOptionHandler,
  );

  // POST /issue-options/:id/archive — archive an issue option.
  router.post(
    "/issue-options/:id/archive",
    requireAuth,
    requireAction("issue_options.manage"),
    catalogController.archiveIssueOptionHandler,
  );
}
