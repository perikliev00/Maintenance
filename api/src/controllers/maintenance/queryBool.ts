/**
 * Ticket-list query flag parsers (local to maintenance controllers).
 * Not a shared HTTP query framework.
 */

/** Truthy query flags: "1" | "true" | "yes". */
export function queryTruthy(v: unknown): boolean {
  return v === "1" || v === "true" || v === "yes";
}

/** Tri-state bool query: true / false / omit. */
export function queryTriBool(v: unknown): boolean | undefined {
  if (v === "1" || v === "true") return true;
  if (v === "0" || v === "false") return false;
  return undefined;
}
