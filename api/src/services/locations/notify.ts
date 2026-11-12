/**
 * Ops notifications for location status changes (out of service).
 */
import {
  // Run next step: createNotifications,
  createNotifications,
  // Run next step: recipientsForLocationOps,
  recipientsForLocationOps,
// Run next step: } from "../notifications";
} from "../notifications";

/**
 * Notify recipients with operations.view_live for the location's scope.
 * Dedupes on location id + updatedAt so concurrent/retry writes do not spam.
 */
export async function notifyLocationOutOfService(input: {
  // Set locationId on the structure being built.
  locationId: string;
  // Set locationNumber on the structure being built.
  locationNumber: string;
  // Set updatedAt on the structure being built.
  updatedAt: Date;
  // Run next step: actorEmployeeId?: string;
  actorEmployeeId?: string;
// Run next step: }) {
}) {
  // Ops staff with live-panel access for this location's scope.
  const recipients = await recipientsForLocationOps(
    // Run next step: input.locationId,
    input.locationId,
    // Run next step: "operations.view_live",
    "operations.view_live",
  );
  // Dedupe by location + updatedAt so retries do not spam the inbox.
  await createNotifications({
    // Set type on the structure being built.
    type: "location.out_of_service",
    // Set title on the structure being built.
    title: "Location out of service",
    // Set body on the structure being built.
    body: `${input.locationNumber} set out of service`,
    // Set entityType on the structure being built.
    entityType: "location",
    // Set entityId on the structure being built.
    entityId: input.locationId,
    // Set locationId on the structure being built.
    locationId: input.locationId,
    // Actor may be null for system-driven status changes.
    actorEmployeeId: input.actorEmployeeId ?? null,
    // Set recipientEmployeeIds on the structure being built.
    recipientEmployeeIds: recipients,
    // Stable key fragment: same stamp → skipped on replay.
    dedupeKey: `location.out_of_service:${input.locationId}:${input.updatedAt.toISOString()}`,
    // Client routing hints for the Live ops panel.
    payload: {
      // Set panel on the structure being built.
      panel: "live",
      // Set locationId on the structure being built.
      locationId: input.locationId,
      // Set locationNumber on the structure being built.
      locationNumber: input.locationNumber,
    },
  });
}
