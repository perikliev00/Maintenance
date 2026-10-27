/**
 * Opaque keyset cursors for maintenance ticket list pagination.
 * Sort keys match listMaintenanceTickets orderBy (openedAt|resolvedAt, id).
 */
import { AppError } from "../../errors";

export type TicketSortKey = "openedAt" | "resolvedAt";

export type TicketListCursor = {
  sort: TicketSortKey;
  at: Date;
  id: string;
};

/** Encode a page-boundary cursor as base64url JSON. */
export function encodeTicketListCursor(cursor: TicketListCursor): string {
  return Buffer.from(
    JSON.stringify([cursor.sort, cursor.at.toISOString(), cursor.id]),
  ).toString("base64url");
}

/** Decode and validate a client cursor; throws 400 on malformed input. */
export function decodeTicketListCursor(cursor: string): TicketListCursor {
  try {
    if (cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
      throw new Error();
    }
    const value: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
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
