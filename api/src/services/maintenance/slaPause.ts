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
  ticket: { dueAt: Date | null; slaPausedAt: Date | null; slaPausedMsTotal: number },
  now = new Date(),
) {
  // Already unpaused — return fields unchanged (idempotent resume).
  if (!ticket.slaPausedAt) {
    return {
      slaPausedAt: null,
      slaPausedMsTotal: ticket.slaPausedMsTotal,
      dueAt: ticket.dueAt,
    };
  }
  // Duration of this wait interval (never negative if clocks skew).
  const pausedMs = Math.max(0, now.getTime() - ticket.slaPausedAt.getTime());
  // Slide dueAt forward so waiting does not burn SLA time.
  const dueAt =
    ticket.dueAt != null
      // Complete the ternary or optional chain started above.
      ? new Date(ticket.dueAt.getTime() + pausedMs)
      // Complete the ternary or optional chain started above.
      : ticket.dueAt;
  // Clear pause stamp and accumulate total paused ms for reporting.
  return {
    slaPausedAt: null,
    slaPausedMsTotal: ticket.slaPausedMsTotal + pausedMs,
    dueAt,
  };
}
