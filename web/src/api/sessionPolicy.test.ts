// Import dependency used by this module.
import assert from "node:assert/strict";
// Import dependency used by this module.
import { describe, it } from "node:test";
// Import dependency used by this module.
import {
  // List item in import/export/params.
  classifyBootstrapError,
  // List item in import/export/params.
  classifyRefreshFailure,
  // List item in import/export/params.
  isTransientStatus,
  // List item in import/export/params.
  shouldWipeOfflineOnBootstrap,
// Close multi-line construct with trailing syntax.
} from "./sessionPolicy";

// Group related unit tests.
describe("isTransientStatus", () => {
  // Unit test case.
  it("treats 5xx, 408, 429 as transient", () => {
    // Assert expected test outcome.
    assert.equal(isTransientStatus(500), true);
    // Assert expected test outcome.
    assert.equal(isTransientStatus(503), true);
    // Assert expected test outcome.
    assert.equal(isTransientStatus(408), true);
    // Assert expected test outcome.
    assert.equal(isTransientStatus(429), true);
  });

  // Unit test case.
  it("does not treat 401/403/404 as transient", () => {
    // Assert expected test outcome.
    assert.equal(isTransientStatus(401), false);
    // Assert expected test outcome.
    assert.equal(isTransientStatus(403), false);
    // Assert expected test outcome.
    assert.equal(isTransientStatus(404), false);
  });
});

// Group related unit tests.
describe("classifyRefreshFailure", () => {
  // Unit test case.
  it("rejects only on 401/403", () => {
    // Assert expected test outcome.
    assert.equal(classifyRefreshFailure(401), "rejected");
    // Assert expected test outcome.
    assert.equal(classifyRefreshFailure(403), "rejected");
  });

  // Unit test case.
  it("is transient on network and 5xx", () => {
    // Assert expected test outcome.
    assert.equal(classifyRefreshFailure("network"), "transient");
    // Assert expected test outcome.
    assert.equal(classifyRefreshFailure(500), "transient");
    // Assert expected test outcome.
    assert.equal(classifyRefreshFailure(503), "transient");
  });
});

// Group related unit tests.
describe("shouldWipeOfflineOnBootstrap", () => {
  // Unit test case.
  it("keeps outbox on network with cached user", () => {
    // Assert expected test outcome.
    assert.equal(
      // Open multi-line construct.
      shouldWipeOfflineOnBootstrap({
        // Field/property in this shape.
        hasCachedUser: true,
        // Field/property in this shape.
        failure: { kind: "network" },
      }),
      // List item in import/export/params.
      false,
    );
  });

  // Unit test case.
  it("keeps outbox on 5xx with cached user", () => {
    // Assert expected test outcome.
    assert.equal(
      // Open multi-line construct.
      shouldWipeOfflineOnBootstrap({
        // Field/property in this shape.
        hasCachedUser: true,
        // Field/property in this shape.
        failure: { kind: "transient_http", status: 503 },
      }),
      // List item in import/export/params.
      false,
    );
  });

  // Unit test case.
  it("keeps outbox on unverified 401 with cached user", () => {
    // Assert expected test outcome.
    assert.equal(
      // Open multi-line construct.
      shouldWipeOfflineOnBootstrap({
        // Field/property in this shape.
        hasCachedUser: true,
        // Field/property in this shape.
        failure: { kind: "unverified_401", status: 401 },
      }),
      // List item in import/export/params.
      false,
    );
  });

  // Unit test case.
  it("wipes on auth_rejected even with cached user", () => {
    // Assert expected test outcome.
    assert.equal(
      // Open multi-line construct.
      shouldWipeOfflineOnBootstrap({
        // Field/property in this shape.
        hasCachedUser: true,
        // Field/property in this shape.
        failure: { kind: "auth_rejected", status: 401 },
      }),
      // List item in import/export/params.
      true,
    );
  });

  // Unit test case.
  it("wipes when there is no cached user", () => {
    // Assert expected test outcome.
    assert.equal(
      // Open multi-line construct.
      shouldWipeOfflineOnBootstrap({
        // Field/property in this shape.
        hasCachedUser: false,
        // Field/property in this shape.
        failure: { kind: "network" },
      }),
      // List item in import/export/params.
      true,
    );
  });

  // Unit test case.
  it("documents that explicit logout always wipes (bypasses this helper)", () => {
    // logout/logoutAll call clearSession directly — not shouldWipeOfflineOnBootstrap.
    // This assertion locks the bootstrap keep path so logout remains the wipe path.
    assert.equal(
      // Open multi-line construct.
      shouldWipeOfflineOnBootstrap({
        // Field/property in this shape.
        hasCachedUser: true,
        // Field/property in this shape.
        failure: { kind: "network" },
      }),
      // List item in import/export/params.
      false,
    );
  });
});

