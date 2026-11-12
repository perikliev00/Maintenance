/**
 * Per-subscriber delivery filter for live SSE events based on DataScope.
 * Injected checks exist so unit tests can stub location/task/ticket access.
 */
// Soft-fail on 403/404 AppErrors without killing the SSE stream.
import { AppError } from "../errors";
// Data-scope asserts that decide whether an entity is visible to the subscriber.
import {
  assertCanAccessLocation,
  assertCanAccessTask,
  assertCanAccessTicket,
  type DataScope,
} from "../services/dataScope";
// Live event payload published on the in-process bus.
import type { LiveEvent } from "./bus";

// Injectable access checks so unit tests can stub without Prisma.
export type LiveAccessChecks = {
  assertCanAccessLocation: typeof assertCanAccessLocation;
  assertCanAccessTask: typeof assertCanAccessTask;
  assertCanAccessTicket: typeof assertCanAccessTicket;
};

/** Production wiring: real dataScope asserts. */
const defaultChecks: LiveAccessChecks = {
  assertCanAccessLocation,
  assertCanAccessTask,
  assertCanAccessTicket,
};

/**
 * Treat 403/404 as "do not deliver"; rethrow unexpected errors.
 * Soft-fail so one forbidden entity does not kill the SSE stream.
 */
async function softAccess(check: () => Promise<void>): Promise<boolean> {
  try {
    await check();
    return true;
  } catch (err) {
    // Out of scope or missing entity → simply skip this event for the subscriber.
    if (err instanceof AppError && (err.status === 403 || err.status === 404)) {
      return false;
    }
    // DB/bugs must surface to the stream error path.
    throw err;
  }
}

/**
 * Whether this live event may be written to a subscriber with the given scope.
 * settings/people are invalidate pings for all authed clients; ops events are scoped.
 */
export async function canDeliverLiveEvent(
  scope: DataScope,
  event: LiveEvent,
  checks: LiveAccessChecks = defaultChecks,
): Promise<boolean> {
  switch (event.type) {
    // Global invalidate pings — any authenticated subscriber may receive them.
    case "settings.changed":
    case "people.changed":
    case "permissions.changed":
    // Job runs are not location-scoped; the Audit jobs panel gates on jobs.view.
    case "jobs.changed":
      return true;

    case "location.changed": {
      // Malformed publish without a location id — never deliver.
      if (!event.locationId) return false;
      // Hotel-wide scope sees every location change.
      if (scope.kind === "all") return true;
      // Sector/assignee scopes must pass location access.
      return softAccess(() =>
        checks.assertCanAccessLocation(scope, event.locationId!),
      );
    }

    case "cleaning.changed": {
      // Hotel-wide: deliver if the event names a task or location.
      if (scope.kind === "all") {
        return Boolean(event.taskId || event.locationId);
      }
      // Prefer task-level access when a task id is present.
      if (event.taskId) {
        return softAccess(() =>
          checks.assertCanAccessTask(scope, event.taskId!),
        );
      }
      // Fall back to location access for location-only cleaning events.
      if (event.locationId) {
        return softAccess(() =>
          checks.assertCanAccessLocation(scope, event.locationId!),
        );
      }
      return false;
    }

    case "ticket.changed": {
      // Hotel-wide: deliver if the event names a ticket or location.
      if (scope.kind === "all") {
        return Boolean(event.ticketId || event.locationId);
      }
      // Prefer ticket-level access when a ticket id is present.
      if (event.ticketId) {
        return softAccess(() =>
          checks.assertCanAccessTicket(scope, event.ticketId!),
        );
      }
      // Fall back to location access for location-only ticket events.
      if (event.locationId) {
        return softAccess(() =>
          checks.assertCanAccessLocation(scope, event.locationId!),
        );
      }
      return false;
    }

    case "notification.changed": {
      // Only the intended recipient's employee id may receive the ping.
      return Boolean(
        event.recipientEmployeeId &&
          event.recipientEmployeeId === scope.employeeId,
      );
    }

    // Unknown future types — fail closed.
    default:
      return false;
  }
}
