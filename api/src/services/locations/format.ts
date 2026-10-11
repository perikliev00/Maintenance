import { computeReadiness } from "../readiness";
import type { LocationForMap } from "./types";

export function mapLocation(location: LocationForMap) {
  const blockingTickets = location.maintenanceTickets ?? [];
  const { readiness, reasons } = computeReadiness({
    kind: location.kind,
    catalogStatus: location.catalogStatus as any,
    occupancy: location.occupancy as any,
    cleaningStatus: location.cleaningStatus as any,
    serviceStatus: location.serviceStatus as any,
    hasBlockingTicket: blockingTickets.length > 0,
  });
  const activeTask = location.cleaningTasks?.[0] ?? null;
  const runningSession =
    activeTask?.sessions.find((s) => s.status === "running") ?? null;
  const lastCompletedSession =
    activeTask?.sessions.find((s) => s.status === "completed") ?? null;
  const lastInspection = activeTask?.inspections?.[0] ?? null;
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
    blockingIssues: blockingTickets.map((t) => ({
      id: t.id,
      title: t.title,
      category: t.categoryKey,
      categoryLabelBg: t.categoryLabelBg,
      priority: t.priority,
      status: t.status,
    })),
    activeTask: activeTask
      ? {
          id: activeTask.id,
          status: activeTask.status,
          priority: activeTask.priority,
          dueAt: activeTask.dueAt,
          version: activeTask.version,
          reassignReason: activeTask.reassignReason,
          assignee: activeTask.assignedEmployee
            ? {
                id: activeTask.assignedEmployee.id,
                fullName: activeTask.assignedEmployee.fullName,
                employeeNumber: activeTask.assignedEmployee.employeeNumber,
              }
            : null,
          runningSession: runningSession
            ? {
                id: runningSession.id,
                startedAt: runningSession.startedAt,
                employeeId: runningSession.employeeId,
              }
            : null,
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

/** Alias kept for existing imports. */
export const mapRoom = mapLocation;
