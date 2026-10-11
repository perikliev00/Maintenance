import { Router } from "express";
import { requireAuth, requireAction } from "../../middleware/auth";
import * as sessionsController from "../../controllers/cleaning/sessions";

export function registerSessionRoutes(router: Router): void {
  router.post(
    "/sessions/:id/complete",
    requireAuth,
    requireAction("cleaning.complete"),
    sessionsController.complete,
  );

  router.post(
    "/sessions/:id/cancel",
    requireAuth,
    requireAction("cleaning.review_overdue"),
    sessionsController.cancel,
  );

  router.get(
    "/sessions/review",
    requireAuth,
    requireAction("cleaning.review_overdue"),
    sessionsController.listReview,
  );
}
