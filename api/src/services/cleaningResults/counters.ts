/**
 * Mutable accumulator and finalization for cleaning-results counter rolls.
 */
import type { CleaningResultsCounters } from "./types";
// Import ./metrics for cleaningResults/counters.ts.
import { avgValidMinutesFromTaskMs, round1 } from "./metrics";

/** Zeroed accumulator with raw ms / on-time sample fields used while aggregating. */
export function emptyCounters(): Omit<
  // Carry this field through the payload or query.
  CleaningResultsCounters,
  // Continue the previous expression with this clause.
  | "onTimePct"
  // Continue the previous expression with this clause.
  | "avgValidMinutes"
  // Continue the previous expression with this clause.
  | "totalValidSessionMinutes"
  // Continue the previous expression with this clause.
  | "totalExcludedSessionMinutes"
// Begin block/object for the following statements.
> & {
  // Carry this field through the payload or query.
  onTimeKnown: number;
  // Carry this field through the payload or query.
  onTimeOk: number;
  // Carry this field through the payload or query.
  totalValidSessionMs: number;
  // Carry this field through the payload or query.
  totalExcludedSessionMs: number;
  // Carry this field through the payload or query.
  totalValidMsForTasks: number;
  // Carry this field through the payload or query.
  tasksWithValidTime: number;
// Begin block/object for the following statements.
} {
  // Raw ms / on-time sample fields are finalized away in finalizeCounters.
  return {
    // Field value required by this payload or query.
    completedSessions: 0,
    // Field value required by this payload or query.
    completedTasks: 0,
    // Field value required by this payload or query.
    acceptedTasks: 0,
    // Field value required by this payload or query.
    reworkEvents: 0,
    // Field value required by this payload or query.
    anomalousSessions: 0,
    // Field value required by this payload or query.
    distinctRooms: 0,
    // Field value required by this payload or query.
    onTimeKnown: 0,
    // Field value required by this payload or query.
    onTimeOk: 0,
    // Field value required by this payload or query.
    totalValidSessionMs: 0,
    // Field value required by this payload or query.
    totalExcludedSessionMs: 0,
    // Field value required by this payload or query.
    totalValidMsForTasks: 0,
    // Field value required by this payload or query.
    tasksWithValidTime: 0,
  };
}

/** Convert an accumulator + distinct-room set into API {@link CleaningResultsCounters}. */
export function finalizeCounters(
  // Carry this field through the payload or query.
  agg: ReturnType<typeof emptyCounters>,
  // Carry this field through the payload or query.
  roomSet: Set<string>,
// Begin block/object for the following statements.
): CleaningResultsCounters {
  // Convert accumulated ms into display minutes (1 decimal).
  const totalValidSessionMinutes = round1(agg.totalValidSessionMs / (1000 * 60));
  // Capture totalExcludedSessionMinutes for subsequent checks or writes.
  const totalExcludedSessionMinutes = round1(
    // Execute: agg.totalExcludedSessionMs / (1000 * 60),
    agg.totalExcludedSessionMs / (1000 * 60),
  );
  // Map accumulator fields onto the public counters DTO.
  return {
    // Carry this field through the payload or query.
    completedSessions: agg.completedSessions,
    // Carry this field through the payload or query.
    completedTasks: agg.completedTasks,
    // Carry this field through the payload or query.
    acceptedTasks: agg.acceptedTasks,
    // Carry this field through the payload or query.
    reworkEvents: agg.reworkEvents,
    // Carry this field through the payload or query.
    anomalousSessions: agg.anomalousSessions,
    // Distinct rooms come from the caller's Set (not the zeroed field).
    distinctRooms: roomSet.size,
    // Null when no sessions had a known dueAt for on-time scoring.
    onTimePct:
      // Execute: agg.onTimeKnown > 0
      agg.onTimeKnown > 0
        // Continue the previous expression with this clause.
        ? round1((agg.onTimeOk / agg.onTimeKnown) * 100)
        // Continue the previous expression with this clause.
        : null,
    // Average valid minutes per task that contributed valid session time.
    avgValidMinutes: avgValidMinutesFromTaskMs(
      // Execute: agg.totalValidMsForTasks,
      agg.totalValidMsForTasks,
      // Execute: agg.tasksWithValidTime,
      agg.tasksWithValidTime,
    ),
    // Carry this field through the payload or query.
    totalValidSessionMinutes,
    // Carry this field through the payload or query.
    totalExcludedSessionMinutes,
  };
}
