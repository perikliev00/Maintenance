/**
 * Dedicated OS process for cross-instance RoleGrant cache tests.
 * Prints one READY line with the bound port, then serves createApp().
 *
 * Env required: DATABASE_URL, JWT_SECRET, EXPECTED_TEST_DATABASE.
 * Does not start the job scheduler (DISABLE_JOB_SCHEDULER=1).
 */
import http from "node:http";
import { createApp, setBootstrapComplete } from "../../src/app";

process.env.DISABLE_JOB_SCHEDULER = "1";

const app = createApp();
setBootstrapComplete(true);
const server = http.createServer(app);

server.listen(0, "127.0.0.1", () => {
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    console.error("crossInstance.server: failed to bind");
    process.exit(1);
  }
  // Single machine-readable line for the parent test harness.
  process.stdout.write(`CROSS_INSTANCE_READY ${JSON.stringify({ port: addr.port })}\n`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
