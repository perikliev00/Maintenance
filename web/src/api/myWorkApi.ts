/**
 * Personal My Work aggregate (cleaning tasks + open tickets for the caller).
 */
import type { CleaningTaskRow } from "./cleaningApi";
// Import dependency used by this module.
import { apiGet, buildQuery } from "./http";
// Import dependency used by this module.
import type { MaintenanceTicket } from "./maintenanceApi";

// Export type alias for consumers.
export type MyWorkPayload = {
  // Field/property in this shape.
  hotelDate: string;
  // Field/property in this shape.
  rosterShiftId: string | null;
  // Field/property in this shape.
  filterShiftId: string | null;
  // Field/property in this shape.
  tasks: CleaningTaskRow[];
  // Field/property in this shape.
  tickets: MaintenanceTicket[];
  // Field/property in this shape.
  ticketNextCursor?: string | null;
  // Field/property in this shape.
  summary: {
    // Field/property in this shape.
    taskCount: number;
    // Field/property in this shape.
    ticketCount: number;
    // Field/property in this shape.
    runningSessions: number;
  };
};

/** GET /my-work — date/shift-scoped personal queue used by the home screen. */
export async function fetchMyWork(params?: {
  // Field/property in this shape.
  hotelDate?: string;
  // Field/property in this shape.
  shiftId?: string;
  // Field/property in this shape.
  ticketCursor?: string;
  // Field/property in this shape.
  ticketPageSize?: number;
// Open multi-line construct.
}): Promise<MyWorkPayload> {
  // Return computed result to caller.
  return apiGet(
    // Open multi-line construct.
    `/my-work${buildQuery({
      // Field/property in this shape.
      hotelDate: params?.hotelDate,
      // Field/property in this shape.
      shiftId: params?.shiftId,
      // Field/property in this shape.
      ticketCursor: params?.ticketCursor,
      // Field/property in this shape.
      ticketPageSize: params?.ticketPageSize,
    // Continue multi-line list/arguments.
    })}`,
  );
}
