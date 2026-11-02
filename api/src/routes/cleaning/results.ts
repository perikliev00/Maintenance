/** Cleaning results report endpoint (cleaning.results_view). */
import { Router } from "express";
import { requireAuth, requireAction } from "../../middleware/auth";
import { asyncHandler } from "../../middleware/asyncHandler";
import * as resultsController from "../../controllers/cleaning/results";

/** Register GET /results on the cleaning router. */
export function registerResultsRoutes(router: Router): void {
  // GET /results — aggregated cleaning results for the selected period.
  router.get(
    "/results",
    requireAuth,
    requireAction("cleaning.results_view"),
    asyncHandler(resultsController.get),
  );
}
