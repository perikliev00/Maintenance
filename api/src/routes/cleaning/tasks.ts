/** Cleaning task lifecycle (create/start/inspect/reassign) and housekeeper lookup. */
import { Router } from "express";
import { requireAuth, requireAction } from "../../middleware/auth";
import { asyncHandler } from "../../middleware/asyncHandler";
import * as tasksController from "../../controllers/cleaning/tasks";

/** Register task and housekeeper routes on the cleaning router. */
export function registerTaskRoutes(router: Router): void {
  // GET /tasks — list cleaning tasks (rooms.view; scoped in controller).
  router.get("/tasks", requireAuth, requireAction("rooms.view"), asyncHandler(tasksController.list));

  // POST /tasks — create a cleaning task for a location.
  router.post(
    "/tasks",
    requireAuth,
    requireAction("cleaning.create"),
    asyncHandler(tasksController.create),
  );

  // POST /tasks/:id/start — claim/start a cleaning task (opens a session).
  router.post(
    "/tasks/:id/start",
    requireAuth,
    requireAction("cleaning.start"),
    asyncHandler(tasksController.start),
  );

  // POST /tasks/:id/inspect — pass/fail inspection after completion.
  router.post(
    "/tasks/:id/inspect",
    requireAuth,
    requireAction("cleaning.inspect"),
    asyncHandler(tasksController.inspect),
  );

  // POST /tasks/:id/reassign — reassign task to another housekeeper.
  router.post(
    "/tasks/:id/reassign",
    requireAuth,
    requireAction("cleaning.reassign"),
    asyncHandler(tasksController.reassign),
  );

  // GET /employees/housekeepers — picker list for reassign UI.
  router.get(
    "/employees/housekeepers",
    requireAuth,
    requireAction("cleaning.reassign"),
    asyncHandler(tasksController.listHousekeepers),
  );

  // GET /available-housekeepers — real-time availability for reassignment modal.
  router.get(
    "/available-housekeepers",
    requireAuth,
    requireAction("cleaning.reassign"),
    asyncHandler(tasksController.listAvailableHousekeepers),
  );
}