// Group related unit tests.
describe("classifyBootstrapError", () => {
  // Unit test case.
  it("maps network kind", () => {
    // Assert expected test outcome.
    assert.deepEqual(classifyBootstrapError({ kind: "network" }), {
      // Field/property in this shape.
      kind: "network",
    });
  });

  // Unit test case.
  it("maps 503 to transient_http", () => {
    // Assert expected test outcome.
    assert.deepEqual(
      // Invoke helper or pass arguments.
      classifyBootstrapError({ kind: "http", status: 503 }),
      // Continue multi-line list/arguments.
      { kind: "transient_http", status: 503 },
    );
  });

  // Unit test case.
  it("maps 401 + rejected refresh to auth_rejected", () => {
    // Assert expected test outcome.
    assert.deepEqual(
      // Open multi-line construct.
      classifyBootstrapError({
        // Field/property in this shape.
        kind: "http",
        // Field/property in this shape.
        status: 401,
        // Field/property in this shape.
        refreshOutcome: "rejected",
      }),
      // Continue multi-line list/arguments.
      { kind: "auth_rejected", status: 401 },
    );
  });

  // Unit test case.
  it("maps 401 + transient refresh to unverified_401", () => {
    // Assert expected test outcome.
    assert.deepEqual(
      // Open multi-line construct.
      classifyBootstrapError({
        // Field/property in this shape.
        kind: "http",
        // Field/property in this shape.
        status: 401,
        // Field/property in this shape.
        refreshOutcome: "transient",
      }),
      // Continue multi-line list/arguments.
      { kind: "unverified_401", status: 401 },
    );
  });
});

// Group related unit tests.
describe("classifyBootstrapError edge cases", () => {
  // Unit test case.
  it("preserves explicit auth rejection even when the HTTP status is transient", () => {
    // Assert expected test outcome.
    assert.deepEqual(
      // Invoke helper or pass arguments.
      classifyBootstrapError({ status: 503, authRejected: true }),
      // Continue multi-line list/arguments.
      { kind: "auth_rejected", status: 503 },
    );
  });

  // Unit test case.
  it("gives an explicit network classification precedence over a status", () => {
    // Assert expected test outcome.
    assert.deepEqual(classifyBootstrapError({ kind: "network", status: 503 }), {
      // Field/property in this shape.
      kind: "network",
    });
  });

  // Unit test case.
  it("classifies 403 without refresh metadata as rejected", () => {
    // Assert expected test outcome.
    assert.deepEqual(classifyBootstrapError({ status: 403 }), {
      // Field/property in this shape.
      kind: "auth_rejected",
      // Field/property in this shape.
      status: 403,
    });
  });

  // Unit test case.
  it("treats null and primitive throws as network failures", () => {
    // Assert expected test outcome.
    assert.deepEqual(classifyBootstrapError(null), { kind: "network" });
    // Assert expected test outcome.
    assert.deepEqual(classifyBootstrapError("fetch failed"), {
      // Field/property in this shape.
      kind: "network",
    });
  });

  // Unit test case.
  it("uses an explicit rejected refresh outcome even without authRejected", () => {
    // Assert expected test outcome.
    assert.deepEqual(
      // Invoke helper or pass arguments.
      classifyBootstrapError({ status: 503, refreshOutcome: "rejected" }),
      // Continue multi-line list/arguments.
      { kind: "auth_rejected", status: 503 },
    );
  });

  // Unit test case.
  it("keeps unknown non-transient HTTP statuses distinct from transient HTTP", () => {
    // Assert expected test outcome.
    assert.deepEqual(classifyBootstrapError({ status: 404 }), {
      // Field/property in this shape.
      kind: "network",
    });
  });

  // Unit test case.
  it("treats function throws as unknown network failures", () => {
    // Local constant binding.
    const thrown = Object.assign(() => {}, { status: 503 });
    // Assert expected test outcome.
    assert.deepEqual(classifyBootstrapError(thrown), { kind: "network" });
  });
});
