/**
 * Map a location (+ active task / tickets) to the live-board API DTO,
 * including computed readiness and active-sector info.
 */
import { computeReadiness } from "../readiness";
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
    kind: location.kind,
    catalogStatus: location.catalogStatus as any,
    occupancy: location.occupancy as any,
    cleaningStatus: location.cleaningStatus as any,
    serviceStatus: location.serviceStatus as any,
    hasBlockingTicket: blockingTickets.length > 0,
  });
  // Active task is the first included cleaning task (query orders by status).
  const activeTask = location.cleaningTasks?.[0] ?? null;
  // Prefer a running session over completed ones for the live timer.
  const runningSession =
    activeTask?.sessions.find((s) => s.status === "running") ?? null;
  // Last completed session powers the "just finished" strip on the board.
  const lastCompletedSession =
    activeTask?.sessions.find((s) => s.status === "completed") ?? null;
  // Newest inspection is first when the include orders inspectedAt desc.
  const lastInspection = activeTask?.inspections?.[0] ?? null;
  // Only expose an active sector membership on the live board.
  const sector =
    location.sectorMembership?.sector &&
    location.sectorMembership.sector.isActive
      ? {
          id: location.sectorMembership.sector.id,
          code: location.sectorMembership.sector.code,
          nameBg: location.sectorMembership.sector.nameBg,
          nameEn: location.sectorMembership.sector.nameEn,
        }
      : null;

  // Flatten floor/building joins and nest the active-task subtree for clients.
  return {
    id: location.id,
    floorId: location.floorId,
    number: location.number,
    kind: location.kind,
    floor: location.floor.number,
    floorName: location.floor.name,
    building: location.floor.building.name,
    buildingCode: location.floor.building.code,
    catalogStatus: location.catalogStatus,
    occupancy: location.occupancy,
    cleaningStatus: location.cleaningStatus,
    serviceStatus: location.serviceStatus,
    qrToken: location.qrToken,
    sector,
    readiness,
    readinessReasons: reasons,
    // Compact ticket cards for the readiness / issue chips.
    blockingIssues: blockingTickets.map((t) => ({
      id: t.id,
      title: t.title,
      category: t.categoryKey,
      categoryLabelBg: t.categoryLabelBg,
      priority: t.priority,
      status: t.status,
    })),
    // Null when no active cleaning task; otherwise nest session/inspection DTOs.
    activeTask: activeTask
      ? {
          id: activeTask.id,
          status: activeTask.status,
          priority: activeTask.priority,
          dueAt: activeTask.dueAt,
          version: activeTask.version,
          reassignReason: activeTask.reassignReason,
          // Assignee may be null for unassigned / claimable tasks.
          assignee: activeTask.assignedEmployee
            ? {
                id: activeTask.assignedEmployee.id,
                fullName: activeTask.assignedEmployee.fullName,
                employeeNumber: activeTask.assignedEmployee.employeeNumber,
              }
            : null,
          // Live timer payload when a housekeeper is currently cleaning.
          runningSession: runningSession
            ? {
                id: runningSession.id,
                startedAt: runningSession.startedAt,
                employeeId: runningSession.employeeId,
              }
            : null,
          // Most recent completed session for the board's recent strip.
          lastCompletedSession: lastCompletedSession
            ? {
                id: lastCompletedSession.id,
                finishedAt: lastCompletedSession.finishedAt,
                notes: lastCompletedSession.notes,
                employee: {
                  id: lastCompletedSession.employee.id,
                  fullName: lastCompletedSession.employee.fullName,
                  employeeNumber: lastCompletedSession.employee.employeeNumber,
                },
              }
            : null,
          // Latest inspection outcome (pass/fail + findings) when present.
          lastInspection: lastInspection
            ? {
                id: lastInspection.id,
                result: lastInspection.result,
                findings: lastInspection.findings,
                inspectedAt: lastInspection.inspectedAt,
                inspector: {
                  id: lastInspection.inspector.id,
                  fullName: lastInspection.inspector.fullName,
                  employeeNumber: lastInspection.inspector.employeeNumber,
                },
              }
            : null,
        }
      : null,
  };
}
