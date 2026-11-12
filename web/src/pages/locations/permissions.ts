/**
 * Derives Locations board action gates from role + capability flags.
 * Occupancy is rooms-only (`!isCommon`); owners bypass most capability checks.
 * Each action has an independent capability — never OR-combine unrelated ops.
 */
import {
  // Support the surrounding logic for this step.
  canPerformAction,
  // Support the surrounding logic for this step.
  isOwner,
  // Declare type alias AuthUser.
  type AuthUser,
// Support the surrounding logic for this step.
} from "../../api/client";

// Export type definition for consumers of this module.
export type LocationPagePermissions = {
  // Provide owner field used by this structure.
  owner: boolean;
  // Provide canMarkDirty field used by this structure.
  canMarkDirty: boolean;
  // Provide canCreateTask field used by this structure.
  canCreateTask: boolean;
  // Provide canStart field used by this structure.
  canStart: boolean;
  // Provide canComplete field used by this structure.
  canComplete: boolean;
  // Provide canInspect field used by this structure.
  canInspect: boolean;
  // Provide canReassign field used by this structure.
  canReassign: boolean;
  // Provide canReportIssue field used by this structure.
  canReportIssue: boolean;
  // Provide canReviewOverdue field used by this structure.
  canReviewOverdue: boolean;
  // Provide canResolve field used by this structure.
  canResolve: boolean;
  // Provide canSetOccupancy field used by this structure.
  canSetOccupancy: boolean;
  // Provide canSetServiceStatus field used by this structure.
  canSetServiceStatus: boolean;
  /** True when the create-task assignee toolbar should show. */
  canShowAssigneeToolbar: boolean;
};

/** Map AuthUser capabilities onto the Locations page UI gates. */
export function locationPagePermissions(
  // Provide user field used by this structure.
  user: AuthUser,
  // Provide isCommon field used by this structure.
  isCommon: boolean,
// Support the surrounding logic for this step.
): LocationPagePermissions {
  // Bind owner for use in the following logic.
  const owner = isOwner(user.role);
  // Bind canCreateTask for use in the following logic.
  const canCreateTask =
    // Support the surrounding logic for this step.
    owner || canPerformAction(user, "cleaning.create");
  // Bind canMarkDirty for use in the following logic.
  const canMarkDirty =
    // Support the surrounding logic for this step.
    owner || canPerformAction(user, "rooms.mark_dirty");
  // Return early result or rendered output from this path.
  return {
    // Support the surrounding logic for this step.
    owner,
    // Support the surrounding logic for this step.
    canMarkDirty,
    // Support the surrounding logic for this step.
    canCreateTask,
    // Provide canStart field used by this structure.
    canStart: owner || canPerformAction(user, "cleaning.start"),
    // Provide canComplete field used by this structure.
    canComplete: owner || canPerformAction(user, "cleaning.complete"),
    // Provide canInspect field used by this structure.
    canInspect: owner || canPerformAction(user, "cleaning.inspect"),
    // Provide canReassign field used by this structure.
    canReassign: owner || canPerformAction(user, "cleaning.reassign"),
    // Provide canReportIssue field used by this structure.
    canReportIssue: owner || canPerformAction(user, "tickets.report"),
    // Provide canReviewOverdue field used by this structure.
    canReviewOverdue:
      // Support the surrounding logic for this step.
      owner || canPerformAction(user, "cleaning.review_overdue"),
    // Provide canResolve field used by this structure.
    canResolve: owner || canPerformAction(user, "tickets.resolve"),
    // Provide canSetOccupancy field used by this structure.
    canSetOccupancy:
      // Support the surrounding logic for this step.
      !isCommon && (owner || canPerformAction(user, "rooms.set_occupancy")),
    // Provide canSetServiceStatus field used by this structure.
    canSetServiceStatus:
      // Support the surrounding logic for this step.
      owner || canPerformAction(user, "rooms.set_service_status"),
    // Provide canShowAssigneeToolbar field used by this structure.
    canShowAssigneeToolbar: canCreateTask,
  };
}
