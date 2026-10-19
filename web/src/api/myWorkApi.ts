/**
 * Personal My Work aggregate (cleaning tasks + open tickets for the caller).
 */
import type { CleaningTaskRow } from "./cleaningApi";
import { API_BASE, apiFetch, authHeaders, parseJson } from "./http";
import type { MaintenanceTicket } from "./maintenanceApi";

export type MyWorkPayload = {
  hotelDate: string;
  rosterShiftId: string | null;
  filterShiftId: string | null;
  tasks: CleaningTaskRow[];
  tickets: MaintenanceTicket[];
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
}): Promise<MyWorkPayload> {
  const search = new URLSearchParams();
  if (params?.hotelDate) search.set("hotelDate", params.hotelDate);
  if (params?.shiftId) search.set("shiftId", params.shiftId);
  const qs = search.toString();
  const res = await apiFetch(`${API_BASE}/my-work${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}
