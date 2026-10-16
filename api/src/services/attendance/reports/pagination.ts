/**
 * Opaque cursor encode/decode and page-drain helpers for attendance lists.
 */
import { AppError } from "../../../errors";
import { LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT } from "./map";

/** Keyset cursor fields matching list orderBy (hotelDate, startedAt, id). */
export type IntervalCursor = {
  hotelDate: string;
  startedAt: string;
  id: string;
};

/** Encode cursor as base64url JSON for clients. */
export function encodeIntervalCursor(c: IntervalCursor): string {
  // Opaque to clients — do not parse fields except via decodeIntervalCursor.
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

/** Decode and validate a client cursor; throws 400 on malformed input. */
export function decodeIntervalCursor(raw: string): IntervalCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    ) as Partial<IntervalCursor>;
    // All three keyset fields are required strings.
    if (
      typeof parsed.hotelDate !== "string" ||
      typeof parsed.startedAt !== "string" ||
      typeof parsed.id !== "string"
    ) {
      throw new Error("invalid");
    }
    return {
      hotelDate: parsed.hotelDate,
      startedAt: parsed.startedAt,
      id: parsed.id,
    };
  } catch {
    // Malformed base64 / JSON / shape → single validation error for the API.
    throw new AppError(400, "validation", "Invalid attendance cursor");
  }
}

/** Clamp a requested list page size into [1, LIST_MAX_LIMIT]. */
export function resolveListLimit(requested?: number): number {
  // Default when omitted; floor at 1; cap at LIST_MAX_LIMIT.
  return Math.min(
    Math.max(1, requested ?? LIST_DEFAULT_LIMIT),
    LIST_MAX_LIMIT,
  );
}

/**
 * Slice a findMany result fetched with `take: limit + 1` into a page plus
 * opaque nextCursor. Used by listIntervals so pagination is unit-testable.
 */
export function listPageFromRows<T>(
  rows: T[],
  limit: number,
  toCursor: (row: T) => IntervalCursor,
): { pageRows: T[]; nextCursor: string | null; limit: number } {
  // Caller fetched take: limit+1; extra row signals another page.
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1];
  // nextCursor is null on the final page.
  const nextCursor =
    hasMore && last ? encodeIntervalCursor(toCursor(last)) : null;
  return { pageRows, nextCursor, limit };
}

/**
 * Drain all pages via cursor batches until exhausted or ceiling is hit.
 * Used by listIntervalsForExport so full CSV export is unit-testable.
 */
export async function drainExportPages<T>(opts: {
  batchSize: number;
  ceiling: number;
  fetchPage: (cursor: IntervalCursor | null) => Promise<T[]>;
  toCursor: (row: T) => IntervalCursor;
}): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  let cursor: IntervalCursor | null = null;
  for (;;) {
    // null cursor = first page; thereafter keyset from the last row.
    const batch = await opts.fetchPage(cursor);
    if (!batch.length) break;
    for (const row of batch) {
      rows.push(row);
    }
    // Short batch means no more pages.
    if (batch.length < opts.batchSize) break;
    const last = batch[batch.length - 1]!;
    cursor = opts.toCursor(last);
    // Hard ceiling protects memory on huge date ranges.
    if (rows.length >= opts.ceiling) {
      return { rows: rows.slice(0, opts.ceiling), truncated: true };
    }
  }
  return { rows, truncated: false };
}
