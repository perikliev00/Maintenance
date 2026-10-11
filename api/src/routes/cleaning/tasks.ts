import { Router } from "express";
import { requireAuth, requireAction } from "../../middleware/auth";
import * as tasksController from "../../controllers/cleaning/tasks";

export function registerTaskRoutes(router: Router): void {
  router.get("/tasks", requireAuth, requireAction("rooms.view"), tasksController.list);

  router.post(
    "/tasks",
    requireAuth,
    requireAction("cleaning.create"),
    tasksController.create,
  );

  router.post(
    "/tasks/:id/start",
    requireAuth,
    requireAction("cleaning.start"),
    tasksController.start,
  );

  router.post(
    "/tasks/:id/inspect",
    requireAuth,
    requireAction("cleaning.inspect"),
    tasksController.inspect,
  );

  router.post(
    "/tasks/:id/reassign",
    requireAuth,
    requireAction("cleaning.reassign"),
    tasksController.reassign,
  );

  router.get(
    "/employees/housekeepers",
    requireAuth,
    requireAction("cleaning.reassign"),
    tasksController.listHousekeepers,
  );
}
