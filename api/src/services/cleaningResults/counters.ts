import type { CleaningResultsCounters } from "./types";
import { avgValidMinutesFromTaskMs, round1 } from "./metrics";

export function emptyCounters(): Omit<
  CleaningResultsCounters,
  | "onTimePct"
  | "avgValidMinutes"
  | "totalValidSessionMinutes"
  | "totalExcludedSessionMinutes"
> & {
  onTimeKnown: number;
  onTimeOk: number;
  totalValidSessionMs: number;
  totalExcludedSessionMs: number;
  totalValidMsForTasks: number;
  tasksWithValidTime: number;
} {
  return {
    completedSessions: 0,
    completedTasks: 0,
    acceptedTasks: 0,
    reworkEvents: 0,
    anomalousSessions: 0,
    distinctRooms: 0,
    onTimeKnown: 0,
    onTimeOk: 0,
    totalValidSessionMs: 0,
    totalExcludedSessionMs: 0,
    totalValidMsForTasks: 0,
    tasksWithValidTime: 0,
  };
}

export function finalizeCounters(
  agg: ReturnType<typeof emptyCounters>,
  roomSet: Set<string>,
): CleaningResultsCounters {
  const totalValidSessionMinutes = round1(agg.totalValidSessionMs / (1000 * 60));
  const totalExcludedSessionMinutes = round1(
    agg.totalExcludedSessionMs / (1000 * 60),
  );
  return {
    completedSessions: agg.completedSessions,
    completedTasks: agg.completedTasks,
    acceptedTasks: agg.acceptedTasks,
    reworkEvents: agg.reworkEvents,
    anomalousSessions: agg.anomalousSessions,
    distinctRooms: roomSet.size,
    onTimePct:
      agg.onTimeKnown > 0
        ? round1((agg.onTimeOk / agg.onTimeKnown) * 100)
        : null,
    avgValidMinutes: avgValidMinutesFromTaskMs(
      agg.totalValidMsForTasks,
      agg.tasksWithValidTime,
    ),
    totalValidSessionMinutes,
    totalExcludedSessionMinutes,
  };
}
