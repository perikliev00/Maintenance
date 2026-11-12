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
    // Require an authenticated session before creating a task.
    requireAuth,
    // Authorize cleaning.create for new task writes.
    requireAction("cleaning.create"),
    // Delegate to the create controller with async error forwarding.
    asyncHandler(tasksController.create),
  );

  // POST /tasks/:id/start — claim/start a cleaning task (opens a session).
  router.post(
    "/tasks/:id/start",
    // Require an authenticated session before starting a task.
    requireAuth,
    // Authorize cleaning.start for claim/start mutations.
    requireAction("cleaning.start"),
    // Delegate to the start controller with async error forwarding.
    asyncHandler(tasksController.start),
  );

  // POST /tasks/:id/inspect — pass/fail inspection after completion.
  router.post(
    "/tasks/:id/inspect",
    // Require an authenticated session before inspecting a task.
    requireAuth,
    // Authorize cleaning.inspect for pass/fail decisions.
    requireAction("cleaning.inspect"),
    // Delegate to the inspect controller with async error forwarding.
    asyncHandler(tasksController.inspect),
  );

  // POST /tasks/:id/reassign — reassign task to another housekeeper.
  router.post(
    "/tasks/:id/reassign",
    // Require an authenticated session before reassigning a task.
    requireAuth,
    // Authorize cleaning.reassign for reassignment mutations.
    requireAction("cleaning.reassign"),
    // Delegate to the reassign controller with async error forwarding.
    asyncHandler(tasksController.reassign),
  );

  // GET /employees/housekeepers — picker list for reassign UI.
  router.get(
    "/employees/housekeepers",
    // Require an authenticated session before listing housekeepers.
    requireAuth,
    // Reassign grant also gates the housekeeper picker list.
    requireAction("cleaning.reassign"),
    // Delegate to the listHousekeepers controller with async error forwarding.
    asyncHandler(tasksController.listHousekeepers),
  );

  // GET /available-housekeepers — real-time availability for reassignment modal.
  router.get(
    "/available-housekeepers",
    // Require an authenticated session before listing availability.
    requireAuth,
    // Reassign grant also gates real-time availability reads.
    requireAction("cleaning.reassign"),
    // Delegate to the listAvailableHousekeepers controller with async error forwarding.
    asyncHandler(tasksController.listAvailableHousekeepers),
  );
}
