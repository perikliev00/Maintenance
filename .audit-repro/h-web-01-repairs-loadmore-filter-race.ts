/**
 * Audit repro H-WEB-01: RepairsPage loadMore has no requestRevision guard
 * (unlike locations/repairsPanelState.ts — see repairsPanelState.test.ts
 * "does not append or overwrite cursor when load-more finishes after a full reload").
 */
import assert from "node:assert/strict";

type Ticket = { id: string; title: string };

/** Mirrors RepairsPage/index.tsx refresh + loadMore (HEAD 2ec3f517). */
function createRepairsPageModel() {
  let tickets: Ticket[] = [];
  let nextCursor: string | null = null;
  let requestRevision = 0;

  async function refresh(
    fetchFirst: () => Promise<{ items: Ticket[]; nextCursor: string | null }>,
  ) {
    const revision = ++requestRevision;
    const page = await fetchFirst();
    if (revision !== requestRevision) return;
    tickets = page.items;
    nextCursor = page.nextCursor;
  }

  async function loadMore(
    fetchPage: (cursor: string) => Promise<{ items: Ticket[]; nextCursor: string | null }>,
  ) {
    if (!nextCursor) return;
    const page = await fetchPage(nextCursor);
    const seen = new Set(tickets.map((row) => row.id));
    tickets = [...tickets, ...page.items.filter((row) => !seen.has(row.id))];
    nextCursor = page.nextCursor;
  }

  return {
    getTickets: () => tickets,
    getCursor: () => nextCursor,
    refresh,
    loadMore,
    bumpRevisionOnUnmount: () => {
      requestRevision++;
    },
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function main() {
  const page = createRepairsPageModel();

  let filter: "open" | "resolved" = "open";

  const fetchFirst = async () => {
    if (filter === "open") {
      return {
        items: [{ id: "open-1", title: "Open A" }],
        nextCursor: "cursor-open",
      };
    }
    return {
      items: [{ id: "res-1", title: "Resolved Z" }],
      nextCursor: null,
    };
  };

  const more = deferred<{ items: Ticket[]; nextCursor: string | null }>();

  await page.refresh(fetchFirst);
  assert.deepEqual(
    page.getTickets().map((t) => t.id),
    ["open-1"],
  );

  const slowLoadMore = page.loadMore(async () => more.promise);

  filter = "resolved";
  await page.refresh(fetchFirst);

  more.resolve({
    items: [{ id: "open-2", title: "Open B (stale page)" }],
    nextCursor: null,
  });
  await slowLoadMore;

  const ids = page.getTickets().map((t) => t.id);
  console.log(
    JSON.stringify({
      filter,
      ticketIds: ids,
      mixedOpenIntoResolved: ids.includes("open-2") && ids.includes("res-1"),
    }),
  );

  assert.ok(
    ids.includes("open-2") && ids.includes("res-1"),
    "expected stale open-filter page appended after filter refresh",
  );
  console.log(
    "H-WEB-01 RESULT: STALE_LOAD_MORE_APPENDED — user sees wrong mixed list",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
