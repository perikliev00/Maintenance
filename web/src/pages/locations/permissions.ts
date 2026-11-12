/**
 * Derives Locations board action gates from role + capability flags.
 * Occupancy is rooms-only (`!isCommon`); owners bypass most capability checks.
 * Each action has an independent capability — never OR-combine unrelated ops.
 */
import {
  canPerformAction,
  isOwner,
  type AuthUser,
} from "../../api/client";

export type LocationPagePermissions = {
  owner: boolean;
  canMarkDirty: boolean;
  canCreateTask: boolean;
  canStart: boolean;
  canComplete: boolean;
  canInspect: boolean;
  canReassign: boolean;
  canReportIssue: boolean;
  canReviewOverdue: boolean;
  canResolve: boolean;
  canSetOccupancy: boolean;
  canSetServiceStatus: boolean;
  /** True when the create-task assignee toolbar should show. */
  canShowAssigneeToolbar: boolean;
};

/** Map AuthUser capabilities onto the Locations page UI gates. */
export function locationPagePermissions(
  user: AuthUser,
  isCommon: boolean,
): LocationPagePermissions {
  const owner = isOwner(user.role);
  const canCreateTask =
    owner || canPerformAction(user, "cleaning.create");
  const canMarkDirty =
    owner || canPerformAction(user, "rooms.mark_dirty");
  return {
    owner,
    canMarkDirty,
    canCreateTask,
    canStart: owner || canPerformAction(user, "cleaning.start"),
    canComplete: owner || canPerformAction(user, "cleaning.complete"),
    canInspect: owner || canPerformAction(user, "cleaning.inspect"),
    canReassign: owner || canPerformAction(user, "cleaning.reassign"),
    canReportIssue: owner || canPerformAction(user, "tickets.report"),
    canReviewOverdue:
      owner || canPerformAction(user, "cleaning.review_overdue"),
    canResolve: owner || canPerformAction(user, "tickets.resolve"),
    canSetOccupancy:
      !isCommon && (owner || canPerformAction(user, "rooms.set_occupancy")),
    canSetServiceStatus:
      owner || canPerformAction(user, "rooms.set_service_status"),
    canShowAssigneeToolbar: canCreateTask,
  };
}
