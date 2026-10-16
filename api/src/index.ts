/**
 * Process entrypoint: validate env, bind the Express app, then start the
 * in-process background job scheduler once the HTTP server is listening.
 */
import "dotenv/config";
import { assertEnv } from "./env";
import { createApp } from "./app";
import { startJobScheduler } from "./services/jobs";

// Fail fast before binding a port if required secrets/config are invalid.
try {
  assertEnv();
} catch (err) {
  // Log the message and exit non-zero so process managers do not keep restarting a broken config.
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

// PORT from env, default local API port.
const port = Number(process.env.PORT ?? 4000);
// Build the Express app (middleware + routers); does not listen yet.
const app = createApp();

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
  // Scheduler depends on a live process; start only after listen succeeds.
  startJobScheduler();
  console.log("Background job scheduler started");
});
