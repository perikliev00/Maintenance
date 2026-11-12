/** /people — staff directory, role changes, and access lifecycle. */
import { Router } from "express";
import { requireAuth, requireAction } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import * as peopleController from "../controllers/people";

// Express router for staff directory and access-lifecycle endpoints.
export const peopleRouter = Router();

// GET / — paginated staff directory for the people.view grant.
peopleRouter.get(
  "/",
  // Require an authenticated session before listing people.
  requireAuth,
  // Authorize people.view for directory reads.
  requireAction("people.view"),
  // Delegate to the list controller with async error forwarding.
  asyncHandler(peopleController.list),
);

// GET /:employeeId — single employee profile for the directory detail view.
peopleRouter.get(
  "/:employeeId",
  // Require an authenticated session before reading one employee.
  requireAuth,
  // Authorize people.view for employee detail.
  requireAction("people.view"),
  // Delegate to the getOne controller with async error forwarding.
  asyncHandler(peopleController.getOne),
);

// POST /:employeeId/block — block an employee's login/access.
peopleRouter.post(
  "/:employeeId/block",
  // Require an authenticated session before blocking access.
  requireAuth,
  // Authorize people.manage_access for block mutations.
  requireAction("people.manage_access"),
  // Delegate to the block controller with async error forwarding.
  asyncHandler(peopleController.block),
);

// POST /:employeeId/unblock — restore access for a previously blocked employee.
peopleRouter.post(
  "/:employeeId/unblock",
  // Require an authenticated session before unblocking access.
  requireAuth,
  // Authorize people.manage_access for unblock mutations.
  requireAction("people.manage_access"),
  // Delegate to the unblock controller with async error forwarding.
  asyncHandler(peopleController.unblock),
);

// POST /:employeeId/archive — soft-archive an employee out of active directory.
peopleRouter.post(
  "/:employeeId/archive",
  // Require an authenticated session before archiving an employee.
  requireAuth,
  // Authorize people.manage_access for archive mutations.
  requireAction("people.manage_access"),
  // Delegate to the archive controller with async error forwarding.
  asyncHandler(peopleController.archive),
);

// POST /:employeeId/restore — restore an archived employee to active status.
peopleRouter.post(
  "/:employeeId/restore",
  // Require an authenticated session before restoring an employee.
  requireAuth,
  // Authorize people.manage_access for restore mutations.
  requireAction("people.manage_access"),
  // Delegate to the restore controller with async error forwarding.
  asyncHandler(peopleController.restore),
);

// PATCH /:id/role — :id is User id (legacy ControlPage contract).
peopleRouter.patch(
  "/:id/role",
  // Require an authenticated session before changing roles.
  requireAuth,
  // Authorize people.change_role for role mutations.
  requireAction("people.change_role"),
  // Delegate to the changeRole controller with async error forwarding.
  asyncHandler(peopleController.changeRole),
);
