export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function asFlags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

export function isAnomalousSession(input: {
  startedAt: Date;
  finishedAt: Date;
  anomalyFlags: unknown;
  anomalyThresholdMinutes: number;
}): boolean {
  const flags = asFlags(input.anomalyFlags);
  if (flags.length > 0) return true;
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
    if (!s.finishedAt) return sum;
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
  return tasksWithValidTime > 0
    ? round1(totalValidMsForTasks / (1000 * 60) / tasksWithValidTime)
    : null;
}
