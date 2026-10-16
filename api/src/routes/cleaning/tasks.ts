/** Cleaning task lifecycle (create/start/inspect/reassign) and housekeeper lookup. */
import { Router } from "express";
import { requireAuth, requireAction } from "../../middleware/auth";
import * as tasksController from "../../controllers/cleaning/tasks";

/** Register task and housekeeper routes on the cleaning router. */
export function registerTaskRoutes(router: Router): void {
  // GET /tasks — list cleaning tasks (rooms.view; scoped in controller).
  router.get("/tasks", requireAuth, requireAction("rooms.view"), tasksController.list);

  // POST /tasks — create a cleaning task for a location.
  router.post(
    "/tasks",
    requireAuth,
    requireAction("cleaning.create"),
    tasksController.create,
  );

  // POST /tasks/:id/start — claim/start a cleaning task (opens a session).
  router.post(
    "/tasks/:id/start",
    requireAuth,
    requireAction("cleaning.start"),
    tasksController.start,
  );

  // POST /tasks/:id/inspect — pass/fail inspection after completion.
  router.post(
    "/tasks/:id/inspect",
    requireAuth,
    requireAction("cleaning.inspect"),
    tasksController.inspect,
  );

  // POST /tasks/:id/reassign — reassign task to another housekeeper.
  router.post(
    "/tasks/:id/reassign",
    requireAuth,
    requireAction("cleaning.reassign"),
    tasksController.reassign,
  );

  // GET /employees/housekeepers — picker list for reassign UI.
  router.get(
    "/employees/housekeepers",
    requireAuth,
    requireAction("cleaning.reassign"),
    tasksController.listHousekeepers,
  );
}
