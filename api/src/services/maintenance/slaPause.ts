export function pauseFieldsOnWait(now = new Date()) {
  return { slaPausedAt: now };
}

export function unpauseFields(
  ticket: { dueAt: Date | null; slaPausedAt: Date | null; slaPausedMsTotal: number },
  now = new Date(),
) {
  if (!ticket.slaPausedAt) {
    return {
      slaPausedAt: null,
      slaPausedMsTotal: ticket.slaPausedMsTotal,
      dueAt: ticket.dueAt,
    };
  }
  const pausedMs = Math.max(0, now.getTime() - ticket.slaPausedAt.getTime());
  const dueAt =
    ticket.dueAt != null
      ? new Date(ticket.dueAt.getTime() + pausedMs)
      : ticket.dueAt;
  return {
    slaPausedAt: null,
    slaPausedMsTotal: ticket.slaPausedMsTotal + pausedMs,
    dueAt,
  };
}
