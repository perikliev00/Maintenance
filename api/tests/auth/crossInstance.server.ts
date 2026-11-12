/**
 * Dedicated OS process for cross-instance RoleGrant cache tests.
 * Prints one READY line with the bound port, then serves createApp().
 *
 * Env required: DATABASE_URL, JWT_SECRET, EXPECTED_TEST_DATABASE.
 * Does not start the job scheduler (DISABLE_JOB_SCHEDULER=1).
 */
import http from "node:http";
// Import bindings from ../../src/app.
import { createApp, setBootstrapComplete } from "../../src/app";

// Override env for isolation, rate-limit disable, or scheduler quieting.
process.env.DISABLE_JOB_SCHEDULER = "1";

// app: in-process HTTP server handle for this suite.
const app = createApp();
// Execute the next setup or assertion step for this scenario.
setBootstrapComplete(true);
// server: in-process HTTP server handle for this suite.
const server = http.createServer(app);

// Execute the next setup or assertion step for this scenario.
server.listen(0, "127.0.0.1", () => {
  // Bind addr for later setup or assertions in this scope.
  const addr = server.address();
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (!addr || typeof addr === "string") {
    // Execute the next setup or assertion step for this scenario.
    console.error("crossInstance.server: failed to bind");
    // Execute the next setup or assertion step for this scenario.
    process.exit(1);
  }
  // Single machine-readable line for the parent test harness.
  process.stdout.write(`CROSS_INSTANCE_READY ${JSON.stringify({ port: addr.port })}\n`);
});

// Bind shutdown for later setup or assertions in this scope.
const shutdown = () => {
  // Execute the next setup or assertion step for this scenario.
  server.close(() => process.exit(0));
};
// Execute the next setup or assertion step for this scenario.
process.on("SIGTERM", shutdown);
// Execute the next setup or assertion step for this scenario.
process.on("SIGINT", shutdown);
