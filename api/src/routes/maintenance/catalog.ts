/**
 * Issue categories and options. Read paths require tickets.report;
 * mutations require issue_options.manage.
 */
import { Router } from "express";
import { requireAuth, requireAction } from "../../middleware/auth";
import { asyncHandler } from "../../middleware/asyncHandler";
import * as catalogController from "../../controllers/maintenance/catalog";

/** Register issue category/option catalog routes on the maintenance router. */
export function registerCatalogRoutes(router: Router): void {
  // GET /categories — list issue categories (for ticket report UI).
  router.get(
    "/categories",
    // Require an authenticated session before listing categories.
    requireAuth,
    // Authorize tickets.report for category reads used by report UI.
    requireAction("tickets.report"),
    // Delegate to the listCategories handler with async error forwarding.
    asyncHandler(catalogController.listCategoriesHandler),
  );

  // POST /categories — create an issue category.
  router.post(
    "/categories",
    // Require an authenticated session before creating a category.
    requireAuth,
    // Authorize issue_options.manage for category creation.
    requireAction("issue_options.manage"),
    // Delegate to the createCategory handler with async error forwarding.
    asyncHandler(catalogController.createCategoryHandler),
  );

  // PATCH /categories/:id — update an issue category.
  router.patch(
    "/categories/:id",
    // Require an authenticated session before updating a category.
    requireAuth,
    // Authorize issue_options.manage for category updates.
    requireAction("issue_options.manage"),
    // Delegate to the updateCategory handler with async error forwarding.
    asyncHandler(catalogController.updateCategoryHandler),
  );

  // POST /categories/:id/archive — archive an issue category.
  router.post(
    "/categories/:id/archive",
    // Require an authenticated session before archiving a category.
    requireAuth,
    // Authorize issue_options.manage for category archive.
    requireAction("issue_options.manage"),
    // Delegate to the archiveCategory handler with async error forwarding.
    asyncHandler(catalogController.archiveCategoryHandler),
  );

  // GET /issue-options — list issue options (for ticket report UI).
  router.get(
    "/issue-options",
    // Require an authenticated session before listing issue options.
    requireAuth,
    // Authorize tickets.report for option reads used by report UI.
    requireAction("tickets.report"),
    // Delegate to the listIssueOptions handler with async error forwarding.
    asyncHandler(catalogController.listIssueOptionsHandler),
  );

  // POST /issue-options/reorder — reorder issue options within a category.
  router.post(
    "/issue-options/reorder",
    // Require an authenticated session before reordering options.
    requireAuth,
    // Authorize issue_options.manage for option reorder.
    requireAction("issue_options.manage"),
    // Delegate to the reorderIssueOptions handler with async error forwarding.
    asyncHandler(catalogController.reorderIssueOptionsHandler),
  );

  // POST /issue-options — create an issue option.
  router.post(
    "/issue-options",
    // Require an authenticated session before creating an issue option.
    requireAuth,
    // Authorize issue_options.manage for option creation.
    requireAction("issue_options.manage"),
    // Delegate to the createIssueOption handler with async error forwarding.
    asyncHandler(catalogController.createIssueOptionHandler),
  );

  // PATCH /issue-options/:id — update an issue option.
  router.patch(
    "/issue-options/:id",
    // Require an authenticated session before updating an issue option.
    requireAuth,
    // Authorize issue_options.manage for option updates.
    requireAction("issue_options.manage"),
    // Delegate to the updateIssueOption handler with async error forwarding.
    asyncHandler(catalogController.updateIssueOptionHandler),
  );

  // POST /issue-options/:id/archive — archive an issue option.
  router.post(
    "/issue-options/:id/archive",
    // Require an authenticated session before archiving an issue option.
    requireAuth,
    // Authorize issue_options.manage for option archive.
    requireAction("issue_options.manage"),
    // Delegate to the archiveIssueOption handler with async error forwarding.
    asyncHandler(catalogController.archiveIssueOptionHandler),
  );
}
