/**
 * Mutable accumulator and finalization for cleaning-results counter rolls.
 */
import type { CleaningResultsCounters } from "./types";
import { avgValidMinutesFromTaskMs, round1 } from "./metrics";

/** Zeroed accumulator with raw ms / on-time sample fields used while aggregating. */
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
  // Raw ms / on-time sample fields are finalized away in finalizeCounters.
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

/** Convert an accumulator + distinct-room set into API {@link CleaningResultsCounters}. */
export function finalizeCounters(
  agg: ReturnType<typeof emptyCounters>,
  roomSet: Set<string>,
): CleaningResultsCounters {
  // Convert accumulated ms into display minutes (1 decimal).
  const totalValidSessionMinutes = round1(agg.totalValidSessionMs / (1000 * 60));
  const totalExcludedSessionMinutes = round1(
    agg.totalExcludedSessionMs / (1000 * 60),
  );
  // Map accumulator fields onto the public counters DTO.
  return {
    completedSessions: agg.completedSessions,
    completedTasks: agg.completedTasks,
    acceptedTasks: agg.acceptedTasks,
    reworkEvents: agg.reworkEvents,
    anomalousSessions: agg.anomalousSessions,
    // Distinct rooms come from the caller's Set (not the zeroed field).
    distinctRooms: roomSet.size,
    // Null when no sessions had a known dueAt for on-time scoring.
    onTimePct:
      agg.onTimeKnown > 0
        ? round1((agg.onTimeOk / agg.onTimeKnown) * 100)
        : null,
    // Average valid minutes per task that contributed valid session time.
    avgValidMinutes: avgValidMinutesFromTaskMs(
      agg.totalValidMsForTasks,
      agg.tasksWithValidTime,
    ),
    totalValidSessionMinutes,
    totalExcludedSessionMinutes,
  };
}
