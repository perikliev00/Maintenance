/**
 * Request/response types for the housekeeping cleaning-results report.
 */
import { CleaningServiceType, Prisma } from "@prisma/client";

/** Inclusive YYYY-MM-DD range, pagination, optional service-type and scope filters. */
export type CleaningResultsQuery = {
  // Carry this field through the payload or query.
  from: string;
  // Carry this field through the payload or query.
  to: string;
  // Carry this field through the payload or query.
  page: number;
  // Carry this field through the payload or query.
  pageSize: number;
  // Parameter/field in the surrounding signature or type.
  serviceTypes?: CleaningServiceType[];
  /** Optional session filter from data scope (supervisor sectors, etc.). */
  sessionWhere?: Prisma.CleaningSessionWhereInput;
  /** Optional task filter from data scope. */
  taskWhere?: Prisma.CleaningTaskWhereInput;
};

/** Aggregated counters for one housekeeper row or the period summary. */
export type CleaningResultsCounters = {
  // Carry this field through the payload or query.
  completedSessions: number;
  // Carry this field through the payload or query.
  completedTasks: number;
  // Carry this field through the payload or query.
  acceptedTasks: number;
  // Carry this field through the payload or query.
  reworkEvents: number;
  // Carry this field through the payload or query.
  anomalousSessions: number;
  // Carry this field through the payload or query.
  distinctRooms: number;
  // Field value required by this payload or query.
  onTimePct: number | null;
  // Field value required by this payload or query.
  avgValidMinutes: number | null;
  // Carry this field through the payload or query.
  totalValidSessionMinutes: number;
  // Carry this field through the payload or query.
  totalExcludedSessionMinutes: number;
};

/** One housekeeper's counters in the paged results table. */
export type CleaningResultsRow = {
  // Carry this field through the payload or query.
  employeeId: string;
  // Carry this field through the payload or query.
  fullName: string;
  // Carry this field through the payload or query.
  employeeNumber: string;
// Execute: } & CleaningResultsCounters;
} & CleaningResultsCounters;

/** Full report payload: summary KPIs, hourly series, and paged employee rows. */
export type CleaningResultsResponse = {
  // Carry this field through the payload or query.
  period: { from: string; to: string };
  // Open nested structure for the next related fields.
  summary: {
    // Carry this field through the payload or query.
    housekeeperCount: number;
    // Carry this field through the payload or query.
    completedSessions: number;
    // Carry this field through the payload or query.
    completedTasks: number;
    // Carry this field through the payload or query.
    acceptedTasks: number;
    // Carry this field through the payload or query.
    reworkEvents: number;
    // Carry this field through the payload or query.
    anomalousSessions: number;
    // Carry this field through the payload or query.
    distinctRooms: number;
    // Field value required by this payload or query.
    onTimePct: number | null;
    // Field value required by this payload or query.
    productivity: number | null;
    // Carry this field through the payload or query.
    totalValidSessionMinutes: number;
    // Carry this field through the payload or query.
    totalExcludedSessionMinutes: number;
    // Carry this field through the payload or query.
    byServiceType: Array<{ key: CleaningServiceType; count: number }>;
  };
  // Carry this field through the payload or query.
  series: Array<{ hour: number; completedSessions: number }>;
  // Carry this field through the payload or query.
  rows: CleaningResultsRow[];
  // Carry this field through the payload or query.
  page: number;
  // Carry this field through the payload or query.
  pageSize: number;
  // Carry this field through the payload or query.
  total: number;
};
