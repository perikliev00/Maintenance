import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MaintenanceTicket } from "../../api/client";
import {
  createRepairsListSession,
  isStaleGeneration,
  mergeTicketPages,
  runFullReload,
  runLoadMore,
  type TicketListPage,
} from "./repairsPanelState";

// Define function ticket and its behavior.
function ticket(id: string): MaintenanceTicket {
  return { id } as MaintenanceTicket;
}

// Define function page and its behavior.
function page(
  ids: string[],
  nextCursor: string | null = null,
  total?: number,
): TicketListPage {
  return {
    items: ids.map(ticket),
    nextCursor,
    total: total ?? ids.length,
  };
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err?: unknown) => void;
};

// Define function deferred and its behavior.
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("repairsPanelState", () => {
  it("merges pages without duplicating ids", () => {
    const page1 = [ticket("a"), ticket("b")];
    const page2 = [ticket("b"), ticket("c")];
    const merged = mergeTicketPages(page1, page2);
    assert.deepEqual(
      merged.map((t) => t.id),
      ["a", "b", "c"],
    );
  });

  it("ignores stale generations after location switch", () => {
    let generation = 1;
    const started = generation;
    generation += 1; // location changed
    assert.equal(isStaleGeneration(generation, started), true);
    assert.equal(isStaleGeneration(generation, generation), false);
  });

  it("supports loading more than one page (>100 via multiple merges)", () => {
    let all: MaintenanceTicket[] = [];
    for (let pageNum = 0; pageNum < 3; pageNum++) {
      const items = Array.from({ length: 50 }, (_, i) =>
        ticket(`t-${pageNum * 50 + i}`),
      );
      all = mergeTicketPages(all, items);
    }
    assert.equal(all.length, 150);
    assert.equal(all[149]?.id, "t-149");
  });
});

