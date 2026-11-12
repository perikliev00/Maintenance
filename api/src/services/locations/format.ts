/**
 * Map a location (+ active task / tickets) to the live-board API DTO,
 * including computed readiness and active-sector info.
 */
import { computeReadiness } from "../readiness";
// Import type(s) LocationForMap for typing without runtime cost.
import type { LocationForMap } from "./types";

/**
 * Flatten hierarchy and derive readiness / running session for clients.
 * Caller must pre-include cleaningTasks, sessions, inspections, and
 * blocking maintenanceTickets in the expected order.
 */
export function mapLocation(location: LocationForMap) {
  // Blocking open tickets feed readiness (caller pre-filters the include).
  const blockingTickets = location.maintenanceTickets ?? [];
  // Derive ready / not_ready / needs_check from catalog + occupancy + cleaning.
  const { readiness, reasons } = computeReadiness({
    // Set kind on the structure being built.
    kind: location.kind,
    // Set catalogStatus on the structure being built.
    catalogStatus: location.catalogStatus as any,
    // Set occupancy on the structure being built.
    occupancy: location.occupancy as any,
    // Set cleaningStatus on the structure being built.
    cleaningStatus: location.cleaningStatus as any,
    // Set serviceStatus on the structure being built.
    serviceStatus: location.serviceStatus as any,
    // Set hasBlockingTicket on the structure being built.
    hasBlockingTicket:
      // Run next step: (location.blockingIssueCount ?? blockingTickets.length) > 0,
      (location.blockingIssueCount ?? blockingTickets.length) > 0,
  });
  // Active task is the first included cleaning task (query orders by status).
  const activeTask = location.cleaningTasks?.[0] ?? null;
  // Prefer a running session over completed ones for the live timer.
  const runningSession =
    // Run next step: activeTask?.sessions.find((s) => s.status === "running") ?? …
    activeTask?.sessions.find((s) => s.status === "running") ?? null;
  // Last completed session powers the "just finished" strip on the board.
  const lastCompletedSession =
    // Run next step: activeTask?.sessions.find((s) => s.status === "completed") ?…
    activeTask?.sessions.find((s) => s.status === "completed") ?? null;
  // Newest inspection is first when the include orders inspectedAt desc.
  const lastInspection = activeTask?.inspections?.[0] ?? null;
  // Only expose an active sector membership on the live board.
  const sector =
    // Run next step: location.sectorMembership?.sector &&
    location.sectorMembership?.sector &&
    // Run next step: location.sectorMembership.sector.isActive
    location.sectorMembership.sector.isActive
      // Complete the ternary or optional chain started above.
      ? {
          // Set id on the structure being built.
          id: location.sectorMembership.sector.id,
          // Set code on the structure being built.
          code: location.sectorMembership.sector.code,
          // Set nameBg on the structure being built.
          nameBg: location.sectorMembership.sector.nameBg,
          // Set nameEn on the structure being built.
          nameEn: location.sectorMembership.sector.nameEn,
        }
      // Complete the ternary or optional chain started above.
      : null;

  // Flatten floor/building joins and nest the active-task subtree for clients.
  return {
    // Set id on the structure being built.
    id: location.id,
    // Set floorId on the structure being built.
    floorId: location.floorId,
    // Set number on the structure being built.
    number: location.number,
    // Set kind on the structure being built.
    kind: location.kind,
    // Set floor on the structure being built.
    floor: location.floor.number,
    // Set floorName on the structure being built.
    floorName: location.floor.name,
    // Set building on the structure being built.
    building: location.floor.building.name,
    // Set buildingCode on the structure being built.
    buildingCode: location.floor.building.code,
    // Set catalogStatus on the structure being built.
    catalogStatus: location.catalogStatus,
    // Set occupancy on the structure being built.
    occupancy: location.occupancy,
    // Set cleaningStatus on the structure being built.
    cleaningStatus: location.cleaningStatus,
    // Set serviceStatus on the structure being built.
    serviceStatus: location.serviceStatus,
    // Run next step: sector,
    sector,
    // Run next step: readiness,
    readiness,
    // Set readinessReasons on the structure being built.
    readinessReasons: reasons,
    // Compact ticket cards for the readiness / issue chips (preview only).
    blockingIssues: blockingTickets.map((t) => ({
      // Set id on the structure being built.
      id: t.id,
      // Set title on the structure being built.
      title: t.title,
      // Set category on the structure being built.
      category: t.categoryKey,
      // Set categoryLabelBg on the structure being built.
      categoryLabelBg: t.categoryLabelBg,
      // Set priority on the structure being built.
      priority: t.priority,
      // Set status on the structure being built.
      status: t.status,
    })),
    // Authoritative totals — preview may be truncated at 5.
    blockingIssueCount:
      // Run next step: location.blockingIssueCount ?? blockingTickets.length,
      location.blockingIssueCount ?? blockingTickets.length,
    // Set nonBlockingIssueCount on the structure being built.
    nonBlockingIssueCount: location.nonBlockingIssueCount ?? 0,
    // Null when no active cleaning task; otherwise nest session/inspection DTOs.
    activeTask: activeTask
      // Complete the ternary or optional chain started above.
      ? {
          // Set id on the structure being built.
          id: activeTask.id,
          // Set status on the structure being built.
          status: activeTask.status,
          // Set priority on the structure being built.
          priority: activeTask.priority,
          // Set dueAt on the structure being built.
          dueAt: activeTask.dueAt,
          // Set version on the structure being built.
          version: activeTask.version,
          // Set reassignReason on the structure being built.
          reassignReason: activeTask.reassignReason,
          // Assignee may be null for unassigned / claimable tasks.
          assignee: activeTask.assignedEmployee
            // Complete the ternary or optional chain started above.
            ? {
                // Set id on the structure being built.
                id: activeTask.assignedEmployee.id,
                // Set fullName on the structure being built.
                fullName: activeTask.assignedEmployee.fullName,
                // Set employeeNumber on the structure being built.
                employeeNumber: activeTask.assignedEmployee.employeeNumber,
              }
            // Complete the ternary or optional chain started above.
            : null,
          // Live timer payload when a housekeeper is currently cleaning.
          runningSession: runningSession
            // Complete the ternary or optional chain started above.
            ? {
                // Set id on the structure being built.
                id: runningSession.id,
                // Set startedAt on the structure being built.
                startedAt: runningSession.startedAt,
                // Set employeeId on the structure being built.
                employeeId: runningSession.employeeId,
              }
            // Complete the ternary or optional chain started above.
            : null,
          // Most recent completed session for the board's recent strip.
          lastCompletedSession: lastCompletedSession
            // Complete the ternary or optional chain started above.
            ? {
                // Set id on the structure being built.
                id: lastCompletedSession.id,
                // Set finishedAt on the structure being built.
                finishedAt: lastCompletedSession.finishedAt,
                // Set notes on the structure being built.
                notes: lastCompletedSession.notes,
                // Set employee on the structure being built.
                employee: {
                  // Set id on the structure being built.
                  id: lastCompletedSession.employee.id,
                  // Set fullName on the structure being built.
                  fullName: lastCompletedSession.employee.fullName,
                  // Set employeeNumber on the structure being built.
                  employeeNumber: lastCompletedSession.employee.employeeNumber,
                },
              }
            // Complete the ternary or optional chain started above.
            : null,
          // Latest inspection outcome (pass/fail + findings) when present.
          lastInspection: lastInspection
            // Complete the ternary or optional chain started above.
            ? {
                // Set id on the structure being built.
                id: lastInspection.id,
                // Set result on the structure being built.
                result: lastInspection.result,
                // Set findings on the structure being built.
                findings: lastInspection.findings,
                // Set inspectedAt on the structure being built.
                inspectedAt: lastInspection.inspectedAt,
                // Set inspector on the structure being built.
                inspector: {
                  // Set id on the structure being built.
                  id: lastInspection.inspector.id,
                  // Set fullName on the structure being built.
                  fullName: lastInspection.inspector.fullName,
                  // Set employeeNumber on the structure being built.
                  employeeNumber: lastInspection.inspector.employeeNumber,
                },
              }
            // Complete the ternary or optional chain started above.
            : null,
        }
      // Complete the ternary or optional chain started above.
      : null,
  };
}
