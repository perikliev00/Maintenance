/** Anomaly threshold for long-running cleaning sessions (2× overdue setting). */
export function sessionAnomalyThresholdMinutes(
  // Param overdueSessionMinutes required by this function.
  overdueSessionMinutes: number,
): number {
  // Return computed result.
  return overdueSessionMinutes * 2;
}

// Exported helper sessionElapsedFlags.
export function sessionElapsedFlags(
  // Param elapsedMinutes required by this function.
  elapsedMinutes: number,
  // Param overdueSessionMinutes required by this function.
  overdueSessionMinutes: number,
// Support the surrounding control flow.
): { overdue: boolean; anomaly: boolean } {
  // Local anomalyThreshold used below.
  const anomalyThreshold = sessionAnomalyThresholdMinutes(overdueSessionMinutes);
  // Return response object.
  return {
    // Set overdue.
    overdue: elapsedMinutes >= overdueSessionMinutes,
    // Set anomaly.
    anomaly: elapsedMinutes >= anomalyThreshold,
  };
}
