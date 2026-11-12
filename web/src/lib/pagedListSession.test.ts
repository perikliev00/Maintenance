/**
 * Unit smoke for shared paged list session primitives (domain race suites stay elsewhere).
 */
import assert from "node:assert/strict";
// Import dependency used by this module.
import { describe, it } from "node:test";
// Import dependency used by this module.
import {
  // List item in import/export/params.
  createPagedListSession,
  // List item in import/export/params.
  isStaleGeneration,
  // List item in import/export/params.
  mergeByKey,
  // List item in import/export/params.
  runPagedFullReload,
// Close multi-line construct with trailing syntax.
} from "./pagedListSession";

// Local type alias shaping data.
type Item = { id: string };
// Local type alias shaping data.
type Page = { items: Item[]; nextCursor: string | null };
// Local type alias shaping data.
type State = {
  // Field/property in this shape.
  items: Item[];
  // Field/property in this shape.
  nextCursor: string | null;
  // Field/property in this shape.
  loadError: string | null;
  // Field/property in this shape.
  loading: boolean;
  // Field/property in this shape.
  loadingMore: boolean;
};

// Local constant binding.
const EMPTY: State = {
  // Field/property in this shape.
  items: [],
  // Field/property in this shape.
  nextCursor: null,
  // Field/property in this shape.
  loadError: null,
  // Field/property in this shape.
  loading: false,
  // Field/property in this shape.
  loadingMore: false,
};

// Group related unit tests.
describe("pagedListSession primitives", () => {
  // Unit test case.
  it("mergeByKey skips duplicates", () => {
    // Local constant binding.
    const merged = mergeByKey(
      // Continue multi-line list/arguments.
      [{ id: "a" }, { id: "b" }],
      // Continue multi-line list/arguments.
      [{ id: "b" }, { id: "c" }],
      // Arrow function / callback body.
      (x) => x.id,
    );
    // Assert expected test outcome.
    assert.deepEqual(
      // Arrow function / callback body.
      merged.map((x) => x.id),
      // Continue multi-line list/arguments.
      ["a", "b", "c"],
    );
  });

  // Unit test case.
  it("isStaleGeneration compares generations", () => {
    // Assert expected test outcome.
    assert.equal(isStaleGeneration(2, 1), true);
    // Assert expected test outcome.
    assert.equal(isStaleGeneration(2, 2), false);
  });
});

// Group related unit tests.
describe("createPagedListSession smoke", () => {
  // Unit test case.
  it("keeps newer full reload when older finishes last", async () => {
    // Local constant binding.
    const session = createPagedListSession<Page, State>({
      // Field/property in this shape.
      emptyState: EMPTY,
      // Arrow function / callback body.
      beginFullReloadState: (prev) => ({
        // Spread remaining fields/props.
        ...prev,
        // Field/property in this shape.
        nextCursor: null,
        // Field/property in this shape.
        loadError: null,
        // Field/property in this shape.
        loading: true,
        // Field/property in this shape.
        loadingMore: false,
      }),
      // Arrow function / callback body.
      commitFullReloadSuccess: (page) => ({
        // Field/property in this shape.
        items: page.items,
        // Field/property in this shape.
        nextCursor: page.nextCursor,
        // Field/property in this shape.
        loadError: null,
        // Field/property in this shape.
        loading: false,
        // Field/property in this shape.
        loadingMore: false,
      }),
      // Arrow function / callback body.
      commitLoadMoreSuccess: (prev, page) => ({
        // Spread remaining fields/props.
        ...prev,
        // Arrow function / callback body.
        items: mergeByKey(prev.items, page.items, (x) => x.id),
        // Field/property in this shape.
        nextCursor: page.nextCursor,
        // Field/property in this shape.
        loadError: null,
        // Field/property in this shape.
        loadingMore: false,
      }),
    });

    // Local type alias shaping data.
    type Deferred<T> = {
      // Field/property in this shape.
      promise: Promise<T>;
      // Arrow function / callback body.
      resolve: (value: T) => void;
    };
    // Function definition.
    function deferred<T>(): Deferred<T> {
      // Mutable local binding.
      let resolve!: (value: T) => void;
      // Local constant binding.
      const promise = new Promise<T>((res) => {
        // Assign value for subsequent use.
        resolve = res;
      });
      // Return computed result to caller.
      return { promise, resolve };
    }

    // Local constant binding.
    const first = deferred<Page>();
    // Local constant binding.
    const second = deferred<Page>();
    // Mutable local binding.
    let calls = 0;
    // Const arrow/function binding.
    const fetchPage = () => {
      // Assign value for subsequent use.
      calls += 1;
      // Return computed result to caller.
      return calls === 1 ? first.promise : second.promise;
    };

    // Local constant binding.
    const older = runPagedFullReload(session, fetchPage, () => "err");
    // Local constant binding.
    const newer = runPagedFullReload(session, fetchPage, () => "err");

    // Invoke helper or pass arguments.
    second.resolve({ items: [{ id: "new" }], nextCursor: null });
    // Await async work before continuing.
    await newer;
    // Assert expected test outcome.
    assert.deepEqual(
      // Arrow function / callback body.
      session.getState().items.map((x) => x.id),
      // Continue multi-line list/arguments.
      ["new"],
    );

    // Invoke helper or pass arguments.
    first.resolve({ items: [{ id: "old" }], nextCursor: null });
    // Await async work before continuing.
    await older;
    // Assert expected test outcome.
    assert.deepEqual(
      // Arrow function / callback body.
      session.getState().items.map((x) => x.id),
      // Continue multi-line list/arguments.
      ["new"],
    );
  });
});
