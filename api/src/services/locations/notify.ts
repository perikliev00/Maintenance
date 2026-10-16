/**
 * Ops notifications for location status changes (out of service).
 */
import {
  createNotifications,
  recipientsForLocationOps,
} from "../notifications";

/**
 * Notify recipients with operations.view_live for the location's scope.
 * Dedupes on location id + updatedAt so concurrent/retry writes do not spam.
 */
export async function notifyLocationOutOfService(input: {
  locationId: string;
  locationNumber: string;
  updatedAt: Date;
  actorEmployeeId?: string;
}) {
  // Ops staff with live-panel access for this location's scope.
  const recipients = await recipientsForLocationOps(
    input.locationId,
    "operations.view_live",
  );
  // Dedupe by location + updatedAt so retries do not spam the inbox.
  await createNotifications({
    type: "location.out_of_service",
    title: "Location out of service",
    body: `${input.locationNumber} set out of service`,
    entityType: "location",
    entityId: input.locationId,
    locationId: input.locationId,
    // Actor may be null for system-driven status changes.
    actorEmployeeId: input.actorEmployeeId ?? null,
    recipientEmployeeIds: recipients,
    // Stable key fragment: same stamp → skipped on replay.
    dedupeKey: `location.out_of_service:${input.locationId}:${input.updatedAt.toISOString()}`,
    // Client routing hints for the Live ops panel.
    payload: {
      panel: "live",
      locationId: input.locationId,
      locationNumber: input.locationNumber,
    },
  });
}
