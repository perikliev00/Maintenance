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
    // Require an authenticated session before reading results.
    requireAuth,
    // Authorize cleaning.results_view for the results report.
    requireAction("cleaning.results_view"),
    // Delegate to the results controller with async error forwarding.
    asyncHandler(resultsController.get),
  );
}
