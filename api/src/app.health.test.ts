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
    // Support the surrounding logic for this step.
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
    // Wait for an async operation before continuing.
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    // Bind address for use in the following logic.
    const address = server.address();
    // Guard against rare string/pipe address shapes.
    if (!address || typeof address === "string") throw new Error("test server failed to bind");
    // Pass baseUrl prop/value into the element or config.
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  // Reset flags and close the server so later suites start clean.
  after(async () => {
    // Update React state so the UI reflects the new value.
    setBootstrapComplete(false);
    // Update React state so the UI reflects the new value.
    setShuttingDown(false);
    // Wait for an async operation before continuing.
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // Liveness stays up; readiness stays 503 and must not hit the DB yet.
  it("reports liveness while required bootstrap has not completed", async () => {
    // Update React state so the UI reflects the new value.
    setBootstrapComplete(false);
    // Support the surrounding logic for this step.
    probeCalls = 0;
    // Assert expected behavior in this test case.
    assert.equal((await fetch(`${baseUrl}/health/live`)).status, 200);
    // Assert expected behavior in this test case.
    assert.equal((await fetch(`${baseUrl}/health/ready`)).status, 503);
    // Assert expected behavior in this test case.
    assert.equal(probeCalls, 0, "DB probe must be skipped before bootstrap completes");
  });

  // After bootstrap, a failing probe still yields 503 with dependency metadata.
  it("returns 503 while the database is unavailable after bootstrap", async () => {
    // Update React state so the UI reflects the new value.
    setBootstrapComplete(true);
    // Begin guarded block to catch runtime failures.
    try {
      // Capture remote/API result needed by this flow.
      const response = await fetch(`${baseUrl}/health/ready`);
      // Assert expected behavior in this test case.
      assert.equal(response.status, 503);
      // Assert expected behavior in this test case.
      assert.deepEqual(await response.json(), { ok: false, ready: false, dependency: "database" });
    // Support the surrounding logic for this step.
    } finally {
      // Leave bootstrap false for the next case.
      setBootstrapComplete(false);
    }
  });

  // During shutdown, readiness stays false and mutating routes get 503.
  it("keeps readiness false and blocks new application traffic during shutdown", async () => {
    // Update React state so the UI reflects the new value.
    setBootstrapComplete(true);
    // Update React state so the UI reflects the new value.
    setShuttingDown(true);
    // Support the surrounding logic for this step.
    probeCalls = 0;
    // Assert expected behavior in this test case.
    assert.equal((await fetch(`${baseUrl}/health/ready`)).status, 503);
    // Assert expected behavior in this test case.
    assert.equal(probeCalls, 0, "DB probe must be skipped during shutdown");
    // Arbitrary app route to prove the shutdown middleware blocks traffic.
    const response = await fetch(`${baseUrl}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    // Assert expected behavior in this test case.
    assert.equal(response.status, 503);
  });
});

// Separate suite with a healthy probe so readiness can return 200.
describe("health readiness after successful bootstrap", () => {
  // Counts successful probe invocations.
  let probeCalls = 0;
  // Probe that resolves without throwing (DB considered healthy).
  const okProbe = async () => {
    // Support the surrounding logic for this step.
    probeCalls += 1;
  };
  // Bind server for use in the following logic.
  const server = createServer(createApp({ probeDatabase: okProbe }));
  // Bind baseUrl for use in the following logic.
  let baseUrl = "";
  // Register test lifecycle hook for setup or teardown.
  before(async () => {
    // Wait for an async operation before continuing.
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    // Bind address for use in the following logic.
    const address = server.address();
    // Conditional branch for the case described by this guard.
    if (!address || typeof address === "string") throw new Error("test server failed to bind");
    // Pass baseUrl prop/value into the element or config.
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  // Register test lifecycle hook for setup or teardown.
  after(async () => {
    // Update React state so the UI reflects the new value.
    setBootstrapComplete(false);
    // Update React state so the UI reflects the new value.
    setShuttingDown(false);
    // Wait for an async operation before continuing.
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // Full happy path: bootstrap done, not shutting down, probe succeeds once.
  it("returns 200 { ok: true, ready: true } after bootstrap with a successful probe", async () => {
    // Update React state so the UI reflects the new value.
    setBootstrapComplete(true);
    // Update React state so the UI reflects the new value.
    setShuttingDown(false);
    // Support the surrounding logic for this step.
    probeCalls = 0;
    // Begin guarded block to catch runtime failures.
    try {
      // Capture remote/API result needed by this flow.
      const response = await fetch(`${baseUrl}/health/ready`);
      // Assert expected behavior in this test case.
      assert.equal(response.status, 200);
      // Assert expected behavior in this test case.
      assert.deepEqual(await response.json(), { ok: true, ready: true });
      // Assert expected behavior in this test case.
      assert.equal(probeCalls, 1);
    // Support the surrounding logic for this step.
    } finally {
      // Update React state so the UI reflects the new value.
      setBootstrapComplete(false);
    }
  });
});
