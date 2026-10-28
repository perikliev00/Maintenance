/**
 * Shared busy acquisition for ticket lifecycle actions.
 * Only the caller that acquired the lock may release it.
 */

export type BusyGate = {
  begin: (id: string) => boolean;
  end: (id: string) => void;
};

/**
 * Run `action` only after successfully beginning busy for `id`.
 * Returns `{ ran: false }` when begin is denied (no action / no end).
 */
export async function runWithBusyGate<T>(
  gate: BusyGate,
  id: string,
  action: () => Promise<T>,
): Promise<{ ran: false } | { ran: true; result: T }> {
  if (!gate.begin(id)) {
    return { ran: false };
  }
  try {
    const result = await action();
    return { ran: true, result };
  } finally {
    gate.end(id);
  }
}
