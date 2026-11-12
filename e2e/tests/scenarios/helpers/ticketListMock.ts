/**
 * Production Repairs/My Work clients request `paginated=1` and expect
 * `{ items, nextCursor, total }`. Legacy callers still receive a bare array.
 */
export type TicketListItem = Record<string, unknown>;

// Export helper ticketListResponse for reuse across related tests.
export function ticketListResponse(
  // Configure url for the request/server under test.
  url: string,
  // Execute the next setup or assertion step for this scenario.
  items: TicketListItem[],
  // Pagination step for list/contract coverage.
  extras?: { nextCursor?: string | null; total?: number },
// Pagination step for list/contract coverage.
): TicketListItem[] | { items: TicketListItem[]; nextCursor: string | null; total: number } {
  // Bind parsed for later setup or assertions in this scope.
  const parsed = new URL(url, "http://localhost");
  // Bind wantPage for later setup or assertions in this scope.
  const wantPage =
    // Pagination step for list/contract coverage.
    parsed.searchParams.has("cursor") ||
    // Pagination step for list/contract coverage.
    parsed.searchParams.get("paginated") === "1" ||
    // Pagination step for list/contract coverage.
    parsed.searchParams.get("paginated") === "true";
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (!wantPage) return items;
  // Return the arranged value/result to the caller.
  return {
    // Execute the next setup or assertion step for this scenario.
    items,
    // Pagination step for list/contract coverage.
    nextCursor: extras?.nextCursor ?? null,
    // Execute the next setup or assertion step for this scenario.
    total: extras?.total ?? items.length,
  };
}
