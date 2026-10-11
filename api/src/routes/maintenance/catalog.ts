import { Router } from "express";
import { requireAuth, requireAction } from "../../middleware/auth";
import * as catalogController from "../../controllers/maintenance/catalog";

export function registerCatalogRoutes(router: Router): void {
  router.get(
    "/categories",
    requireAuth,
    requireAction("tickets.report"),
    catalogController.listCategoriesHandler,
  );

  router.post(
    "/categories",
    requireAuth,
    requireAction("issue_options.manage"),
    catalogController.createCategoryHandler,
  );

  router.patch(
    "/categories/:id",
    requireAuth,
    requireAction("issue_options.manage"),
    catalogController.updateCategoryHandler,
  );

  router.post(
    "/categories/:id/archive",
    requireAuth,
    requireAction("issue_options.manage"),
    catalogController.archiveCategoryHandler,
  );

  router.get(
    "/issue-options",
    requireAuth,
    requireAction("tickets.report"),
    catalogController.listIssueOptionsHandler,
  );

  router.post(
    "/issue-options/reorder",
    requireAuth,
    requireAction("issue_options.manage"),
    catalogController.reorderIssueOptionsHandler,
  );

  router.post(
    "/issue-options",
    requireAuth,
    requireAction("issue_options.manage"),
    catalogController.createIssueOptionHandler,
  );

  router.patch(
    "/issue-options/:id",
    requireAuth,
    requireAction("issue_options.manage"),
    catalogController.updateIssueOptionHandler,
  );

  router.post(
    "/issue-options/:id/archive",
    requireAuth,
    requireAction("issue_options.manage"),
    catalogController.archiveIssueOptionHandler,
  );
}
