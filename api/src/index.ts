/**
 * Production entrypoint: validate config, listen for traffic, then run required
 * DB defaults. Readiness stays 503 until bootstrap succeeds; only then mark
 * complete and start the job scheduler under current conditions.
 */
// Load .env before assertEnv and PORT resolution.
import "dotenv/config";
// Node HTTP server wrapping the Express app.
import { createServer } from "node:http";
// Fail fast on missing/insecure environment configuration.
import { assertEnv } from "./env";
// App factory and flags that gate readiness / drain traffic.
import { createApp, setBootstrapComplete, setShuttingDown } from "./app";
// Required RoleGrant and related defaults seeded after listen.
import { initializeRequiredDefaults } from "./startup/requiredDefaults";
// Stop background job loops during graceful shutdown.
import { stopJobScheduler } from "./services/jobs";
// Start the scheduler only after bootstrap completes (and not if closing).
import { wireJobSchedulerAfterBootstrap } from "./services/jobs/schedulerBoot";
// Prisma pool to disconnect on fatal bootstrap or shutdown.
import { prisma } from "./db";
// Close open SSE connections before the process exits.
import { closeSseStreams } from "./controllers/events";
// Structured logging with redacted error messages.
import { log, safeErrorMessage } from "./observability";

// Listen first, then bootstrap defaults so probes can hit /health immediately.
async function main() {
  // Validate JWT_SECRET, PORT, production constraints, etc.
  assertEnv();
  // Default API port when PORT is unset.
  const port = Number(process.env.PORT ?? 4000);
  // Create the HTTP server around a fresh Express app.
  const server = createServer(createApp());
  // Prevent double shutdown and skip scheduler start if already closing.
  let closing = false;
  // Track bootstrap promise so shutdown can wait for it.
  let startupTask: Promise<void> = Promise.resolve();
  // Bind all interfaces so container/host networking can reach the API.
  server.listen(port, "0.0.0.0", () => {
    log.info("listening", { port, release: process.env.RELEASE_SHA ?? "unknown" });
    // After accept, seed required defaults then mark ready + start jobs.
    startupTask = initializeRequiredDefaults()
      .then(() => {
        setBootstrapComplete(true);
        // E2E / local probes set DISABLE_JOB_SCHEDULER=1 so manual POST /jobs/run
        // is not blocked by the boot cycle holding the advisory lock.
        wireJobSchedulerAfterBootstrap(closing);
      })
      .catch(async (err) => {
        // Bootstrap failure is fatal: drain, disconnect, exit non-zero.
        log.fatal("bootstrap_failed", { error: safeErrorMessage(err) });
        setShuttingDown(true);
        server.close();
        await prisma.$disconnect().catch(() => undefined);
        process.exitCode = 1;
      });
  });
  // Listen errors (e.g. EADDRINUSE) should fail the process.
  server.on("error", (err) => {
    log.fatal("listen_failed", { error: err.message });
    process.exitCode = 1;
  });

  // Shared SIGTERM/SIGINT handler for graceful drain.
  const shutdown = (signal: string) => {
    // Ignore duplicate signals once drain has started.
    if (closing) return;
    closing = true;
    setShuttingDown(true);
    log.info("shutdown_started", { signal });
    // Hard-exit if graceful close hangs past 25s.
    const timeout = setTimeout(() => process.exit(1), 25_000);
    // Do not keep the event loop alive solely for the force-exit timer.
    timeout.unref();
    // Drop SSE clients so they reconnect to a healthy instance.
    closeSseStreams();
    // Wait for the HTTP server to stop accepting connections.
    const serverClosed = new Promise<void>((resolve) => server.close(() => resolve()));
    // Join server close, job stop, and any in-flight bootstrap before disconnect.
    void Promise.all([serverClosed, stopJobScheduler(), startupTask])
      .then(() => prisma.$disconnect())
      .then(() => { clearTimeout(timeout); process.exit(0); })
      .catch((err) => { console.error("graceful shutdown failed", err); process.exit(1); });
  };
  // Container orchestrators send SIGTERM on stop.
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  // Local Ctrl+C uses SIGINT.
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// Top-level startup failures (before listen) still disconnect Prisma.
main().catch(async (err) => {
  log.fatal("startup_failed", { error: safeErrorMessage(err) });
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