describe("createRepairsListSession races", () => {
  it("keeps the newer list when two full reloads finish out of order", async () => {
    const session = createRepairsListSession();
    const first = deferred<TicketListPage>();
    const second = deferred<TicketListPage>();
    let calls = 0;

    const fetchPage = () => {
      calls += 1;
      return calls === 1 ? first.promise : second.promise;
    };

    const older = runFullReload(session, fetchPage, () => "err");
    const newer = runFullReload(session, fetchPage, () => "err");

    second.resolve(page(["new-a", "new-b"], null, 2));
    await newer;
    assert.deepEqual(
      session.getState().tickets.map((t) => t.id),
      ["new-a", "new-b"],
    );

    first.resolve(page(["old-a"], null, 1));
    await older;
    assert.deepEqual(
      session.getState().tickets.map((t) => t.id),
      ["new-a", "new-b"],
    );
    assert.equal(session.getState().loading, false);
  });

  it("ignores stale success after a newer error", async () => {
    const session = createRepairsListSession();
    const first = deferred<TicketListPage>();
    const second = deferred<TicketListPage>();
    let calls = 0;
    const fetchPage = () => {
      calls += 1;
      return calls === 1 ? first.promise : second.promise;
    };

    const older = runFullReload(session, fetchPage, () => "err");
    const newer = runFullReload(session, fetchPage, (e) =>
      e instanceof Error ? e.message : "err",
    );

    second.reject(new Error("latest failure"));
    await newer;
    assert.equal(session.getState().loadError, "latest failure");
    assert.equal(session.getState().loading, false);

    first.resolve(page(["stale-ok"]));
    await older;
    assert.equal(session.getState().loadError, "latest failure");
    assert.deepEqual(session.getState().tickets, []);
  });

  it("ignores stale error after a newer success", async () => {
    const session = createRepairsListSession();
    const first = deferred<TicketListPage>();
    const second = deferred<TicketListPage>();
    let calls = 0;
    const fetchPage = () => {
      calls += 1;
      return calls === 1 ? first.promise : second.promise;
    };

    const older = runFullReload(session, fetchPage, (e) =>
      e instanceof Error ? e.message : "err",
    );
    const newer = runFullReload(session, fetchPage, () => "err");

    second.resolve(page(["fresh"]));
    await newer;
    assert.deepEqual(
      session.getState().tickets.map((t) => t.id),
      ["fresh"],
    );
    assert.equal(session.getState().loadError, null);

    first.reject(new Error("stale failure"));
    await older;
    assert.deepEqual(
      session.getState().tickets.map((t) => t.id),
      ["fresh"],
    );
    assert.equal(session.getState().loadError, null);
  });

  it("does not append or overwrite cursor when load-more finishes after a full reload", async () => {
    const session = createRepairsListSession();
    const full1 = deferred<TicketListPage>();
    const more = deferred<TicketListPage>();
    const full2 = deferred<TicketListPage>();
    let calls = 0;

    const fetchPage = (args: { cursor?: string | null }) => {
      calls += 1;
      if (calls === 1) return full1.promise;
      if (args.cursor) return more.promise;
      return full2.promise;
    };

    const firstReload = runFullReload(session, fetchPage, () => "err");
    // Invoke full1.resolve to perform this step.
    full1.resolve(page(["a", "b"], "cur-1", 4));
    await firstReload;
    assert.equal(session.getState().nextCursor, "cur-1");

    const loadMorePromise = runLoadMore(
      session,
      session.getState().nextCursor,
      fetchPage,
      () => "err",
    );
    assert.equal(session.isLoadMoreInFlight(), true);

    const secondReload = runFullReload(session, fetchPage, () => "err");
    assert.equal(session.getState().loading, true);
    assert.equal(session.getState().loadingMore, false);

    // Invoke full2.resolve to perform this step.
    full2.resolve(page(["x", "y"], "cur-2", 2));
    await secondReload;
    assert.deepEqual(
      session.getState().tickets.map((t) => t.id),
      ["x", "y"],
    );
    assert.equal(session.getState().nextCursor, "cur-2");
    assert.equal(session.getState().loading, false);

    more.resolve(page(["c", "d"], "cur-stale", 4));
    await loadMorePromise;
    assert.deepEqual(
      session.getState().tickets.map((t) => t.id),
      ["x", "y"],
    );
    assert.equal(session.getState().nextCursor, "cur-2");
    assert.equal(session.getState().loadingMore, false);
    assert.equal(session.getState().loading, false);
  });

  it("treats a second Load more as no-op while the first is in flight", async () => {
    const session = createRepairsListSession();
    const initial = deferred<TicketListPage>();
    const more = deferred<TicketListPage>();
    let fetchCalls = 0;

    const fetchPage = (args: { cursor?: string | null }) => {
      fetchCalls += 1;
      if (args.cursor) return more.promise;
      return initial.promise;
    };

    const reload = runFullReload(session, fetchPage, () => "err");
    initial.resolve(page(["a"], "next", 2));
    await reload;

    const firstMore = runLoadMore(session, "next", fetchPage, () => "err");
    const secondMore = await runLoadMore(session, "next", fetchPage, () => "err");
    assert.equal(secondMore, false);
    assert.equal(fetchCalls, 2); // 1 full + 1 load-more only

    more.resolve(page(["b"], null, 2));
    await firstMore;
    assert.deepEqual(
      session.getState().tickets.map((t) => t.id),
      ["a", "b"],
    );
  });

  it("ignores commits and further reloads after dispose", async () => {
    const session = createRepairsListSession();
    const pending = deferred<TicketListPage>();
    let fetches = 0;
    const fetchPage = () => {
      fetches += 1;
      return pending.promise;
    };

    const inFlight = runFullReload(session, fetchPage, () => "err");
    assert.equal(session.getState().loading, true);

    session.dispose();
    assert.equal(session.getState().loading, false);
    assert.deepEqual(session.getState().tickets, []);

    pending.resolve(page(["should-not-appear"]));
    await inFlight;
    assert.deepEqual(session.getState().tickets, []);
    assert.equal(session.getState().loading, false);

    // After dispose, a new beginFullReload is allowed (location remount reuse),
    // but a stale in-flight from before dispose must not win — already checked.
    // Simulate "onDone after dispose": caller must not call; if they do via a
    // fresh run, that is a new generation. Guard is in the panel (mountedRef).
    assert.equal(fetches, 1);
  });

  it("blocks load-more while a full reload is in flight", async () => {
    const session = createRepairsListSession();
    const pending = deferred<TicketListPage>();
    const fetchPage = () => pending.promise;

    // Fire-and-forget async work without awaiting in this path.
    void runFullReload(session, fetchPage, () => "err");
    const started = session.beginLoadMore("cursor-1");
    assert.equal(started, null);

    pending.resolve(page(["a"]));
  });
});
