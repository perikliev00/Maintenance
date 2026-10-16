/**
 * Maintenance ticket CRUD-ish workflow. List/create use tickets.report;
 * assign/resolve/close use the corresponding finer actions.
 */
import { Router } from "express";
import { requireAuth, requireAction } from "../../middleware/auth";
import * as ticketsController from "../../controllers/maintenance/tickets";

/** Register ticket list/create and lifecycle routes on the maintenance router. */
export function registerTicketRoutes(router: Router): void {
  // GET /tickets — list maintenance tickets (scoped).
  router.get(
    "/tickets",
    requireAuth,
    requireAction("tickets.report"),
    ticketsController.list,
  );

  // POST /tickets — report/create a new maintenance ticket.
  router.post(
    "/tickets",
    requireAuth,
    requireAction("tickets.report"),
    ticketsController.create,
  );

  // GET /tickets/:id/events — ticket event timeline.
  router.get(
    "/tickets/:id/events",
    requireAuth,
    requireAction("tickets.report"),
    ticketsController.listEvents,
  );

  // POST /tickets/:id/assign — assign ticket to a technician.
  router.post(
    "/tickets/:id/assign",
    requireAuth,
    requireAction("tickets.assign"),
    ticketsController.assign,
  );

  // POST /tickets/:id/start — start work on an assigned ticket.
  router.post(
    "/tickets/:id/start",
    requireAuth,
    requireAction("tickets.resolve"),
    ticketsController.start,
  );

  // POST /tickets/:id/wait — pause SLA / move ticket to waiting.
  router.post(
    "/tickets/:id/wait",
    requireAuth,
    requireAction("tickets.resolve"),
    ticketsController.wait,
  );

  // POST /tickets/:id/resume — resume from waiting.
  router.post(
    "/tickets/:id/resume",
    requireAuth,
    requireAction("tickets.resolve"),
    ticketsController.resume,
  );

  // POST /tickets/:id/resolve — mark ticket resolved.
  router.post(
    "/tickets/:id/resolve",
    requireAuth,
    requireAction("tickets.resolve"),
    ticketsController.resolve,
  );

  // POST /tickets/:id/close — close a resolved ticket.
  router.post(
    "/tickets/:id/close",
    requireAuth,
    requireAction("tickets.close"),
    ticketsController.close,
  );

  // POST /tickets/:id/reopen — reopen a closed/resolved ticket.
  router.post(
    "/tickets/:id/reopen",
    requireAuth,
    requireAction("tickets.resolve"),
    ticketsController.reopen,
  );
}
