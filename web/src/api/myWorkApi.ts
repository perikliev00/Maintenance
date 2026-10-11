import type { CleaningTaskRow } from "./cleaningApi";
import { API_BASE, apiFetch, authHeaders, parseJson } from "./http";
import type { MaintenanceTicket } from "./maintenanceApi";

export async function fetchMyWork(hotelDate?: string, shiftId?: string) {
  const search = new URLSearchParams();
  if (hotelDate) search.set("hotelDate", hotelDate);
  if (shiftId) search.set("shiftId", shiftId);
  const qs = search.toString();
  const res = await apiFetch(`${API_BASE}/my-work${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
  return parseJson<{
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
  }>(res);
}
