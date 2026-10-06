import { AppError } from "../errors";
import {
  assertCanAccessLocation,
  assertCanAccessTask,
  assertCanAccessTicket,
  type DataScope,
} from "../services/dataScope";
import type { LiveEvent } from "./bus";

export type LiveAccessChecks = {
  assertCanAccessLocation: typeof assertCanAccessLocation;
  assertCanAccessTask: typeof assertCanAccessTask;
  assertCanAccessTicket: typeof assertCanAccessTicket;
};

const defaultChecks: LiveAccessChecks = {
  assertCanAccessLocation,
  assertCanAccessTask,
  assertCanAccessTicket,
};

async function softAccess(check: () => Promise<void>): Promise<boolean> {
  try {
    await check();
    return true;
  } catch (err) {
    if (err instanceof AppError && (err.status === 403 || err.status === 404)) {
      return false;
    }
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
    case "settings.changed":
    case "people.changed":
      return true;

    case "location.changed": {
      if (!event.locationId) return false;
      if (scope.kind === "all") return true;
      return softAccess(() =>
        checks.assertCanAccessLocation(scope, event.locationId!),
      );
    }

    case "cleaning.changed": {
      if (scope.kind === "all") {
        return Boolean(event.taskId || event.locationId);
      }
      if (event.taskId) {
        return softAccess(() =>
          checks.assertCanAccessTask(scope, event.taskId!),
        );
      }
      if (event.locationId) {
        return softAccess(() =>
          checks.assertCanAccessLocation(scope, event.locationId!),
        );
      }
      return false;
    }

    case "ticket.changed": {
      if (scope.kind === "all") {
        return Boolean(event.ticketId || event.locationId);
      }
      if (event.ticketId) {
        return softAccess(() =>
          checks.assertCanAccessTicket(scope, event.ticketId!),
        );
      }
      if (event.locationId) {
        return softAccess(() =>
          checks.assertCanAccessLocation(scope, event.locationId!),
        );
      }
      return false;
    }

    case "notification.changed": {
      return Boolean(
        event.recipientEmployeeId &&
          event.recipientEmployeeId === scope.employeeId,
      );
    }

    default:
      return false;
  }
}
