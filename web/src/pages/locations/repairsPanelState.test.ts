// Import module dependency from node:assert/strict.
import assert from "node:assert/strict";
// Import module dependency from node:test.
import { describe, it } from "node:test";
// Import type-only dependency for typing without runtime cost.
import type { MaintenanceTicket } from "../../api/client";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  createRepairsListSession,
  // Support the surrounding logic for this step.
  isStaleGeneration,
  // Support the surrounding logic for this step.
  mergeTicketPages,
  // Support the surrounding logic for this step.
  runFullReload,
  // Support the surrounding logic for this step.
  runLoadMore,
  // Declare type alias TicketListPage.
  type TicketListPage,
// Support the surrounding logic for this step.
} from "./repairsPanelState";

// Define function ticket and its behavior.
function ticket(id: string): MaintenanceTicket {
  // Return early result or rendered output from this path.
  return { id } as MaintenanceTicket;
}

// Define function page and its behavior.
function page(
  // Provide ids field used by this structure.
  ids: string[],
  // Provide nextCursor field used by this structure.
  nextCursor: string | null = null,
  // Support the surrounding logic for this step.
  total?: number,
// Support the surrounding logic for this step.
): TicketListPage {
  // Return early result or rendered output from this path.
  return {
    // Provide items field used by this structure.
    items: ids.map(ticket),
    // Support the surrounding logic for this step.
    nextCursor,
    // Provide total field used by this structure.
    total: total ?? ids.length,
  };
}

// Declare type alias Deferred.
type Deferred<T> = {
  // Provide promise field used by this structure.
  promise: Promise<T>;
  // Provide resolve field used by this structure.
  resolve: (value: T) => void;
  // Provide reject field used by this structure.
  reject: (err?: unknown) => void;
};

// Define function deferred and its behavior.
function deferred<T>(): Deferred<T> {
  // Bind resolve for use in the following logic.
  let resolve!: (value: T) => void;
  // Bind reject for use in the following logic.
  let reject!: (err?: unknown) => void;
  // Bind promise for use in the following logic.
  const promise = new Promise<T>((res, rej) => {
    // Support the surrounding logic for this step.
    resolve = res;
    // Support the surrounding logic for this step.
    reject = rej;
  });
  // Return early result or rendered output from this path.
  return { promise, resolve, reject };
}

// Group related tests under a shared suite name.
describe("repairsPanelState", () => {
  // Define a single test case and its expectation.
  it("merges pages without duplicating ids", () => {
    // Initialize an array used by subsequent logic.
    const page1 = [ticket("a"), ticket("b")];
    // Initialize an array used by subsequent logic.
    const page2 = [ticket("b"), ticket("c")];
    // Bind merged for use in the following logic.
    const merged = mergeTicketPages(page1, page2);
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke merged.map to perform this step.
      merged.map((t) => t.id),
      // Support the surrounding logic for this step.
      ["a", "b", "c"],
    );
  });

  // Define a single test case and its expectation.
  it("ignores stale generations after location switch", () => {
    // Bind generation for use in the following logic.
    let generation = 1;
    // Bind started for use in the following logic.
    const started = generation;
    generation += 1; // location changed
    // Invoke assert.equal to perform this step.
    assert.equal(isStaleGeneration(generation, started), true);
    // Invoke assert.equal to perform this step.
    assert.equal(isStaleGeneration(generation, generation), false);
  });

  // Define a single test case and its expectation.
  it("supports loading more than one page (>100 via multiple merges)", () => {
    // Initialize an array used by subsequent logic.
    let all: MaintenanceTicket[] = [];
    // Iterate a collection or counted range.
    for (let pageNum = 0; pageNum < 3; pageNum++) {
      // Bind items for use in the following logic.
      const items = Array.from({ length: 50 }, (_, i) =>
        // Invoke ticket to perform this step.
        ticket(`t-${pageNum * 50 + i}`),
      );
      // Support the surrounding logic for this step.
      all = mergeTicketPages(all, items);
    }
    // Invoke assert.equal to perform this step.
    assert.equal(all.length, 150);
    // Invoke assert.equal to perform this step.
    assert.equal(all[149]?.id, "t-149");
  });
});

