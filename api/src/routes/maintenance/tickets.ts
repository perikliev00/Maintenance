import { Router } from "express";
import { requireAuth, requireAction } from "../../middleware/auth";
import * as ticketsController from "../../controllers/maintenance/tickets";

export function registerTicketRoutes(router: Router): void {
  router.get(
    "/tickets",
    requireAuth,
    requireAction("tickets.report"),
    ticketsController.list,
  );

  router.post(
    "/tickets",
    requireAuth,
    requireAction("tickets.report"),
    ticketsController.create,
  );

  router.get(
    "/tickets/:id/events",
    requireAuth,
    requireAction("tickets.report"),
    ticketsController.listEvents,
  );

  router.post(
    "/tickets/:id/assign",
    requireAuth,
    requireAction("tickets.assign"),
    ticketsController.assign,
  );

  router.post(
    "/tickets/:id/start",
    requireAuth,
    requireAction("tickets.resolve"),
    ticketsController.start,
  );

  router.post(
    "/tickets/:id/wait",
    requireAuth,
    requireAction("tickets.resolve"),
    ticketsController.wait,
  );

  router.post(
    "/tickets/:id/resume",
    requireAuth,
    requireAction("tickets.resolve"),
    ticketsController.resume,
  );

  router.post(
    "/tickets/:id/resolve",
    requireAuth,
    requireAction("tickets.resolve"),
    ticketsController.resolve,
  );

  router.post(
    "/tickets/:id/close",
    requireAuth,
    requireAction("tickets.close"),
    ticketsController.close,
  );

  router.post(
    "/tickets/:id/reopen",
    requireAuth,
    requireAction("tickets.resolve"),
    ticketsController.reopen,
  );
}
