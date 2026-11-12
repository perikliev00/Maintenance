/**
 * Pipe-format cursors for operations live attention pagination (`ISO|id`).
 * Intentionally not base64url JSON — keep wire format stable for clients.
 */

export function encodeCursor(dueOrUpdatedAt: Date, id: string): string {
  return `${dueOrUpdatedAt.toISOString()}|${id}`;
}

export function decodeCursor(cursor: string | null | undefined): {
  at: Date;
  id: string;
} | null {
  if (!cursor) return null;
  const sep = cursor.indexOf("|");
  if (sep <= 0) return null;
  const at = new Date(cursor.slice(0, sep));
  const id = cursor.slice(sep + 1);
  if (Number.isNaN(at.getTime()) || !id) return null;
  return { at, id };
}
