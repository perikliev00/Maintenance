import {
  canPerformAction,
  canResolveIssues,
  isOwner,
  type AuthUser,
} from "../../api/client";

export type LocationPagePermissions = {
  owner: boolean;
  canManage: boolean;
  canWork: boolean;
  canInspect: boolean;
  canReviewOverdue: boolean;
  canResolve: boolean;
  canSetOccupancy: boolean;
  canSetServiceStatus: boolean;
};

export function locationPagePermissions(
  user: AuthUser,
  isCommon: boolean,
): LocationPagePermissions {
  const owner = isOwner(user.role);
  return {
    owner,
    canManage:
      owner ||
      canPerformAction(user, "cleaning.create") ||
      canPerformAction(user, "rooms.mark_dirty"),
    canWork:
      owner ||
      canPerformAction(user, "cleaning.start") ||
      canPerformAction(user, "cleaning.complete"),
    canInspect: owner || canPerformAction(user, "cleaning.inspect"),
    canReviewOverdue:
      owner || canPerformAction(user, "cleaning.review_overdue"),
    canResolve: owner || canResolveIssues(user.role),
    canSetOccupancy:
      !isCommon && (owner || canPerformAction(user, "rooms.set_occupancy")),
    canSetServiceStatus:
      owner || canPerformAction(user, "rooms.set_service_status"),
  };
}
