/**
 * Opaque keyset cursors for maintenance ticket list pagination.
 * Sort keys match listMaintenanceTickets orderBy (openedAt|resolvedAt, id).
 */
import { AppError } from "../../errors";
// Import module ../cursorCodec for this service.
import { decodeBase64UrlJson, encodeBase64UrlJson } from "../cursorCodec";

// Declare type TicketSortKey for callers and internals.
export type TicketSortKey = "openedAt" | "resolvedAt";

// Declare type TicketListCursor for callers and internals.
export type TicketListCursor = {
  // Set sort on the structure being built.
  sort: TicketSortKey;
  // Set at on the structure being built.
  at: Date;
  // Set id on the structure being built.
  id: string;
};

/** Encode a page-boundary cursor as base64url JSON. */
export function encodeTicketListCursor(cursor: TicketListCursor): string {
  // Return the computed result to the caller.
  return encodeBase64UrlJson([
    // Run next step: cursor.sort,
    cursor.sort,
    // Run next step: cursor.at.toISOString(),
    cursor.at.toISOString(),
    // Run next step: cursor.id,
    cursor.id,
  ]);
}

/** Decode and validate a client cursor; throws 400 on malformed input. */
export function decodeTicketListCursor(cursor: string): TicketListCursor {
  // Attempt the fallible work so errors can be handled below.
  try {
    // Capture value for use in this scope.
    const value = decodeBase64UrlJson(cursor);
    // Branch when this condition holds so the right path runs.
    if (
      // Run next step: !Array.isArray(value) ||
      !Array.isArray(value) ||
      // Run next step: value.length !== 3 ||
      value.length !== 3 ||
      // Run next step: (value[0] !== "openedAt" && value[0] !== "resolvedAt") ||
      (value[0] !== "openedAt" && value[0] !== "resolvedAt") ||
      // Run next step: typeof value[1] !== "string" ||
      typeof value[1] !== "string" ||
      // Run next step: typeof value[2] !== "string" ||
      typeof value[2] !== "string" ||
      // Run next step: !value[2] ||
      !value[2] ||
      // Run next step: Number.isNaN(new Date(value[1]).getTime())
      Number.isNaN(new Date(value[1]).getTime())
    // Run next step: ) {
    ) {
      // Abort with an error so callers can react.
      throw new Error();
    }
    // Return the computed result to the caller.
    return {
      // Set sort on the structure being built.
      sort: value[0],
      // Set at on the structure being built.
      at: new Date(value[1]),
      // Set id on the structure being built.
      id: value[2],
    };
  // Run next step: } catch {
  } catch {
    // Abort with an error so callers can react.
    throw new AppError(400, "validation", "Invalid ticket list cursor");
  }
}
