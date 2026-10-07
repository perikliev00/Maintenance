import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyBootstrapError,
  classifyRefreshFailure,
  isTransientStatus,
  shouldWipeOfflineOnBootstrap,
} from "./sessionPolicy";

describe("isTransientStatus", () => {
  it("treats 5xx, 408, 429 as transient", () => {
    assert.equal(isTransientStatus(500), true);
    assert.equal(isTransientStatus(503), true);
    assert.equal(isTransientStatus(408), true);
    assert.equal(isTransientStatus(429), true);
  });

  it("does not treat 401/403/404 as transient", () => {
    assert.equal(isTransientStatus(401), false);
    assert.equal(isTransientStatus(403), false);
    assert.equal(isTransientStatus(404), false);
  });
});

describe("classifyRefreshFailure", () => {
  it("rejects only on 401/403", () => {
    assert.equal(classifyRefreshFailure(401), "rejected");
    assert.equal(classifyRefreshFailure(403), "rejected");
  });

  it("is transient on network and 5xx", () => {
    assert.equal(classifyRefreshFailure("network"), "transient");
    assert.equal(classifyRefreshFailure(500), "transient");
    assert.equal(classifyRefreshFailure(503), "transient");
  });
});

describe("shouldWipeOfflineOnBootstrap", () => {
  it("keeps outbox on network with cached user", () => {
    assert.equal(
      shouldWipeOfflineOnBootstrap({
        hasCachedUser: true,
        failure: { kind: "network" },
      }),
      false,
    );
  });

  it("keeps outbox on 5xx with cached user", () => {
    assert.equal(
      shouldWipeOfflineOnBootstrap({
        hasCachedUser: true,
        failure: { kind: "transient_http", status: 503 },
      }),
      false,
    );
  });

  it("keeps outbox on unverified 401 with cached user", () => {
    assert.equal(
      shouldWipeOfflineOnBootstrap({
        hasCachedUser: true,
        failure: { kind: "unverified_401", status: 401 },
      }),
      false,
    );
  });

  it("wipes on auth_rejected even with cached user", () => {
    assert.equal(
      shouldWipeOfflineOnBootstrap({
        hasCachedUser: true,
        failure: { kind: "auth_rejected", status: 401 },
      }),
      true,
    );
  });

  it("wipes when there is no cached user", () => {
    assert.equal(
      shouldWipeOfflineOnBootstrap({
        hasCachedUser: false,
        failure: { kind: "network" },
      }),
      true,
    );
  });

  it("documents that explicit logout always wipes (bypasses this helper)", () => {
    // logout/logoutAll call clearSession directly — not shouldWipeOfflineOnBootstrap.
    // This assertion locks the bootstrap keep path so logout remains the wipe path.
    assert.equal(
      shouldWipeOfflineOnBootstrap({
        hasCachedUser: true,
        failure: { kind: "network" },
      }),
      false,
    );
  });
});

describe("classifyBootstrapError", () => {
  it("maps network kind", () => {
    assert.deepEqual(classifyBootstrapError({ kind: "network" }), {
      kind: "network",
    });
  });

  it("maps 503 to transient_http", () => {
    assert.deepEqual(
      classifyBootstrapError({ kind: "http", status: 503 }),
      { kind: "transient_http", status: 503 },
    );
  });

  it("maps 401 + rejected refresh to auth_rejected", () => {
    assert.deepEqual(
      classifyBootstrapError({
        kind: "http",
        status: 401,
        refreshOutcome: "rejected",
      }),
      { kind: "auth_rejected", status: 401 },
    );
  });

  it("maps 401 + transient refresh to unverified_401", () => {
    assert.deepEqual(
      classifyBootstrapError({
        kind: "http",
        status: 401,
        refreshOutcome: "transient",
      }),
      { kind: "unverified_401", status: 401 },
    );
  });
});
