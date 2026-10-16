/** Cleaning session complete/cancel and overdue review listing. */
import { Router } from "express";
import { requireAuth, requireAction } from "../../middleware/auth";
import * as sessionsController from "../../controllers/cleaning/sessions";

/** Register session complete/cancel and review routes on the cleaning router. */
export function registerSessionRoutes(router: Router): void {
  // POST /sessions/:id/complete — housekeeper completes an in-progress session.
  router.post(
    "/sessions/:id/complete",
    requireAuth,
    requireAction("cleaning.complete"),
    sessionsController.complete,
  );

  // POST /sessions/:id/cancel — cancel an overdue/stuck session (review_overdue).
  router.post(
    "/sessions/:id/cancel",
    requireAuth,
    requireAction("cleaning.review_overdue"),
    sessionsController.cancel,
  );

  // GET /sessions/review — list sessions needing overdue review.
  router.get(
    "/sessions/review",
    requireAuth,
    requireAction("cleaning.review_overdue"),
    sessionsController.listReview,
  );
}
