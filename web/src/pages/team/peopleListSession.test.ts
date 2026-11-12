/**
 * Unit: people list session races (filter/reload vs load-more).
 * Controlled deferred fetches — no arbitrary timeouts.
 */
import assert from "node:assert/strict";
// Import module dependency from node:test.
import { describe, it } from "node:test";
// Import type-only dependency for typing without runtime cost.
import type { Person } from "../../api/client";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  createPeopleListSession,
  // Support the surrounding logic for this step.
  isStaleGeneration,
  // Support the surrounding logic for this step.
  mergePeoplePages,
  // Support the surrounding logic for this step.
  runPeopleFullReload,
  // Support the surrounding logic for this step.
  runPeopleLoadMore,
  // Declare type alias PeopleListPage.
  type PeopleListPage,
// Support the surrounding logic for this step.
} from "./peopleListSession";

// Define function person and its behavior.
function person(employeeId: string): Person {
  // Return early result or rendered output from this path.
  return {
    // Provide id field used by this structure.
    id: employeeId,
    // Support the surrounding logic for this step.
    employeeId,
    // Provide userId field used by this structure.
    userId: null,
    // Provide fullName field used by this structure.
    fullName: employeeId,
    // Provide employeeNumber field used by this structure.
    employeeNumber: employeeId,
    // Provide email field used by this structure.
    email: null,
    // Provide role field used by this structure.
    role: null,
    // Provide department field used by this structure.
    department: null,
    // Provide isActive field used by this structure.
    isActive: true,
    // Provide onboarded field used by this structure.
    onboarded: false,
    // Provide status field used by this structure.
    status: "not_activated",
    // Provide archivedAt field used by this structure.
    archivedAt: null,
    // Provide accessVersion field used by this structure.
    accessVersion: 0,
    // Provide deviceCount field used by this structure.
    deviceCount: 0,
    // Provide createdAt field used by this structure.
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

// Define function page and its behavior.
function page(
  // Provide ids field used by this structure.
  ids: string[],
  // Provide nextCursor field used by this structure.
  nextCursor: string | null = null,
// Support the surrounding logic for this step.
): PeopleListPage {
  // Return early result or rendered output from this path.
  return { items: ids.map(person), nextCursor };
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
describe("peopleListSession helpers", () => {
  // Define a single test case and its expectation.
  it("merges pages without duplicating employeeId", () => {
    // Bind merged for use in the following logic.
    const merged = mergePeoplePages(
      // Support the surrounding logic for this step.
      [person("a"), person("b")],
      // Support the surrounding logic for this step.
      [person("b"), person("c")],
    );
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke merged.map to perform this step.
      merged.map((p) => p.employeeId),
      // Support the surrounding logic for this step.
      ["a", "b", "c"],
    );
  });

  // Define a single test case and its expectation.
  it("detects stale generations", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(isStaleGeneration(2, 1), true);
    // Invoke assert.equal to perform this step.
    assert.equal(isStaleGeneration(2, 2), false);
  });
});

// Group related tests under a shared suite name.
describe("createPeopleListSession races", () => {
  // Define a single test case and its expectation.
  it("keeps the newer list when two full reloads finish out of order", async () => {
    // Bind session for use in the following logic.
    const session = createPeopleListSession();
    // Bind first for use in the following logic.
    const first = deferred<PeopleListPage>();
    // Bind second for use in the following logic.
    const second = deferred<PeopleListPage>();
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
    const older = runPeopleFullReload(session, fetchPage, () => "err");
    // Bind newer for use in the following logic.
    const newer = runPeopleFullReload(session, fetchPage, () => "err");

    // Invoke second.resolve to perform this step.
    second.resolve(page(["new-a", "new-b"]));
    // Wait for an async operation before continuing.
    await newer;
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke session.getState to perform this step.
      session.getState().people.map((p) => p.employeeId),
      // Support the surrounding logic for this step.
      ["new-a", "new-b"],
    );

    // Invoke first.resolve to perform this step.
    first.resolve(page(["old-a"]));
    // Wait for an async operation before continuing.
    await older;
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke session.getState to perform this step.
      session.getState().people.map((p) => p.employeeId),
      // Support the surrounding logic for this step.
      ["new-a", "new-b"],
    );
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().loading, false);
  });

  // Define a single test case and its expectation.
  it("ignores stale error after a newer success", async () => {
    // Bind session for use in the following logic.
    const session = createPeopleListSession();
    // Bind first for use in the following logic.
    const first = deferred<PeopleListPage>();
    // Bind second for use in the following logic.
    const second = deferred<PeopleListPage>();
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
    const older = runPeopleFullReload(session, fetchPage, (e) =>
      // Support the surrounding logic for this step.
      e instanceof Error ? e.message : "err",
    );
    // Bind newer for use in the following logic.
    const newer = runPeopleFullReload(session, fetchPage, () => "err");

    // Invoke second.resolve to perform this step.
    second.resolve(page(["fresh"]));
    // Wait for an async operation before continuing.
    await newer;
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().loadError, null);

    // Invoke first.reject to perform this step.
    first.reject(new Error("stale failure"));
    // Wait for an async operation before continuing.
    await older;
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke session.getState to perform this step.
      session.getState().people.map((p) => p.employeeId),
      // Support the surrounding logic for this step.
      ["fresh"],
    );
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().loadError, null);
  });

  // Define a single test case and its expectation.
  it("does not append or overwrite cursor when load-more finishes after a full reload", async () => {
    // Bind session for use in the following logic.
    const session = createPeopleListSession();
    // Bind full1 for use in the following logic.
    const full1 = deferred<PeopleListPage>();
    // Bind more for use in the following logic.
    const more = deferred<PeopleListPage>();
    // Bind full2 for use in the following logic.
    const full2 = deferred<PeopleListPage>();
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
    const firstReload = runPeopleFullReload(session, fetchPage, () => "err");
    // Invoke full1.resolve to perform this step.
    full1.resolve(page(["a", "b"], "cur-1"));
    // Wait for an async operation before continuing.
    await firstReload;
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().nextCursor, "cur-1");

    // Bind loadMorePromise for use in the following logic.
    const loadMorePromise = runPeopleLoadMore(
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
    const secondReload = runPeopleFullReload(session, fetchPage, () => "err");
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().loading, true);
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().loadingMore, false);
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().nextCursor, null);

    // Invoke full2.resolve to perform this step.
    full2.resolve(page(["x", "y"], "cur-2"));
    // Wait for an async operation before continuing.
    await secondReload;
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke session.getState to perform this step.
      session.getState().people.map((p) => p.employeeId),
      // Support the surrounding logic for this step.
      ["x", "y"],
    );
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().nextCursor, "cur-2");

    // Invoke more.resolve to perform this step.
    more.resolve(page(["c", "d"], "cur-stale"));
    // Wait for an async operation before continuing.
    await loadMorePromise;
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke session.getState to perform this step.
      session.getState().people.map((p) => p.employeeId),
      // Support the surrounding logic for this step.
      ["x", "y"],
    );
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().nextCursor, "cur-2");
  });

  // Define a single test case and its expectation.
  it("blocks load-more while a full reload is in flight", async () => {
    // Bind session for use in the following logic.
    const session = createPeopleListSession();
    // Bind full for use in the following logic.
    const full = deferred<PeopleListPage>();
    // Bind fetchPage for use in the following logic.
    const fetchPage = () => full.promise;

    // Bind reload for use in the following logic.
    const reload = runPeopleFullReload(session, fetchPage, () => "err");
    // Invoke assert.equal to perform this step.
    assert.equal(session.isFullReloadInFlight(), true);

    // Bind started for use in the following logic.
    const started = await runPeopleLoadMore(
      // Support the surrounding logic for this step.
      session,
      // Support the surrounding logic for this step.
      "stale-cursor",
      // Support the surrounding logic for this step.
      fetchPage,
      // Support the surrounding logic for this step.
      () => "err",
    );
    // Invoke assert.equal to perform this step.
    assert.equal(started, false);
    // Invoke assert.equal to perform this step.
    assert.equal(session.isLoadMoreInFlight(), false);

    // Invoke full.resolve to perform this step.
    full.resolve(page(["ok"], "next"));
    // Wait for an async operation before continuing.
    await reload;
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().nextCursor, "next");
  });

  // Define a single test case and its expectation.
  it("second beginLoadMore is a no-op while the first is in flight", async () => {
    // Bind session for use in the following logic.
    const session = createPeopleListSession();
    // Bind full for use in the following logic.
    const full = deferred<PeopleListPage>();
    // Bind more for use in the following logic.
    const more = deferred<PeopleListPage>();
    // Bind calls for use in the following logic.
    let calls = 0;
    // Bind fetchPage for use in the following logic.
    const fetchPage = (args: { cursor?: string | null }) => {
      // Support the surrounding logic for this step.
      calls += 1;
      // Conditional branch for the case described by this guard.
      if (!args.cursor) return full.promise;
      // Return early result or rendered output from this path.
      return more.promise;
    };

    // Bind reload for use in the following logic.
    const reload = runPeopleFullReload(session, fetchPage, () => "err");
    // Invoke full.resolve to perform this step.
    full.resolve(page(["a"], "cur"));
    // Wait for an async operation before continuing.
    await reload;

    // Bind firstMore for use in the following logic.
    const firstMore = runPeopleLoadMore(
      // Support the surrounding logic for this step.
      session,
      // Support the surrounding logic for this step.
      "cur",
      // Support the surrounding logic for this step.
      fetchPage,
      // Support the surrounding logic for this step.
      () => "err",
    );
    // Bind secondMore for use in the following logic.
    const secondMore = await runPeopleLoadMore(
      // Support the surrounding logic for this step.
      session,
      // Support the surrounding logic for this step.
      "cur",
      // Support the surrounding logic for this step.
      fetchPage,
      // Support the surrounding logic for this step.
      () => "err",
    );
    // Invoke assert.equal to perform this step.
    assert.equal(secondMore, false);

    // Invoke more.resolve to perform this step.
    more.resolve(page(["b"], null));
    // Wait for an async operation before continuing.
    await firstMore;
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke session.getState to perform this step.
      session.getState().people.map((p) => p.employeeId),
      // Support the surrounding logic for this step.
      ["a", "b"],
    );
    // One full reload + one load-more fetch (not two load-mores).
    assert.equal(calls, 2);
  });

  // Define a single test case and its expectation.
  it("ignores load-more error after a newer successful reload", async () => {
    // Bind session for use in the following logic.
    const session = createPeopleListSession();
    // Bind full1 for use in the following logic.
    const full1 = deferred<PeopleListPage>();
    // Bind more for use in the following logic.
    const more = deferred<PeopleListPage>();
    // Bind full2 for use in the following logic.
    const full2 = deferred<PeopleListPage>();
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

    // Wait for an async operation before continuing.
    await (async () => {
      // Bind p for use in the following logic.
      const p = runPeopleFullReload(session, fetchPage, () => "err");
      // Invoke full1.resolve to perform this step.
      full1.resolve(page(["a"], "cur"));
      // Wait for an async operation before continuing.
      await p;
    // Support the surrounding logic for this step.
    })();

    // Bind morePromise for use in the following logic.
    const morePromise = runPeopleLoadMore(
      // Support the surrounding logic for this step.
      session,
      // Support the surrounding logic for this step.
      "cur",
      // Support the surrounding logic for this step.
      fetchPage,
      // Support the surrounding logic for this step.
      (e) => (e instanceof Error ? e.message : "err"),
    );

    // Bind reload2 for use in the following logic.
    const reload2 = runPeopleFullReload(session, fetchPage, () => "err");
    // Invoke full2.resolve to perform this step.
    full2.resolve(page(["fresh"], null));
    // Wait for an async operation before continuing.
    await reload2;
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().loadError, null);

    // Invoke more.reject to perform this step.
    more.reject(new Error("stale more failure"));
    // Wait for an async operation before continuing.
    await morePromise;
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().loadError, null);
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke session.getState to perform this step.
      session.getState().people.map((p) => p.employeeId),
      // Support the surrounding logic for this step.
      ["fresh"],
    );
  });

  // Define a single test case and its expectation.
  it("recovers list after a failed refresh then successful refresh", async () => {
    // Bind session for use in the following logic.
    const session = createPeopleListSession();
    // Bind fail for use in the following logic.
    const fail = deferred<PeopleListPage>();
    // Bind ok for use in the following logic.
    const ok = deferred<PeopleListPage>();
    // Bind calls for use in the following logic.
    let calls = 0;
    // Bind fetchPage for use in the following logic.
    const fetchPage = () => {
      // Support the surrounding logic for this step.
      calls += 1;
      // Return early result or rendered output from this path.
      return calls === 1 ? fail.promise : ok.promise;
    };

    // Bind first for use in the following logic.
    const first = runPeopleFullReload(session, fetchPage, (e) =>
      // Support the surrounding logic for this step.
      e instanceof Error ? e.message : "err",
    );
    // Invoke fail.reject to perform this step.
    fail.reject(new Error("network down"));
    // Wait for an async operation before continuing.
    await first;
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().loadError, "network down");
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().loading, false);

    // Bind second for use in the following logic.
    const second = runPeopleFullReload(session, fetchPage, () => "err");
    // Invoke ok.resolve to perform this step.
    ok.resolve(page(["recovered"], "c"));
    // Wait for an async operation before continuing.
    await second;
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().loadError, null);
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke session.getState to perform this step.
      session.getState().people.map((p) => p.employeeId),
      // Support the surrounding logic for this step.
      ["recovered"],
    );
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().nextCursor, "c");
  });

  // Define a single test case and its expectation.
  it("invalidatePendingSearch ignores stale success/error and blocks load-more", async () => {
    // Bind session for use in the following logic.
    const session = createPeopleListSession();
    // Bind first for use in the following logic.
    const first = deferred<PeopleListPage>();
    // Bind fetchPage for use in the following logic.
    const fetchPage = () => first.promise;

    // Bind older for use in the following logic.
    const older = runPeopleFullReload(session, fetchPage, (e) =>
      // Support the surrounding logic for this step.
      e instanceof Error ? e.message : "err",
    );
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().nextCursor, null);

    // Seed a cursor via direct commit path after first resolves, then invalidate mid-flight of a second load.
    first.resolve(page(["a"], "cur-old"));
    // Wait for an async operation before continuing.
    await older;
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().nextCursor, "cur-old");

    // Bind mid for use in the following logic.
    const mid = deferred<PeopleListPage>();
    // Bind midReload for use in the following logic.
    const midReload = runPeopleFullReload(session, () => mid.promise, (e) =>
      // Support the surrounding logic for this step.
      e instanceof Error ? e.message : "err",
    );

    // Invoke session.invalidatePendingSearch to perform this step.
    session.invalidatePendingSearch();
    // Invoke assert.equal to perform this step.
    assert.equal(session.isSearchPending(), true);
    // Invoke assert.equal to perform this step.
    assert.equal(session.isFullReloadInFlight(), false);
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().nextCursor, null);
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().loading, true);
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().loadingMore, false);

    // Bind blocked for use in the following logic.
    const blocked = await runPeopleLoadMore(
      // Support the surrounding logic for this step.
      session,
      // Support the surrounding logic for this step.
      "cur-old",
      // Support the surrounding logic for this step.
      () => Promise.resolve(page(["leak"])),
      // Support the surrounding logic for this step.
      () => "err",
    );
    // Invoke assert.equal to perform this step.
    assert.equal(blocked, false);

    // Invoke mid.resolve to perform this step.
    mid.resolve(page(["stale"], "cur-stale"));
    // Wait for an async operation before continuing.
    await midReload;
    // Stale mid-flight success must not land after invalidate.
    assert.deepEqual(
      // Invoke session.getState to perform this step.
      session.getState().people.map((p) => p.employeeId),
      // Support the surrounding logic for this step.
      ["a"],
    );
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().nextCursor, null);
    // Invoke assert.equal to perform this step.
    assert.equal(session.isSearchPending(), true);

    // beginFullReload clears searchPending.
    const settled = deferred<PeopleListPage>();
    // Bind after for use in the following logic.
    const after = runPeopleFullReload(session, () => settled.promise, () => "err");
    // Invoke assert.equal to perform this step.
    assert.equal(session.isSearchPending(), false);
    // Invoke assert.equal to perform this step.
    assert.equal(session.isFullReloadInFlight(), true);
    // Invoke settled.resolve to perform this step.
    settled.resolve(page(["an"], "cur-an"));
    // Wait for an async operation before continuing.
    await after;
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke session.getState to perform this step.
      session.getState().people.map((p) => p.employeeId),
      // Support the surrounding logic for this step.
      ["an"],
    );
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().nextCursor, "cur-an");
  });

  // Define a single test case and its expectation.
  it("invalidatePendingSearch ignores stale error after pending", async () => {
    // Bind session for use in the following logic.
    const session = createPeopleListSession();
    // Bind first for use in the following logic.
    const first = deferred<PeopleListPage>();
    // Bind older for use in the following logic.
    const older = runPeopleFullReload(
      // Support the surrounding logic for this step.
      session,
      // Support the surrounding logic for this step.
      () => first.promise,
      // Support the surrounding logic for this step.
      (e) => (e instanceof Error ? e.message : "err"),
    );

    // Invoke session.invalidatePendingSearch to perform this step.
    session.invalidatePendingSearch();
    // Invoke first.reject to perform this step.
    first.reject(new Error("stale failure"));
    // Wait for an async operation before continuing.
    await older;
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().loadError, null);
    // Invoke assert.equal to perform this step.
    assert.equal(session.isSearchPending(), true);
    // Invoke assert.equal to perform this step.
    assert.equal(session.getState().loading, true);
  });
});
