import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, describe, it } from "node:test";
import { createApp, setBootstrapComplete, setShuttingDown } from "./app";

describe("health and readiness endpoints", () => {
  const server = createServer(createApp({ probeDatabase: async () => { throw new Error("database unavailable"); } }));
  let baseUrl = "";
  before(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server failed to bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  after(async () => {
    setBootstrapComplete(false);
    setShuttingDown(false);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("reports liveness while required bootstrap has not completed", async () => {
    setBootstrapComplete(false);
    assert.equal((await fetch(`${baseUrl}/health/live`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/health/ready`)).status, 503);
  });

  it("returns 503 while the database is unavailable after bootstrap", async () => {
    setBootstrapComplete(true);
    try {
      const response = await fetch(`${baseUrl}/health/ready`);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { ok: false, ready: false, dependency: "database" });
    } finally {
      setBootstrapComplete(false);
    }
  });

  it("keeps readiness false and blocks new application traffic during shutdown", async () => {
    setBootstrapComplete(true);
    setShuttingDown(true);
    assert.equal((await fetch(`${baseUrl}/health/ready`)).status, 503);
    const response = await fetch(`${baseUrl}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(response.status, 503);
  });
});
