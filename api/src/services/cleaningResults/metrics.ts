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
  startedAt: Date;
  finishedAt: Date;
  anomalyFlags: unknown;
  anomalyThresholdMinutes: number;
}): boolean {
  // Explicit flags (e.g. overdue) always exclude the session from valid time.
  const flags = normalizeAnomalyFlags(input.anomalyFlags);
  if (flags.length > 0) return true;
  // Duration-based anomaly when the session ran too long.
  const durationMin =
    (input.finishedAt.getTime() - input.startedAt.getTime()) / 60000;
  return durationMin >= input.anomalyThresholdMinutes;
}

/** Split session duration into valid vs excluded (anomalous) minutes. */
export function sessionDurationBuckets(input: {
  startedAt: Date;
  finishedAt: Date;
  anomalyFlags: unknown;
  anomalyThresholdMinutes: number;
}): { anomalous: boolean; durationMs: number } {
  // Clamp negative clock skew to zero duration.
  const durationMs = Math.max(
    0,
    input.finishedAt.getTime() - input.startedAt.getTime(),
  );
  return {
    anomalous: isAnomalousSession(input),
    durationMs,
  };
}

/** Sum non-anomalous completed-session durations for a task (or session list). */
export function sumValidSessionMs(
  sessions: Array<{
    startedAt: Date;
    finishedAt: Date | null;
    anomalyFlags: unknown;
  }>,
  anomalyThresholdMinutes: number,
): number {
  return sessions.reduce((sum, s) => {
    // Open sessions contribute nothing until finished.
    if (!s.finishedAt) return sum;
    // Skip anomalous sessions entirely from the valid-time sum.
    if (
      isAnomalousSession({
        startedAt: s.startedAt,
        finishedAt: s.finishedAt,
        anomalyFlags: s.anomalyFlags,
        anomalyThresholdMinutes,
      })
    ) {
      return sum;
    }
    return (
      sum + Math.max(0, s.finishedAt.getTime() - s.startedAt.getTime())
    );
  }, 0);
}

/** Average valid minutes per completed task with valid session time. */
export function avgValidMinutesFromTaskMs(
  totalValidMsForTasks: number,
  tasksWithValidTime: number,
): number | null {
  // Null when no tasks contributed valid time (avoid divide-by-zero).
  return tasksWithValidTime > 0
    ? round1(totalValidMsForTasks / (1000 * 60) / tasksWithValidTime)
    : null;
}
