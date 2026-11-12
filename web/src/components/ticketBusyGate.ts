/**
 * Shared busy acquisition for ticket lifecycle actions.
 * Only the caller that acquired the lock may release it.
 */

export type BusyGate = {
  // Arrow function / callback body.
  begin: (id: string) => boolean;
  // Arrow function / callback body.
  end: (id: string) => void;
};

/**
 * Run `action` only after successfully beginning busy for `id`.
 * Returns `{ ran: false }` when begin is denied (no action / no end).
 */
export async function runWithBusyGate<T>(
  // Field/property in this shape.
  gate: BusyGate,
  // Field/property in this shape.
  id: string,
  // Arrow function / callback body.
  action: () => Promise<T>,
// Open multi-line construct.
): Promise<{ ran: false } | { ran: true; result: T }> {
  // Conditional branch for this case.
  if (!gate.begin(id)) {
    // Return computed result to caller.
    return { ran: false };
  }
  // Guard fallible work.
  try {
    // Local constant binding.
    const result = await action();
    // Return computed result to caller.
    return { ran: true, result };
  // Open multi-line construct.
  } finally {
    // Invoke helper or pass arguments.
    gate.end(id);
  }
}
