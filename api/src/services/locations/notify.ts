import {
  createNotifications,
  recipientsForLocationOps,
} from "../notifications";

export async function notifyLocationOutOfService(input: {
  locationId: string;
  locationNumber: string;
  updatedAt: Date;
  actorEmployeeId?: string;
}) {
  const recipients = await recipientsForLocationOps(
    input.locationId,
    "operations.view_live",
  );
  await createNotifications({
    type: "location.out_of_service",
    title: "Location out of service",
    body: `${input.locationNumber} set out of service`,
    entityType: "location",
    entityId: input.locationId,
    locationId: input.locationId,
    actorEmployeeId: input.actorEmployeeId ?? null,
    recipientEmployeeIds: recipients,
    dedupeKey: `location.out_of_service:${input.locationId}:${input.updatedAt.toISOString()}`,
    payload: {
      panel: "live",
      locationId: input.locationId,
      locationNumber: input.locationNumber,
    },
  });
}
