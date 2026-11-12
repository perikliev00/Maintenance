/**
 * SLA clock pause while a ticket is waiting (parts/guest delay, etc.).
 * Pause freezes breach detection; unpause pushes `dueAt` by the paused duration
 * so wait time does not consume SLA budget.
 */

/**
 * Mark SLA paused at `now` (applied when entering waiting).
 * Breach jobs skip tickets with a non-null `slaPausedAt`.
 */
export function pauseFieldsOnWait(now = new Date()) {
  // Only slaPausedAt — breach job skips tickets with a non-null pause stamp.
  return { slaPausedAt: now };
}

/**
 * Clear pause and accumulate paused ms into `slaPausedMsTotal`.
 * Extends `dueAt` by the pause interval so remaining SLA is preserved.
 * Idempotent when already unpaused (`slaPausedAt` is null).
 */
export function unpauseFields(
  // Set ticket on the structure being built.
  ticket: { dueAt: Date | null; slaPausedAt: Date | null; slaPausedMsTotal: number },
  // Update now as control flow progresses.
  now = new Date(),
// Run next step: ) {
) {
  // Already unpaused — return fields unchanged (idempotent resume).
  if (!ticket.slaPausedAt) {
    // Return the computed result to the caller.
    return {
      // Set slaPausedAt on the structure being built.
      slaPausedAt: null,
      // Set slaPausedMsTotal on the structure being built.
      slaPausedMsTotal: ticket.slaPausedMsTotal,
      // Set dueAt on the structure being built.
      dueAt: ticket.dueAt,
    };
  }
  // Duration of this wait interval (never negative if clocks skew).
  const pausedMs = Math.max(0, now.getTime() - ticket.slaPausedAt.getTime());
  // Slide dueAt forward so waiting does not burn SLA time.
  const dueAt =
    // Run next step: ticket.dueAt != null
    ticket.dueAt != null
      // Complete the ternary or optional chain started above.
      ? new Date(ticket.dueAt.getTime() + pausedMs)
      // Complete the ternary or optional chain started above.
      : ticket.dueAt;
  // Clear pause stamp and accumulate total paused ms for reporting.
  return {
    // Set slaPausedAt on the structure being built.
    slaPausedAt: null,
    // Set slaPausedMsTotal on the structure being built.
    slaPausedMsTotal: ticket.slaPausedMsTotal + pausedMs,
    // Run next step: dueAt,
    dueAt,
  };
}
