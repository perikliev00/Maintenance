import { CleaningServiceType, Prisma } from "@prisma/client";

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

export type CleaningResultsRow = {
  employeeId: string;
  fullName: string;
  employeeNumber: string;
} & CleaningResultsCounters;

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
