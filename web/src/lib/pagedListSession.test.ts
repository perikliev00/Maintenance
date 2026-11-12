/**
 * Unit smoke for shared paged list session primitives (domain race suites stay elsewhere).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createPagedListSession,
  isStaleGeneration,
  mergeByKey,
  runPagedFullReload,
} from "./pagedListSession";

type Item = { id: string };
type Page = { items: Item[]; nextCursor: string | null };
type State = {
  items: Item[];
  nextCursor: string | null;
  loadError: string | null;
  loading: boolean;
  loadingMore: boolean;
};

const EMPTY: State = {
  items: [],
  nextCursor: null,
  loadError: null,
  loading: false,
  loadingMore: false,
};

describe("pagedListSession primitives", () => {
  it("mergeByKey skips duplicates", () => {
    const merged = mergeByKey(
      [{ id: "a" }, { id: "b" }],
      [{ id: "b" }, { id: "c" }],
      (x) => x.id,
    );
    assert.deepEqual(
      merged.map((x) => x.id),
      ["a", "b", "c"],
    );
  });

  it("isStaleGeneration compares generations", () => {
    assert.equal(isStaleGeneration(2, 1), true);
    assert.equal(isStaleGeneration(2, 2), false);
  });
});

describe("createPagedListSession smoke", () => {
  it("keeps newer full reload when older finishes last", async () => {
    const session = createPagedListSession<Page, State>({
      emptyState: EMPTY,
      beginFullReloadState: (prev) => ({
        // Spread remaining fields/props.
        ...prev,
        nextCursor: null,
        loadError: null,
        loading: true,
        loadingMore: false,
      }),
      commitFullReloadSuccess: (page) => ({
        items: page.items,
        nextCursor: page.nextCursor,
        loadError: null,
        loading: false,
        loadingMore: false,
      }),
      commitLoadMoreSuccess: (prev, page) => ({
        // Spread remaining fields/props.
        ...prev,
        items: mergeByKey(prev.items, page.items, (x) => x.id),
        nextCursor: page.nextCursor,
        loadError: null,
        loadingMore: false,
      }),
    });

    type Deferred<T> = {
      promise: Promise<T>;
      resolve: (value: T) => void;
    };
    // Function definition.
    function deferred<T>(): Deferred<T> {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((res) => {
        resolve = res;
      });
      return { promise, resolve };
    }

    const first = deferred<Page>();
    const second = deferred<Page>();
    let calls = 0;
    // Const arrow/function binding.
    const fetchPage = () => {
      calls += 1;
      return calls === 1 ? first.promise : second.promise;
    };

    const older = runPagedFullReload(session, fetchPage, () => "err");
    const newer = runPagedFullReload(session, fetchPage, () => "err");

    second.resolve({ items: [{ id: "new" }], nextCursor: null });
    await newer;
    assert.deepEqual(
      session.getState().items.map((x) => x.id),
      ["new"],
    );

    first.resolve({ items: [{ id: "old" }], nextCursor: null });
    await older;
    assert.deepEqual(
      session.getState().items.map((x) => x.id),
      ["new"],
    );
  });
});
