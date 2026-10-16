/**
 * Derives Locations board action gates from role + capability flags.
 * Occupancy is rooms-only (`!isCommon`); owners bypass most capability checks.
 */
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

/** Map AuthUser capabilities onto the Locations page UI gates. */
export function locationPagePermissions(
  user: AuthUser,
  isCommon: boolean,
): LocationPagePermissions {
  // Owners bypass most capability checks on this board.
  const owner = isOwner(user.role);
  return {
    owner,
    // Create task / mark dirty.
    canManage:
      owner ||
      canPerformAction(user, "cleaning.create") ||
      canPerformAction(user, "rooms.mark_dirty"),
    // Start / complete cleaning sessions.
    canWork:
      owner ||
      canPerformAction(user, "cleaning.start") ||
      canPerformAction(user, "cleaning.complete"),
    canInspect: owner || canPerformAction(user, "cleaning.inspect"),
    canReviewOverdue:
      owner || canPerformAction(user, "cleaning.review_overdue"),
    canResolve: owner || canResolveIssues(user.role),
    // Occupancy controls are rooms-only (hidden on common-area board).
    canSetOccupancy:
      !isCommon && (owner || canPerformAction(user, "rooms.set_occupancy")),
    canSetServiceStatus:
      owner || canPerformAction(user, "rooms.set_service_status"),
  };
}
