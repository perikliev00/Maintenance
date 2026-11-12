/**
 * Client-side Rooms board filters over the drained location list.
 */
import type { Room } from "../../api/client";

// Export type definition for consumers of this module.
export type RoomBoardFilters = {
  // Provide q field used by this structure.
  q: string;
  // Provide building field used by this structure.
  building: string;
  // Provide floor field used by this structure.
  floor: string;
  // Provide sector field used by this structure.
  sector: string;
  // Provide occupancy field used by this structure.
  occupancy: string;
  // Provide readiness field used by this structure.
  readiness: string;
  // Provide dirtyOnly field used by this structure.
  dirtyOnly: boolean;
  // Provide awaitingInspection field used by this structure.
  awaitingInspection: boolean;
  // Provide reworkOnly field used by this structure.
  reworkOnly: boolean;
  // Provide activeRepairs field used by this structure.
  activeRepairs: boolean;
  // Provide blockingRepairs field used by this structure.
  blockingRepairs: boolean;
  // Provide overdueOnly field used by this structure.
  overdueOnly: boolean;
  // Provide assigneeId field used by this structure.
  assigneeId: string;
};

// Export EMPTY_ROOM_FILTERS for use by other modules.
export const EMPTY_ROOM_FILTERS: RoomBoardFilters = {
  // Provide q field used by this structure.
  q: "",
  // Provide building field used by this structure.
  building: "",
  // Provide floor field used by this structure.
  floor: "",
  // Provide sector field used by this structure.
  sector: "",
  // Provide occupancy field used by this structure.
  occupancy: "",
  // Provide readiness field used by this structure.
  readiness: "",
  // Provide dirtyOnly field used by this structure.
  dirtyOnly: false,
  // Provide awaitingInspection field used by this structure.
  awaitingInspection: false,
  // Provide reworkOnly field used by this structure.
  reworkOnly: false,
  // Provide activeRepairs field used by this structure.
  activeRepairs: false,
  // Provide blockingRepairs field used by this structure.
  blockingRepairs: false,
  // Provide overdueOnly field used by this structure.
  overdueOnly: false,
  // Provide assigneeId field used by this structure.
  assigneeId: "",
};

// Export function applyRoomFilters as part of this module's API.
export function applyRoomFilters(
  // Provide rooms field used by this structure.
  rooms: Room[],
  // Provide filters field used by this structure.
  filters: RoomBoardFilters,
  // Provide overdueLocationIds field used by this structure.
  overdueLocationIds: Set<string>,
// Support the surrounding logic for this step.
): Room[] {
  // Bind q for use in the following logic.
  const q = filters.q.trim().toLowerCase();
  // Return early result or rendered output from this path.
  return rooms.filter((loc) => {
    // Conditional branch for the case described by this guard.
    if (q && !loc.number.toLowerCase().includes(q)) return false;
    // Conditional branch for the case described by this guard.
    if (filters.building && loc.buildingCode !== filters.building) return false;
    // Conditional branch for the case described by this guard.
    if (filters.floor && String(loc.floor) !== filters.floor) return false;
    // Conditional branch for the case described by this guard.
    if (filters.sector) {
      // Conditional branch for the case described by this guard.
      if (!loc.sector || loc.sector.code !== filters.sector) return false;
    }
    // Conditional branch for the case described by this guard.
    if (filters.occupancy && loc.occupancy !== filters.occupancy) return false;
    // Conditional branch for the case described by this guard.
    if (filters.readiness && loc.readiness !== filters.readiness) return false;
    // Conditional branch for the case described by this guard.
    if (filters.dirtyOnly && loc.cleaningStatus !== "dirty") return false;
    // Conditional branch for the case described by this guard.
    if (
      // Support the surrounding logic for this step.
      filters.awaitingInspection &&
      // Support the surrounding logic for this step.
      loc.activeTask?.status !== "awaiting_inspection" &&
      // Support the surrounding logic for this step.
      loc.cleaningStatus !== "pending_inspection"
    // Support the surrounding logic for this step.
    ) {
      // Return early result or rendered output from this path.
      return false;
    }
    // Conditional branch for the case described by this guard.
    if (filters.reworkOnly && loc.activeTask?.status !== "rework") return false;
    // Bind blocking for use in the following logic.
    const blocking = loc.blockingIssueCount ?? loc.blockingIssues.length;
    // Bind nonBlocking for use in the following logic.
    const nonBlocking = loc.nonBlockingIssueCount ?? 0;
    // Conditional branch for the case described by this guard.
    if (filters.blockingRepairs && blocking <= 0) return false;
    // Conditional branch for the case described by this guard.
    if (filters.activeRepairs && blocking + nonBlocking <= 0) return false;
    // Conditional branch for the case described by this guard.
    if (filters.overdueOnly && !overdueLocationIds.has(loc.id)) return false;
    // Conditional branch for the case described by this guard.
    if (
      // Support the surrounding logic for this step.
      filters.assigneeId &&
      // Support the surrounding logic for this step.
      loc.activeTask?.assignee?.id !== filters.assigneeId
    // Support the surrounding logic for this step.
    ) {
      // Return early result or rendered output from this path.
      return false;
    }
    // Return early result or rendered output from this path.
    return true;
  });
}

// Export function uniqueSorted as part of this module's API.
export function uniqueSorted(values: string[]): string[] {
  // Return early result or rendered output from this path.
  return [...new Set(values.filter(Boolean))].sort((a, b) =>
    // Invoke a.localeCompare to perform this step.
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}
