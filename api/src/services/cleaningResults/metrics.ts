/**
 * Session-duration anomaly detection and valid-time aggregation for reports.
 * A session is anomalous if it has flags or duration ≥ the threshold.
 */

/** Round to one decimal place for display-stable minute KPIs. */
export function round1(n: number): number {
  // Half-up via Math.round on tenths (avoids long float display noise).
  return Math.round(n * 10) / 10;
}

/** Coerce JSON anomalyFlags to a string array (empty if malformed). */
export function normalizeAnomalyFlags(value: unknown): string[] {
  // Non-arrays (null, objects, scalars) are treated as no flags.
  if (!Array.isArray(value)) return [];
  // Drop non-string entries that may appear in loosely typed JSON.
  return value.filter((v): v is string => typeof v === "string");
}

/** True when anomalyFlags is non-empty or duration meets/exceeds the threshold. */
export function isAnomalousSession(input: {
  // Carry this field through the payload or query.
  startedAt: Date;
  // Carry this field through the payload or query.
  finishedAt: Date;
  // Carry this field through the payload or query.
  anomalyFlags: unknown;
  // Carry this field through the payload or query.
  anomalyThresholdMinutes: number;
// Begin block/object for the following statements.
}): boolean {
  // Explicit flags (e.g. overdue) always exclude the session from valid time.
  const flags = normalizeAnomalyFlags(input.anomalyFlags);
  // Branch when this condition holds for the domain rule.
  if (flags.length > 0) return true;
  // Duration-based anomaly when the session ran too long.
  const durationMin =
    // Execute: (input.finishedAt.getTime() - input.startedAt.getTime()) / 60000;
    (input.finishedAt.getTime() - input.startedAt.getTime()) / 60000;
  // Return the computed result to the caller.
  return durationMin >= input.anomalyThresholdMinutes;
}

/** Split session duration into valid vs excluded (anomalous) minutes. */
export function sessionDurationBuckets(input: {
  // Carry this field through the payload or query.
  startedAt: Date;
  // Carry this field through the payload or query.
  finishedAt: Date;
  // Carry this field through the payload or query.
  anomalyFlags: unknown;
  // Carry this field through the payload or query.
  anomalyThresholdMinutes: number;
// Begin block/object for the following statements.
}): { anomalous: boolean; durationMs: number } {
  // Clamp negative clock skew to zero duration.
  const durationMs = Math.max(
    // Execute: 0,
    0,
    // Execute: input.finishedAt.getTime() - input.startedAt.getTime(),
    input.finishedAt.getTime() - input.startedAt.getTime(),
  );
  // Return the computed result to the caller.
  return {
    // Carry this field through the payload or query.
    anomalous: isAnomalousSession(input),
    // Carry this field through the payload or query.
    durationMs,
  };
}

/** Sum non-anomalous completed-session durations for a task (or session list). */
export function sumValidSessionMs(
  // Open nested structure for the next related fields.
  sessions: Array<{
    // Carry this field through the payload or query.
    startedAt: Date;
    // Field value required by this payload or query.
    finishedAt: Date | null;
    // Carry this field through the payload or query.
    anomalyFlags: unknown;
  // Execute: }>,
  }>,
  // Carry this field through the payload or query.
  anomalyThresholdMinutes: number,
// Begin block/object for the following statements.
): number {
  // Return the computed result to the caller.
  return sessions.reduce((sum, s) => {
    // Open sessions contribute nothing until finished.
    if (!s.finishedAt) return sum;
    // Skip anomalous sessions entirely from the valid-time sum.
    if (
      // Begin block/object for the following statements.
      isAnomalousSession({
        // Carry this field through the payload or query.
        startedAt: s.startedAt,
        // Carry this field through the payload or query.
        finishedAt: s.finishedAt,
        // Carry this field through the payload or query.
        anomalyFlags: s.anomalyFlags,
        // Carry this field through the payload or query.
        anomalyThresholdMinutes,
      })
    // Begin block/object for the following statements.
    ) {
      // Return the computed result to the caller.
      return sum;
    }
    // Return the computed result to the caller.
    return (
      // Execute: sum + Math.max(0, s.finishedAt.getTime() - s.startedAt.getTime())
      sum + Math.max(0, s.finishedAt.getTime() - s.startedAt.getTime())
    );
  // Execute: }, 0);
  }, 0);
}

/** Average valid minutes per completed task with valid session time. */
export function avgValidMinutesFromTaskMs(
  // Carry this field through the payload or query.
  totalValidMsForTasks: number,
  // Carry this field through the payload or query.
  tasksWithValidTime: number,
// Begin block/object for the following statements.
): number | null {
  // Null when no tasks contributed valid time (avoid divide-by-zero).
  return tasksWithValidTime > 0
    // Continue the previous expression with this clause.
    ? round1(totalValidMsForTasks / (1000 * 60) / tasksWithValidTime)
    // Continue the previous expression with this clause.
    : null;
}
