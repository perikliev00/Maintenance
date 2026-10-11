import { Router } from "express";
import { requireAuth, requireAction } from "../../middleware/auth";
import * as resultsController from "../../controllers/cleaning/results";

export function registerResultsRoutes(router: Router): void {
  router.get(
    "/results",
    requireAuth,
    requireAction("cleaning.results_view"),
    resultsController.get,
  );
}
