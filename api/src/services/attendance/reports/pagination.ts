/**
 * Opaque cursor encode/decode and page-drain helpers for attendance lists.
 */
import { AppError } from "../../../errors";
// Runtime import from ../../cursorCodec.
import { decodeBase64UrlJson, encodeBase64UrlJson } from "../../cursorCodec";
// Runtime import from ./map.
import { LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT } from "./map";

/** Keyset cursor fields matching list orderBy (hotelDate, startedAt, id). */
export type IntervalCursor = {
  // Time field hotelDate.
  hotelDate: string;
  // Time field startedAt.
  startedAt: string;
  // Field id on this type/payload.
  id: string;
};

/** Encode cursor as base64url JSON for clients. */
export function encodeIntervalCursor(c: IntervalCursor): string {
  // Opaque to clients — do not parse fields except via decodeIntervalCursor.
  return encodeBase64UrlJson(c);
}

/** Decode and validate a client cursor; throws 400 on malformed input. */
export function decodeIntervalCursor(raw: string): IntervalCursor {
  // Catch locally so callers get mapped errors.
  try {
    // Local parsed used below.
    const parsed = decodeBase64UrlJson(raw) as Partial<IntervalCursor>;
    // All three keyset fields are required strings.
    if (
      // Additional clause in this boolean decision.
      typeof parsed.hotelDate !== "string" ||
      // Additional clause in this boolean decision.
      typeof parsed.startedAt !== "string" ||
      // Support the surrounding control flow.
      typeof parsed.id !== "string"
    ) {
      // Abort with an error.
      throw new Error("invalid");
    }
    // Return response object.
    return {
      // Compute hotelDate for the payload.
      hotelDate: parsed.hotelDate,
      // Set startedAt.
      startedAt: parsed.startedAt,
      // Set id.
      id: parsed.id,
    };
  // Support the surrounding control flow.
  } catch {
    // Malformed base64 / JSON / shape → single validation error for the API.
    throw new AppError(400, "validation", "Invalid attendance cursor");
  }
}

/** Clamp a requested list page size into [1, LIST_MAX_LIMIT]. */
export function resolveListLimit(requested?: number): number {
  // Default when omitted; floor at 1; cap at LIST_MAX_LIMIT.
  return Math.min(
    // Support the surrounding control flow.
    Math.max(1, requested ?? LIST_DEFAULT_LIMIT),
    LIST_MAX_LIMIT,
  );
}

/**
 * Slice a findMany result fetched with `take: limit + 1` into a page plus
 * opaque nextCursor. Used by listIntervals so pagination is unit-testable.
 */
export function listPageFromRows<T>(
  // Param rows required by this function.
  rows: T[],
  // Param limit required by this function.
  limit: number,
  // Param toCursor required by this function.
  toCursor: (row: T) => IntervalCursor,
// Support the surrounding control flow.
): { pageRows: T[]; nextCursor: string | null; limit: number } {
  // Caller fetched take: limit+1; extra row signals another page.
  const hasMore = rows.length > limit;
  // Local pageRows used below.
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  // Local last used below.
  const last = pageRows[pageRows.length - 1];
  // nextCursor is null on the final page.
  const nextCursor =
    // Support the surrounding control flow.
    hasMore && last ? encodeIntervalCursor(toCursor(last)) : null;
  // Return response object.
  return { pageRows, nextCursor, limit };
}

/**
 * Drain all pages via cursor batches until exhausted or ceiling is hit.
 * Used by listIntervalsForExport so full CSV export is unit-testable.
 */
export async function drainExportPages<T>(opts: {
  // Param batchSize required by this function.
  batchSize: number;
  // Param ceiling required by this function.
  ceiling: number;
  // Param fetchPage required by this function.
  fetchPage: (cursor: IntervalCursor | null) => Promise<T[]>;
  // Param toCursor required by this function.
  toCursor: (row: T) => IntervalCursor;
// Support the surrounding control flow.
}): Promise<{ rows: T[]; truncated: boolean }> {
  // Accumulator list rows.
  const rows: T[] = [];
  // Nullable cursor until resolved.
  let cursor: IntervalCursor | null = null;
  // Indexed/looped processing.
  for (;;) {
    // null cursor = first page; thereafter keyset from the last row.
    const batch = await opts.fetchPage(cursor);
    // Threshold/size gate.
    if (!batch.length) break;
    // Iterate items for aggregation or writes.
    for (const row of batch) {
      // Support the surrounding control flow.
      rows.push(row);
    }
    // Short batch means no more pages.
    if (batch.length < opts.batchSize) break;
    // Local last used below.
    const last = batch[batch.length - 1]!;
    // Assign cursor.
    cursor = opts.toCursor(last);
    // Hard ceiling protects memory on huge date ranges.
    if (rows.length >= opts.ceiling) {
      // Return response object.
      return { rows: rows.slice(0, opts.ceiling), truncated: true };
    }
  }
  // Return response object.
  return { rows, truncated: false };
}
