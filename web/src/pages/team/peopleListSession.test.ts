/**
 * Unit: people list session races (filter/reload vs load-more).
 * Controlled deferred fetches — no arbitrary timeouts.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Person } from "../../api/client";
import {
  createPeopleListSession,
  isStaleGeneration,
  mergePeoplePages,
  runPeopleFullReload,
  runPeopleLoadMore,
  type PeopleListPage,
} from "./peopleListSession";

function person(employeeId: string): Person {
  return {
    id: employeeId,
    employeeId,
    userId: null,
    fullName: employeeId,
    employeeNumber: employeeId,
    email: null,
    role: null,
    department: null,
    isActive: true,
    onboarded: false,
    status: "not_activated",
    archivedAt: null,
    accessVersion: 0,
    deviceCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function page(
  ids: string[],
  nextCursor: string | null = null,
): PeopleListPage {
  return { items: ids.map(person), nextCursor };
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("peopleListSession helpers", () => {
  it("merges pages without duplicating employeeId", () => {
    const merged = mergePeoplePages(
      [person("a"), person("b")],
      [person("b"), person("c")],
    );
    assert.deepEqual(
      merged.map((p) => p.employeeId),
      ["a", "b", "c"],
    );
  });

  it("detects stale generations", () => {
    assert.equal(isStaleGeneration(2, 1), true);
    assert.equal(isStaleGeneration(2, 2), false);
  });
});

describe("createPeopleListSession races", () => {
  it("keeps the newer list when two full reloads finish out of order", async () => {
    const session = createPeopleListSession();
    const first = deferred<PeopleListPage>();
    const second = deferred<PeopleListPage>();
    let calls = 0;
    const fetchPage = () => {
      calls += 1;
      return calls === 1 ? first.promise : second.promise;
    };

    const older = runPeopleFullReload(session, fetchPage, () => "err");
    const newer = runPeopleFullReload(session, fetchPage, () => "err");

    second.resolve(page(["new-a", "new-b"]));
    await newer;
    assert.deepEqual(
      session.getState().people.map((p) => p.employeeId),
      ["new-a", "new-b"],
    );

    first.resolve(page(["old-a"]));
    await older;
    assert.deepEqual(
      session.getState().people.map((p) => p.employeeId),
      ["new-a", "new-b"],
    );
    assert.equal(session.getState().loading, false);
  });

  it("ignores stale error after a newer success", async () => {
    const session = createPeopleListSession();
    const first = deferred<PeopleListPage>();
    const second = deferred<PeopleListPage>();
    let calls = 0;
    const fetchPage = () => {
      calls += 1;
      return calls === 1 ? first.promise : second.promise;
    };

    const older = runPeopleFullReload(session, fetchPage, (e) =>
      e instanceof Error ? e.message : "err",
    );
    const newer = runPeopleFullReload(session, fetchPage, () => "err");

    second.resolve(page(["fresh"]));
    await newer;
    assert.equal(session.getState().loadError, null);

    first.reject(new Error("stale failure"));
    await older;
    assert.deepEqual(
      session.getState().people.map((p) => p.employeeId),
      ["fresh"],
    );
    assert.equal(session.getState().loadError, null);
  });

  it("does not append or overwrite cursor when load-more finishes after a full reload", async () => {
    const session = createPeopleListSession();
    const full1 = deferred<PeopleListPage>();
    const more = deferred<PeopleListPage>();
    const full2 = deferred<PeopleListPage>();
    let calls = 0;

    const fetchPage = (args: { cursor?: string | null }) => {
      calls += 1;
      if (calls === 1) return full1.promise;
      if (args.cursor) return more.promise;
      return full2.promise;
    };

    const firstReload = runPeopleFullReload(session, fetchPage, () => "err");
    full1.resolve(page(["a", "b"], "cur-1"));
    await firstReload;
    assert.equal(session.getState().nextCursor, "cur-1");

    const loadMorePromise = runPeopleLoadMore(
      session,
      session.getState().nextCursor,
      fetchPage,
      () => "err",
    );
    assert.equal(session.isLoadMoreInFlight(), true);

    const secondReload = runPeopleFullReload(session, fetchPage, () => "err");
    assert.equal(session.getState().loading, true);
    assert.equal(session.getState().loadingMore, false);
    assert.equal(session.getState().nextCursor, null);

    full2.resolve(page(["x", "y"], "cur-2"));
    await secondReload;
    assert.deepEqual(
      session.getState().people.map((p) => p.employeeId),
      ["x", "y"],
    );
    assert.equal(session.getState().nextCursor, "cur-2");

    more.resolve(page(["c", "d"], "cur-stale"));
    await loadMorePromise;
    assert.deepEqual(
      session.getState().people.map((p) => p.employeeId),
      ["x", "y"],
    );
    assert.equal(session.getState().nextCursor, "cur-2");
  });

  it("blocks load-more while a full reload is in flight", async () => {
    const session = createPeopleListSession();
    const full = deferred<PeopleListPage>();
    const fetchPage = () => full.promise;

    const reload = runPeopleFullReload(session, fetchPage, () => "err");
    assert.equal(session.isFullReloadInFlight(), true);

    const started = await runPeopleLoadMore(
      session,
      "stale-cursor",
      fetchPage,
      () => "err",
    );
    assert.equal(started, false);
    assert.equal(session.isLoadMoreInFlight(), false);

    full.resolve(page(["ok"], "next"));
    await reload;
    assert.equal(session.getState().nextCursor, "next");
  });

  it("second beginLoadMore is a no-op while the first is in flight", async () => {
    const session = createPeopleListSession();
    const full = deferred<PeopleListPage>();
    const more = deferred<PeopleListPage>();
    let calls = 0;
    const fetchPage = (args: { cursor?: string | null }) => {
      calls += 1;
      if (!args.cursor) return full.promise;
      return more.promise;
    };

    const reload = runPeopleFullReload(session, fetchPage, () => "err");
    full.resolve(page(["a"], "cur"));
    await reload;

    const firstMore = runPeopleLoadMore(
      session,
      "cur",
      fetchPage,
      () => "err",
    );
    const secondMore = await runPeopleLoadMore(
      session,
      "cur",
      fetchPage,
      () => "err",
    );
    assert.equal(secondMore, false);

    more.resolve(page(["b"], null));
    await firstMore;
    assert.deepEqual(
      session.getState().people.map((p) => p.employeeId),
      ["a", "b"],
    );
    // One full reload + one load-more fetch (not two load-mores).
    assert.equal(calls, 2);
  });

  it("ignores load-more error after a newer successful reload", async () => {
    const session = createPeopleListSession();
    const full1 = deferred<PeopleListPage>();
    const more = deferred<PeopleListPage>();
    const full2 = deferred<PeopleListPage>();
    let calls = 0;
    const fetchPage = (args: { cursor?: string | null }) => {
      calls += 1;
      if (calls === 1) return full1.promise;
      if (args.cursor) return more.promise;
      return full2.promise;
    };

    await (async () => {
      const p = runPeopleFullReload(session, fetchPage, () => "err");
      full1.resolve(page(["a"], "cur"));
      await p;
    })();

    const morePromise = runPeopleLoadMore(
      session,
      "cur",
      fetchPage,
      (e) => (e instanceof Error ? e.message : "err"),
    );

    const reload2 = runPeopleFullReload(session, fetchPage, () => "err");
    full2.resolve(page(["fresh"], null));
    await reload2;
    assert.equal(session.getState().loadError, null);

    more.reject(new Error("stale more failure"));
    await morePromise;
    assert.equal(session.getState().loadError, null);
    assert.deepEqual(
      session.getState().people.map((p) => p.employeeId),
      ["fresh"],
    );
  });

  it("recovers list after a failed refresh then successful refresh", async () => {
    const session = createPeopleListSession();
    const fail = deferred<PeopleListPage>();
    const ok = deferred<PeopleListPage>();
    let calls = 0;
    const fetchPage = () => {
      calls += 1;
      return calls === 1 ? fail.promise : ok.promise;
    };

    const first = runPeopleFullReload(session, fetchPage, (e) =>
      e instanceof Error ? e.message : "err",
    );
    fail.reject(new Error("network down"));
    await first;
    assert.equal(session.getState().loadError, "network down");
    assert.equal(session.getState().loading, false);

    const second = runPeopleFullReload(session, fetchPage, () => "err");
    ok.resolve(page(["recovered"], "c"));
    await second;
    assert.equal(session.getState().loadError, null);
    assert.deepEqual(
      session.getState().people.map((p) => p.employeeId),
      ["recovered"],
    );
    assert.equal(session.getState().nextCursor, "c");
  });

  it("invalidatePendingSearch ignores stale success/error and blocks load-more", async () => {
    const session = createPeopleListSession();
    const first = deferred<PeopleListPage>();
    const fetchPage = () => first.promise;

    const older = runPeopleFullReload(session, fetchPage, (e) =>
      e instanceof Error ? e.message : "err",
    );
    assert.equal(session.getState().nextCursor, null);

    // Seed a cursor via direct commit path after first resolves, then invalidate mid-flight of a second load.
    first.resolve(page(["a"], "cur-old"));
    await older;
    assert.equal(session.getState().nextCursor, "cur-old");

    const mid = deferred<PeopleListPage>();
    const midReload = runPeopleFullReload(session, () => mid.promise, (e) =>
      e instanceof Error ? e.message : "err",
    );

    session.invalidatePendingSearch();
    assert.equal(session.isSearchPending(), true);
    assert.equal(session.isFullReloadInFlight(), false);
    assert.equal(session.getState().nextCursor, null);
    assert.equal(session.getState().loading, true);
    assert.equal(session.getState().loadingMore, false);

    const blocked = await runPeopleLoadMore(
      session,
      "cur-old",
      () => Promise.resolve(page(["leak"])),
      () => "err",
    );
    assert.equal(blocked, false);

    mid.resolve(page(["stale"], "cur-stale"));
    await midReload;
    // Stale mid-flight success must not land after invalidate.
    assert.deepEqual(
      session.getState().people.map((p) => p.employeeId),
      ["a"],
    );
    assert.equal(session.getState().nextCursor, null);
    assert.equal(session.isSearchPending(), true);

    // beginFullReload clears searchPending.
    const settled = deferred<PeopleListPage>();
    const after = runPeopleFullReload(session, () => settled.promise, () => "err");
    assert.equal(session.isSearchPending(), false);
    assert.equal(session.isFullReloadInFlight(), true);
    settled.resolve(page(["an"], "cur-an"));
    await after;
    assert.deepEqual(
      session.getState().people.map((p) => p.employeeId),
      ["an"],
    );
    assert.equal(session.getState().nextCursor, "cur-an");
  });

  it("invalidatePendingSearch ignores stale error after pending", async () => {
    const session = createPeopleListSession();
    const first = deferred<PeopleListPage>();
    const older = runPeopleFullReload(
      session,
      () => first.promise,
      (e) => (e instanceof Error ? e.message : "err"),
    );

    session.invalidatePendingSearch();
    first.reject(new Error("stale failure"));
    await older;
    assert.equal(session.getState().loadError, null);
    assert.equal(session.isSearchPending(), true);
    assert.equal(session.getState().loading, true);
  });
});
