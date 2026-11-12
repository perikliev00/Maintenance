/**
 * Personal My Work aggregate (cleaning tasks + open tickets for the caller).
 */
import type { CleaningTaskRow } from "./cleaningApi";
import { apiGet, buildQuery } from "./http";
import type { MaintenanceTicket } from "./maintenanceApi";

export type MyWorkPayload = {
  hotelDate: string;
  rosterShiftId: string | null;
  filterShiftId: string | null;
  tasks: CleaningTaskRow[];
  tickets: MaintenanceTicket[];
  ticketNextCursor?: string | null;
  summary: {
    taskCount: number;
    ticketCount: number;
    runningSessions: number;
  };
};

/** GET /my-work — date/shift-scoped personal queue used by the home screen. */
export async function fetchMyWork(params?: {
  hotelDate?: string;
  shiftId?: string;
  ticketCursor?: string;
  ticketPageSize?: number;
}): Promise<MyWorkPayload> {
  return apiGet(
    `/my-work${buildQuery({
      hotelDate: params?.hotelDate,
      shiftId: params?.shiftId,
      ticketCursor: params?.ticketCursor,
      ticketPageSize: params?.ticketPageSize,
    })}`,
  );
}
