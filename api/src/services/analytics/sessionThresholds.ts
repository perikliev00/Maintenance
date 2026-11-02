/** Anomaly threshold for long-running cleaning sessions (2× overdue setting). */
export function sessionAnomalyThresholdMinutes(
  overdueSessionMinutes: number,
): number {
  return overdueSessionMinutes * 2;
}

export function sessionElapsedFlags(
  elapsedMinutes: number,
  overdueSessionMinutes: number,
): { overdue: boolean; anomaly: boolean } {
  const anomalyThreshold = sessionAnomalyThresholdMinutes(overdueSessionMinutes);
  return {
    overdue: elapsedMinutes >= overdueSessionMinutes,
    anomaly: elapsedMinutes >= anomalyThreshold,
  };
}
