/**
 * Production Repairs/My Work clients request `paginated=1` and expect
 * `{ items, nextCursor, total }`. Legacy callers still receive a bare array.
 */
export type TicketListItem = Record<string, unknown>;

export function ticketListResponse(
  url: string,
  items: TicketListItem[],
  extras?: { nextCursor?: string | null; total?: number },
): TicketListItem[] | { items: TicketListItem[]; nextCursor: string | null; total: number } {
  const parsed = new URL(url, "http://localhost");
  const wantPage =
    parsed.searchParams.has("cursor") ||
    parsed.searchParams.get("paginated") === "1" ||
    parsed.searchParams.get("paginated") === "true";
  if (!wantPage) return items;
  return {
    items,
    nextCursor: extras?.nextCursor ?? null,
    total: extras?.total ?? items.length,
  };
}
