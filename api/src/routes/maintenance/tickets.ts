/**
 * Maintenance ticket CRUD-ish workflow. List/create use tickets.report;
 * assign/resolve/close use the corresponding finer actions.
 */
import { Router } from "express";
import { requireAuth, requireAction } from "../../middleware/auth";
import { asyncHandler } from "../../middleware/asyncHandler";
import * as ticketsController from "../../controllers/maintenance/tickets";

/** Register ticket list/create and lifecycle routes on the maintenance router. */
export function registerTicketRoutes(router: Router): void {
  // GET /tickets — list maintenance tickets (scoped).
  router.get(
    "/tickets",
    // Require an authenticated session before listing tickets.
    requireAuth,
    // Authorize tickets.report for ticket list reads.
    requireAction("tickets.report"),
    // Delegate to the list controller with async error forwarding.
    asyncHandler(ticketsController.list),
  );

  // POST /tickets — report/create a new maintenance ticket.
  router.post(
    "/tickets",
    // Require an authenticated session before creating a ticket.
    requireAuth,
    // Authorize tickets.report for ticket creation.
    requireAction("tickets.report"),
    // Delegate to the create controller with async error forwarding.
    asyncHandler(ticketsController.create),
  );

  // GET /tickets/:id/events — ticket event timeline.
  router.get(
    "/tickets/:id/events",
    // Require an authenticated session before reading ticket events.
    requireAuth,
    // Authorize tickets.report for event timeline reads.
    requireAction("tickets.report"),
    // Delegate to the listEvents controller with async error forwarding.
    asyncHandler(ticketsController.listEvents),
  );

  // POST /tickets/:id/assign — assign ticket to a technician.
  router.post(
    "/tickets/:id/assign",
    // Require an authenticated session before assigning a ticket.
    requireAuth,
    // Authorize tickets.assign for assignment mutations.
    requireAction("tickets.assign"),
    // Delegate to the assign controller with async error forwarding.
    asyncHandler(ticketsController.assign),
  );

  // POST /tickets/:id/start — start work on an assigned ticket.
  router.post(
    "/tickets/:id/start",
    // Require an authenticated session before starting ticket work.
    requireAuth,
    // Start uses tickets.resolve (work-in-progress grant).
    requireAction("tickets.resolve"),
    // Delegate to the start controller with async error forwarding.
    asyncHandler(ticketsController.start),
  );

  // POST /tickets/:id/wait — pause SLA / move ticket to waiting.
  router.post(
    "/tickets/:id/wait",
    // Require an authenticated session before pausing a ticket.
    requireAuth,
    // Authorize tickets.resolve for wait/pause mutations.
    requireAction("tickets.resolve"),
    // Delegate to the wait controller with async error forwarding.
    asyncHandler(ticketsController.wait),
  );

  // POST /tickets/:id/resume — resume from waiting.
  router.post(
    "/tickets/:id/resume",
    // Require an authenticated session before resuming a ticket.
    requireAuth,
    // Authorize tickets.resolve for resume mutations.
    requireAction("tickets.resolve"),
    // Delegate to the resume controller with async error forwarding.
    asyncHandler(ticketsController.resume),
  );

  // POST /tickets/:id/resolve — mark ticket resolved.
  router.post(
    "/tickets/:id/resolve",
    // Require an authenticated session before resolving a ticket.
    requireAuth,
    // Authorize tickets.resolve for resolve mutations.
    requireAction("tickets.resolve"),
    // Delegate to the resolve controller with async error forwarding.
    asyncHandler(ticketsController.resolve),
  );

  // POST /tickets/:id/close — close a resolved ticket.
  router.post(
    "/tickets/:id/close",
    // Require an authenticated session before closing a ticket.
    requireAuth,
    // Authorize tickets.close for close mutations.
    requireAction("tickets.close"),
    // Delegate to the close controller with async error forwarding.
    asyncHandler(ticketsController.close),
  );

  // POST /tickets/:id/reopen — reopen a closed/resolved ticket.
  router.post(
    "/tickets/:id/reopen",
    // Require an authenticated session before reopening a ticket.
    requireAuth,
    // Reopen uses tickets.resolve (return to active work).
    requireAction("tickets.resolve"),
    // Delegate to the reopen controller with async error forwarding.
    asyncHandler(ticketsController.reopen),
  );
}
