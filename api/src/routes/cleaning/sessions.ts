/** Cleaning session complete/cancel and overdue review listing. */
import { Router } from "express";
import { requireAuth, requireAction } from "../../middleware/auth";
import { asyncHandler } from "../../middleware/asyncHandler";
import * as sessionsController from "../../controllers/cleaning/sessions";

/** Register session complete/cancel and review routes on the cleaning router. */
export function registerSessionRoutes(router: Router): void {
  // POST /sessions/:id/complete — housekeeper completes an in-progress session.
  router.post(
    "/sessions/:id/complete",
    // Require an authenticated session before completing cleaning work.
    requireAuth,
    // Authorize cleaning.complete for session completion.
    requireAction("cleaning.complete"),
    // Delegate to the complete controller with async error forwarding.
    asyncHandler(sessionsController.complete),
  );

  // POST /sessions/:id/cancel — cancel an overdue/stuck session (review_overdue).
  router.post(
    "/sessions/:id/cancel",
    // Require an authenticated session before canceling a session.
    requireAuth,
    // Authorize cleaning.review_overdue for canceling stuck sessions.
    requireAction("cleaning.review_overdue"),
    // Delegate to the cancel controller with async error forwarding.
    asyncHandler(sessionsController.cancel),
  );

  // GET /sessions/review — list sessions needing overdue review.
  router.get(
    "/sessions/review",
    // Require an authenticated session before listing review candidates.
    requireAuth,
    // Authorize cleaning.review_overdue for the overdue review list.
    requireAction("cleaning.review_overdue"),
    // Delegate to the listReview controller with async error forwarding.
    asyncHandler(sessionsController.listReview),
  );
}
