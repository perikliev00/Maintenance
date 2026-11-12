// Strict assertions for health/readiness HTTP status and JSON bodies.
import assert from "node:assert/strict";
// Lightweight HTTP server wrapper around the Express app under test.
import { createServer } from "node:http";
// Node test lifecycle hooks and suite helpers.
import { after, before, describe, it } from "node:test";
// App factory plus bootstrap/shutdown flags that gate /health/ready.
import { createApp, setBootstrapComplete, setShuttingDown } from "./app";

// Covers 503 paths while bootstrap is incomplete, DB fails, or shutdown is on.
describe("health and readiness endpoints", () => {
  // Counts how often the injected DB probe runs (should stay 0 when skipped).
  let probeCalls = 0;
  // Probe that always fails so readiness reports dependency: database.
  const failingProbe = async () => {
    probeCalls += 1;
    // Abort this path by throwing an error to callers.
    throw new Error("database unavailable");
  };
  // Bind createApp with the failing probe for this suite.
  const server = createServer(createApp({ probeDatabase: failingProbe }));
  // Filled after listen(0) with the ephemeral port URL.
  let baseUrl = "";
  // Start listening on localhost with an OS-assigned port.
  before(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    // Guard against rare string/pipe address shapes.
    if (!address || typeof address === "string") throw new Error("test server failed to bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  // Reset flags and close the server so later suites start clean.
  after(async () => {
    setBootstrapComplete(false);
    setShuttingDown(false);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // Liveness stays up; readiness stays 503 and must not hit the DB yet.
  it("reports liveness while required bootstrap has not completed", async () => {
    setBootstrapComplete(false);
    probeCalls = 0;
    assert.equal((await fetch(`${baseUrl}/health/live`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/health/ready`)).status, 503);
    assert.equal(probeCalls, 0, "DB probe must be skipped before bootstrap completes");
  });

  // After bootstrap, a failing probe still yields 503 with dependency metadata.
  it("returns 503 while the database is unavailable after bootstrap", async () => {
    setBootstrapComplete(true);
    try {
      // Capture remote/API result needed by this flow.
      const response = await fetch(`${baseUrl}/health/ready`);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { ok: false, ready: false, dependency: "database" });
    } finally {
      // Leave bootstrap false for the next case.
      setBootstrapComplete(false);
    }
  });

  // During shutdown, readiness stays false and mutating routes get 503.
  it("keeps readiness false and blocks new application traffic during shutdown", async () => {
    setBootstrapComplete(true);
    setShuttingDown(true);
    probeCalls = 0;
    assert.equal((await fetch(`${baseUrl}/health/ready`)).status, 503);
    assert.equal(probeCalls, 0, "DB probe must be skipped during shutdown");
    // Arbitrary app route to prove the shutdown middleware blocks traffic.
    const response = await fetch(`${baseUrl}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(response.status, 503);
  });
});

// Separate suite with a healthy probe so readiness can return 200.
describe("health readiness after successful bootstrap", () => {
  // Counts successful probe invocations.
  let probeCalls = 0;
  // Probe that resolves without throwing (DB considered healthy).
  const okProbe = async () => {
    probeCalls += 1;
  };
  const server = createServer(createApp({ probeDatabase: okProbe }));
  let baseUrl = "";
  // Register test lifecycle hook for setup or teardown.
  before(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server failed to bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  // Register test lifecycle hook for setup or teardown.
  after(async () => {
    setBootstrapComplete(false);
    setShuttingDown(false);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // Full happy path: bootstrap done, not shutting down, probe succeeds once.
  it("returns 200 { ok: true, ready: true } after bootstrap with a successful probe", async () => {
    setBootstrapComplete(true);
    setShuttingDown(false);
    probeCalls = 0;
    try {
      // Capture remote/API result needed by this flow.
      const response = await fetch(`${baseUrl}/health/ready`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, ready: true });
      assert.equal(probeCalls, 1);
    } finally {
      setBootstrapComplete(false);
    }
  });
});
