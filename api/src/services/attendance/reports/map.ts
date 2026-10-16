/**
 * Attendance interval API DTO mapping and list/export size constants.
 */
import { Prisma } from "@prisma/client";
import { asFlags } from "../../attendanceRules";

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
  employee: {
    select: {
      id: true,
      fullName: true,
      employeeNumber: true,
      department: true,
    },
  },
  adjustments: {
    orderBy: { createdAt: "desc" as const },
    take: 5,
    include: {
      requestedBy: {
        select: { id: true, fullName: true, employeeNumber: true },
      },
      reviewedBy: {
        select: { id: true, fullName: true, employeeNumber: true },
      },
    },
  },
} satisfies Prisma.AttendanceIntervalInclude;

/** Map a Prisma interval (+ employee, recent adjustments) to the API shape. */
export function mapInterval(
  row: Prisma.AttendanceIntervalGetPayload<{ include: typeof intervalInclude }>,
) {
  // ISO strings for clients; hotelDate trimmed to YYYY-MM-DD.
  return {
    id: row.id,
    employeeId: row.employeeId,
    employee: row.employee,
    hotelDate: row.hotelDate.toISOString().slice(0, 10),
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    breakMinutes: row.breakMinutes,
    workedMinutes: row.workedMinutes,
    status: row.status,
    // Coerce JSON flags to string[] for the API / CSV export.
    anomalyFlags: asFlags(row.anomalyFlags),
    startEventId: row.startEventId,
    endEventId: row.endEventId,
    // Recent adjustments (include already limited to 5 newest).
    adjustments: row.adjustments.map((a) => ({
      id: a.id,
      status: a.status,
      reason: a.reason,
      proposedStartedAt: a.proposedStartedAt?.toISOString() ?? null,
      proposedEndedAt: a.proposedEndedAt?.toISOString() ?? null,
      proposedBreakMinutes: a.proposedBreakMinutes,
      requestedBy: a.requestedBy,
      reviewedBy: a.reviewedBy,
      createdAt: a.createdAt.toISOString(),
      reviewedAt: a.reviewedAt?.toISOString() ?? null,
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type ListIntervalsFilter = {
  scope?: "month" | "today" | "week" | "review";
  month?: string;
  department?: string;
  q?: string;
  employeeId?: string;
};

export type ListIntervalsPage = {
  limit?: number;
  cursor?: string;
};
