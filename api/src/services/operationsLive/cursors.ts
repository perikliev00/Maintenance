/**
 * Pipe-format cursors for operations live attention pagination (`ISO|id`).
 * Intentionally not base64url JSON — keep wire format stable for clients.
 */

export function encodeCursor(dueOrUpdatedAt: Date, id: string): string {
  // Return the computed result to the caller.
  return `${dueOrUpdatedAt.toISOString()}|${id}`;
}

// Define decodeCursor — core behavior for this module.
export function decodeCursor(cursor: string | null | undefined): {
  // Set at on the structure being built.
  at: Date;
  // Set id on the structure being built.
  id: string;
// Run next step: } | null {
} | null {
  // Branch when this condition holds so the right path runs.
  if (!cursor) return null;
  // Capture sep for use in this scope.
  const sep = cursor.indexOf("|");
  // Branch when this condition holds so the right path runs.
  if (sep <= 0) return null;
  // Capture at for use in this scope.
  const at = new Date(cursor.slice(0, sep));
  // Capture id for use in this scope.
  const id = cursor.slice(sep + 1);
  // Branch when this condition holds so the right path runs.
  if (Number.isNaN(at.getTime()) || !id) return null;
  // Return the computed result to the caller.
  return { at, id };
}
