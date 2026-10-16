/**
 * Request/response types for the housekeeping cleaning-results report.
 */
import { CleaningServiceType, Prisma } from "@prisma/client";

/** Inclusive YYYY-MM-DD range, pagination, optional service-type and scope filters. */
export type CleaningResultsQuery = {
  from: string;
  to: string;
  page: number;
  pageSize: number;
  serviceTypes?: CleaningServiceType[];
  /** Optional session filter from data scope (supervisor sectors, etc.). */
  sessionWhere?: Prisma.CleaningSessionWhereInput;
  /** Optional task filter from data scope. */
  taskWhere?: Prisma.CleaningTaskWhereInput;
};

/** Aggregated counters for one housekeeper row or the period summary. */
export type CleaningResultsCounters = {
  completedSessions: number;
  completedTasks: number;
  acceptedTasks: number;
  reworkEvents: number;
  anomalousSessions: number;
  distinctRooms: number;
  onTimePct: number | null;
  avgValidMinutes: number | null;
  totalValidSessionMinutes: number;
  totalExcludedSessionMinutes: number;
};

/** One housekeeper's counters in the paged results table. */
export type CleaningResultsRow = {
  employeeId: string;
  fullName: string;
  employeeNumber: string;
} & CleaningResultsCounters;

/** Full report payload: summary KPIs, hourly series, and paged employee rows. */
export type CleaningResultsResponse = {
  period: { from: string; to: string };
  summary: {
    housekeeperCount: number;
    completedSessions: number;
    completedTasks: number;
    acceptedTasks: number;
    reworkEvents: number;
    anomalousSessions: number;
    distinctRooms: number;
    onTimePct: number | null;
    productivity: number | null;
    totalValidSessionMinutes: number;
    totalExcludedSessionMinutes: number;
    byServiceType: Array<{ key: CleaningServiceType; count: number }>;
  };
  series: Array<{ hour: number; completedSessions: number }>;
  rows: CleaningResultsRow[];
  page: number;
  pageSize: number;
  total: number;
};
