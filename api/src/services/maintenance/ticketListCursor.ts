/**
 * Opaque keyset cursors for maintenance ticket list pagination.
 * Sort keys match listMaintenanceTickets orderBy (openedAt|resolvedAt, id).
 */
import { AppError } from "../../errors";
import { decodeBase64UrlJson, encodeBase64UrlJson } from "../cursorCodec";

export type TicketSortKey = "openedAt" | "resolvedAt";

export type TicketListCursor = {
  sort: TicketSortKey;
  at: Date;
  id: string;
};

/** Encode a page-boundary cursor as base64url JSON. */
export function encodeTicketListCursor(cursor: TicketListCursor): string {
  return encodeBase64UrlJson([
    cursor.sort,
    cursor.at.toISOString(),
    cursor.id,
  ]);
}

/** Decode and validate a client cursor; throws 400 on malformed input. */
export function decodeTicketListCursor(cursor: string): TicketListCursor {
  try {
    const value = decodeBase64UrlJson(cursor);
    if (
      !Array.isArray(value) ||
      value.length !== 3 ||
      (value[0] !== "openedAt" && value[0] !== "resolvedAt") ||
      typeof value[1] !== "string" ||
      typeof value[2] !== "string" ||
      !value[2] ||
      Number.isNaN(new Date(value[1]).getTime())
    ) {
      throw new Error();
    }
    return {
      sort: value[0],
      at: new Date(value[1]),
      id: value[2],
    };
  } catch {
    throw new AppError(400, "validation", "Invalid ticket list cursor");
  }
}