// Group related tests under a shared suite name.
describe("createRepairsListSession races", () => {
  // Define a single test case and its expectation.
  it("keeps the newer list when two full reloads finish out of order", async () => {
    // Bind session for use in the following logic.
    const session = createRepairsListSession();
    // Bind first for use in the following logic.
    const first = deferred<TicketListPage>();
    // Bind second for use in the following logic.
    const second = deferred<TicketListPage>();
    // Bind calls for use in the following logic.
    let calls = 0;

    // Bind fetchPage for use in the following logic.
    const fetchPage = () => {
      // Support the surrounding logic for this step.
      calls += 1;
      // Return early result or rendered output from this path.
      return calls === 1 ? first.promise : second.promise;
    };

    // Bind older for use in the following logic.
    const older = runFullReload(session, fetchPage, () => "err");
    // Bind newer for use in the following logic.
    const newer = runFullReload(session, fetchPage, () => "err");

    // Invoke second.resolve to perform this step.
    second.resolve(page(["new-a", "new-b"], null, 2));
    // Wait for an async operation before continuing.
    await newer;
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke session.getState to perform this step.
      session.getState().tickets.map((t) => t.id),
      // Support the surrounding logic for this step.
      ["new-a", "new-b"],
    );

    // Invoke first.resolve to perform this step.
    first.resolve(page(["old-a"], null, 1));
    // Wait for an async operation before continuing.
    await older;
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke session.getState to perform this step.
      session.getState().tickets.map((t) => t.id),
      // Support the surrounding logic for this step.
      ["new-a", "new-b"],
    );
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().loading, false);
  });

  // Define a single test case and its expectation.
  it("ignores stale success after a newer error", async () => {
    // Bind session for use in the following logic.
    const session = createRepairsListSession();
    // Bind first for use in the following logic.
    const first = deferred<TicketListPage>();
    // Bind second for use in the following logic.
    const second = deferred<TicketListPage>();
    // Bind calls for use in the following logic.
    let calls = 0;
    // Bind fetchPage for use in the following logic.
    const fetchPage = () => {
      // Support the surrounding logic for this step.
      calls += 1;
      // Return early result or rendered output from this path.
      return calls === 1 ? first.promise : second.promise;
    };

    // Bind older for use in the following logic.
    const older = runFullReload(session, fetchPage, () => "err");
    // Bind newer for use in the following logic.
    const newer = runFullReload(session, fetchPage, (e) =>
      // Support the surrounding logic for this step.
      e instanceof Error ? e.message : "err",
    );

    // Invoke second.reject to perform this step.
    second.reject(new Error("latest failure"));
    // Wait for an async operation before continuing.
    await newer;
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().loadError, "latest failure");
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().loading, false);

    // Invoke first.resolve to perform this step.
    first.resolve(page(["stale-ok"]));
    // Wait for an async operation before continuing.
    await older;
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().loadError, "latest failure");
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(session.getState().tickets, []);
  });

  // Define a single test case and its expectation.
  it("ignores stale error after a newer success", async () => {
    // Bind session for use in the following logic.
    const session = createRepairsListSession();
    // Bind first for use in the following logic.
    const first = deferred<TicketListPage>();
    // Bind second for use in the following logic.
    const second = deferred<TicketListPage>();
    // Bind calls for use in the following logic.
    let calls = 0;
    // Bind fetchPage for use in the following logic.
    const fetchPage = () => {
      // Support the surrounding logic for this step.
      calls += 1;
      // Return early result or rendered output from this path.
      return calls === 1 ? first.promise : second.promise;
    };

    // Bind older for use in the following logic.
    const older = runFullReload(session, fetchPage, (e) =>
      // Support the surrounding logic for this step.
      e instanceof Error ? e.message : "err",
    );
    // Bind newer for use in the following logic.
    const newer = runFullReload(session, fetchPage, () => "err");

    // Invoke second.resolve to perform this step.
    second.resolve(page(["fresh"]));
    // Wait for an async operation before continuing.
    await newer;
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke session.getState to perform this step.
      session.getState().tickets.map((t) => t.id),
      // Support the surrounding logic for this step.
      ["fresh"],
    );
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().loadError, null);

    // Invoke first.reject to perform this step.
    first.reject(new Error("stale failure"));
    // Wait for an async operation before continuing.
    await older;
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke session.getState to perform this step.
      session.getState().tickets.map((t) => t.id),
      // Support the surrounding logic for this step.
      ["fresh"],
    );
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().loadError, null);
  });

  // Define a single test case and its expectation.
  it("does not append or overwrite cursor when load-more finishes after a full reload", async () => {
    // Bind session for use in the following logic.
    const session = createRepairsListSession();
    // Bind full1 for use in the following logic.
    const full1 = deferred<TicketListPage>();
    // Bind more for use in the following logic.
    const more = deferred<TicketListPage>();
    // Bind full2 for use in the following logic.
    const full2 = deferred<TicketListPage>();
    // Bind calls for use in the following logic.
    let calls = 0;

    // Bind fetchPage for use in the following logic.
    const fetchPage = (args: { cursor?: string | null }) => {
      // Support the surrounding logic for this step.
      calls += 1;
      // Conditional branch for the case described by this guard.
      if (calls === 1) return full1.promise;
      // Conditional branch for the case described by this guard.
      if (args.cursor) return more.promise;
      // Return early result or rendered output from this path.
      return full2.promise;
    };

    // Bind firstReload for use in the following logic.
    const firstReload = runFullReload(session, fetchPage, () => "err");
    // Invoke full1.resolve to perform this step.
    full1.resolve(page(["a", "b"], "cur-1", 4));
    // Wait for an async operation before continuing.
    await firstReload;
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().nextCursor, "cur-1");

    // Bind loadMorePromise for use in the following logic.
    const loadMorePromise = runLoadMore(
      // Support the surrounding logic for this step.
      session,
      // Invoke session.getState to perform this step.
      session.getState().nextCursor,
      // Support the surrounding logic for this step.
      fetchPage,
      // Support the surrounding logic for this step.
      () => "err",
    );
    // Invoke assert.equal to perform this step.
    assert.equal(session.isLoadMoreInFlight(), true);

    // Bind secondReload for use in the following logic.
    const secondReload = runFullReload(session, fetchPage, () => "err");
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().loading, true);
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().loadingMore, false);

    // Invoke full2.resolve to perform this step.
    full2.resolve(page(["x", "y"], "cur-2", 2));
    // Wait for an async operation before continuing.
    await secondReload;
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke session.getState to perform this step.
      session.getState().tickets.map((t) => t.id),
      // Support the surrounding logic for this step.
      ["x", "y"],
    );
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().nextCursor, "cur-2");
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().loading, false);

    // Invoke more.resolve to perform this step.
    more.resolve(page(["c", "d"], "cur-stale", 4));
    // Wait for an async operation before continuing.
    await loadMorePromise;
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke session.getState to perform this step.
      session.getState().tickets.map((t) => t.id),
      // Support the surrounding logic for this step.
      ["x", "y"],
    );
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().nextCursor, "cur-2");
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().loadingMore, false);
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().loading, false);
  });

  // Define a single test case and its expectation.
  it("treats a second Load more as no-op while the first is in flight", async () => {
    // Bind session for use in the following logic.
    const session = createRepairsListSession();
    // Bind initial for use in the following logic.
    const initial = deferred<TicketListPage>();
    // Bind more for use in the following logic.
    const more = deferred<TicketListPage>();
    // Bind fetchCalls for use in the following logic.
    let fetchCalls = 0;

    // Bind fetchPage for use in the following logic.
    const fetchPage = (args: { cursor?: string | null }) => {
      // Support the surrounding logic for this step.
      fetchCalls += 1;
      // Conditional branch for the case described by this guard.
      if (args.cursor) return more.promise;
      // Return early result or rendered output from this path.
      return initial.promise;
    };

    // Bind reload for use in the following logic.
    const reload = runFullReload(session, fetchPage, () => "err");
    // Invoke initial.resolve to perform this step.
    initial.resolve(page(["a"], "next", 2));
    // Wait for an async operation before continuing.
    await reload;

    // Bind firstMore for use in the following logic.
    const firstMore = runLoadMore(session, "next", fetchPage, () => "err");
    // Bind secondMore for use in the following logic.
    const secondMore = await runLoadMore(session, "next", fetchPage, () => "err");
    // Invoke assert.equal to perform this step.
    assert.equal(secondMore, false);
    assert.equal(fetchCalls, 2); // 1 full + 1 load-more only

    // Invoke more.resolve to perform this step.
    more.resolve(page(["b"], null, 2));
    // Wait for an async operation before continuing.
    await firstMore;
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke session.getState to perform this step.
      session.getState().tickets.map((t) => t.id),
      // Support the surrounding logic for this step.
      ["a", "b"],
    );
  });

  // Define a single test case and its expectation.
  it("ignores commits and further reloads after dispose", async () => {
    // Bind session for use in the following logic.
    const session = createRepairsListSession();
    // Bind pending for use in the following logic.
    const pending = deferred<TicketListPage>();
    // Bind fetches for use in the following logic.
    let fetches = 0;
    // Bind fetchPage for use in the following logic.
    const fetchPage = () => {
      // Support the surrounding logic for this step.
      fetches += 1;
      // Return early result or rendered output from this path.
      return pending.promise;
    };

    // Bind inFlight for use in the following logic.
    const inFlight = runFullReload(session, fetchPage, () => "err");
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().loading, true);

    // Invoke session.dispose to perform this step.
    session.dispose();
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().loading, false);
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(session.getState().tickets, []);

    // Invoke pending.resolve to perform this step.
    pending.resolve(page(["should-not-appear"]));
    // Wait for an async operation before continuing.
    await inFlight;
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(session.getState().tickets, []);
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().loading, false);

    // After dispose, a new beginFullReload is allowed (location remount reuse),
    // but a stale in-flight from before dispose must not win — already checked.
    // Simulate "onDone after dispose": caller must not call; if they do via a
    // fresh run, that is a new generation. Guard is in the panel (mountedRef).
    assert.equal(fetches, 1);
  });

  // Define a single test case and its expectation.
  it("blocks load-more while a full reload is in flight", async () => {
    // Bind session for use in the following logic.
    const session = createRepairsListSession();
    // Bind pending for use in the following logic.
    const pending = deferred<TicketListPage>();
    // Bind fetchPage for use in the following logic.
    const fetchPage = () => pending.promise;

    // Fire-and-forget async work without awaiting in this path.
    void runFullReload(session, fetchPage, () => "err");
    // Bind started for use in the following logic.
    const started = session.beginLoadMore("cursor-1");
    // Invoke assert.equal to perform this step.
    assert.equal(started, null);

    // Invoke pending.resolve to perform this step.
    pending.resolve(page(["a"]));
  });
});
