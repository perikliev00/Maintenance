/**
 * Client-side Rooms board filters over the drained location list.
 */
import type { Room } from "../../api/client";

export type RoomBoardFilters = {
  q: string;
  building: string;
  floor: string;
  sector: string;
  occupancy: string;
  readiness: string;
  dirtyOnly: boolean;
  awaitingInspection: boolean;
  reworkOnly: boolean;
  activeRepairs: boolean;
  blockingRepairs: boolean;
  overdueOnly: boolean;
  assigneeId: string;
};

// Export EMPTY_ROOM_FILTERS for use by other modules.
export const EMPTY_ROOM_FILTERS: RoomBoardFilters = {
  q: "",
  building: "",
  floor: "",
  sector: "",
  occupancy: "",
  readiness: "",
  dirtyOnly: false,
  awaitingInspection: false,
  reworkOnly: false,
  activeRepairs: false,
  blockingRepairs: false,
  overdueOnly: false,
  assigneeId: "",
};

// Export function applyRoomFilters as part of this module's API.
export function applyRoomFilters(
  rooms: Room[],
  filters: RoomBoardFilters,
  overdueLocationIds: Set<string>,
): Room[] {
  const q = filters.q.trim().toLowerCase();
  return rooms.filter((loc) => {
    if (q && !loc.number.toLowerCase().includes(q)) return false;
    if (filters.building && loc.buildingCode !== filters.building) return false;
    if (filters.floor && String(loc.floor) !== filters.floor) return false;
    if (filters.sector) {
      if (!loc.sector || loc.sector.code !== filters.sector) return false;
    }
    if (filters.occupancy && loc.occupancy !== filters.occupancy) return false;
    if (filters.readiness && loc.readiness !== filters.readiness) return false;
    if (filters.dirtyOnly && loc.cleaningStatus !== "dirty") return false;
    if (
      filters.awaitingInspection &&
      loc.activeTask?.status !== "awaiting_inspection" &&
      loc.cleaningStatus !== "pending_inspection"
    ) {
      return false;
    }
    if (filters.reworkOnly && loc.activeTask?.status !== "rework") return false;
    const blocking = loc.blockingIssueCount ?? loc.blockingIssues.length;
    const nonBlocking = loc.nonBlockingIssueCount ?? 0;
    if (filters.blockingRepairs && blocking <= 0) return false;
    if (filters.activeRepairs && blocking + nonBlocking <= 0) return false;
    if (filters.overdueOnly && !overdueLocationIds.has(loc.id)) return false;
    if (
      filters.assigneeId &&
      loc.activeTask?.assignee?.id !== filters.assigneeId
    ) {
      return false;
    }
    return true;
  });
}

// Export function uniqueSorted as part of this module's API.
export function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}
