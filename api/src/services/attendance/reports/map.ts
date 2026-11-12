/**
 * Attendance interval API DTO mapping and list/export size constants.
 */
import { Prisma } from "@prisma/client";
// Runtime import from ../../attendanceRules.
import { asFlags } from "../../attendanceRules";
// Runtime import from ../../hotelTime.
import { formatHotelDate } from "../../hotelTime";

/** Default page size when the client omits `limit`. */
export const LIST_DEFAULT_LIMIT = 200;
/** Max page size for a single list request (not a hard total cap) */
export const LIST_MAX_LIMIT = 500;
/** Batch size when draining all rows for CSV export */
export const EXPORT_BATCH = 1000;
/** Hard ceiling for a single CSV export response */
export const EXPORT_CEILING = 50_000;

/** Prisma include for list/export/get interval payloads. */
export const intervalInclude = {
  // Field employee on this type/payload.
  employee: {
    // Select only needed columns.
    select: {
      // Field id on this type/payload.
      id: true,
      // Field fullName on this type/payload.
      fullName: true,
      // Field employeeNumber on this type/payload.
      employeeNumber: true,
      // Field department on this type/payload.
      department: true,
    },
  },
  // Field adjustments on this type/payload.
  adjustments: {
    // Stable sort for paging.
    orderBy: { createdAt: "desc" as const },
    // Page size limit.
    take: 5,
    // Include relations for labels/checks.
    include: {
      // Field requestedBy on this type/payload.
      requestedBy: {
        // Select only needed columns.
        select: { id: true, fullName: true, employeeNumber: true },
      },
      // Field reviewedBy on this type/payload.
      reviewedBy: {
        // Select only needed columns.
        select: { id: true, fullName: true, employeeNumber: true },
      },
    },
  },
// Support the surrounding control flow.
} satisfies Prisma.AttendanceIntervalInclude;

/** Map a Prisma interval (+ employee, recent adjustments) to the API shape. */
export function mapInterval(
  // Param row required by this function.
  row: Prisma.AttendanceIntervalGetPayload<{ include: typeof intervalInclude }>,
) {
  // ISO strings for clients; hotelDate trimmed to YYYY-MM-DD.
  return {
    // Set id.
    id: row.id,
    // Set employeeId.
    employeeId: row.employeeId,
    // Set employee.
    employee: row.employee,
    // Compute hotelDate for the payload.
    hotelDate: formatHotelDate(row.hotelDate),
    // Set startedAt.
    startedAt: row.startedAt.toISOString(),
    // Set endedAt.
    endedAt: row.endedAt?.toISOString() ?? null,
    // Set breakMinutes.
    breakMinutes: row.breakMinutes,
    // Set workedMinutes.
    workedMinutes: row.workedMinutes,
    // Set status.
    status: row.status,
    // Coerce JSON flags to string[] for the API / CSV export.
    anomalyFlags: asFlags(row.anomalyFlags),
    // Set startEventId.
    startEventId: row.startEventId,
    // Set endEventId.
    endEventId: row.endEventId,
    // Recent adjustments (include already limited to 5 newest).
    adjustments: row.adjustments.map((a) => ({
      // Set id.
      id: a.id,
      // Set status.
      status: a.status,
      // Set reason.
      reason: a.reason,
      // Set proposedStartedAt.
      proposedStartedAt: a.proposedStartedAt?.toISOString() ?? null,
      // Set proposedEndedAt.
      proposedEndedAt: a.proposedEndedAt?.toISOString() ?? null,
      // Set proposedBreakMinutes.
      proposedBreakMinutes: a.proposedBreakMinutes,
      // Set requestedBy.
      requestedBy: a.requestedBy,
      // Set reviewedBy.
      reviewedBy: a.reviewedBy,
      // Set createdAt.
      createdAt: a.createdAt.toISOString(),
      // Set reviewedAt.
      reviewedAt: a.reviewedAt?.toISOString() ?? null,
    })),
    // Set createdAt.
    createdAt: row.createdAt.toISOString(),
    // Set updatedAt.
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Public type ListIntervalsFilter for callers of this service.
export type ListIntervalsFilter = {
  // Time field scope.
  scope?: "month" | "today" | "week" | "review";
  // Optional month.
  month?: string;
  // Optional department.
  department?: string;
  // Optional q.
  q?: string;
  // Optional employeeId.
  employeeId?: string;
};

// Public type ListIntervalsPage for callers of this service.
export type ListIntervalsPage = {
  // Optional limit.
  limit?: number;
  // Optional cursor.
  cursor?: string;
};
