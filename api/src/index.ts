/** Production entrypoint: validate config, complete bootstrap, then listen. */
import "dotenv/config";
import { createServer } from "node:http";
import { assertEnv } from "./env";
import { createApp, initializeRequiredDefaults, setShuttingDown } from "./app";
import { startJobScheduler, stopJobScheduler } from "./services/jobs";
import { prisma } from "./db";
import { closeSseStreams } from "./controllers/events";
import { safeErrorMessage } from "./observability";

async function main() {
  assertEnv();
  const port = Number(process.env.PORT ?? 4000);
  const server = createServer(createApp());
  let closing = false;
  let startupTask: Promise<void> = Promise.resolve();
  server.listen(port, "0.0.0.0", () => {
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: "info", service: "maintenance-api", event: "listening", port, release: process.env.RELEASE_SHA ?? "unknown" }));
    startupTask = initializeRequiredDefaults()
      .then(() => { if (!closing) startJobScheduler(); })
      .catch(async (err) => {
        console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: "fatal", service: "maintenance-api", event: "bootstrap_failed", error: safeErrorMessage(err) }));
        setShuttingDown(true);
        server.close();
        await prisma.$disconnect().catch(() => undefined);
        process.exitCode = 1;
      });
  });
  server.on("error", (err) => {
    console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: "fatal", service: "maintenance-api", event: "listen_failed", error: err.message }));
    process.exitCode = 1;
  });

  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    setShuttingDown(true);
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: "info", service: "maintenance-api", event: "shutdown_started", signal }));
    const timeout = setTimeout(() => process.exit(1), 25_000);
    timeout.unref();
    closeSseStreams();
    const serverClosed = new Promise<void>((resolve) => server.close(() => resolve()));
    void Promise.all([serverClosed, stopJobScheduler(), startupTask])
      .then(() => prisma.$disconnect())
      .then(() => { clearTimeout(timeout); process.exit(0); })
      .catch((err) => { console.error("graceful shutdown failed", err); process.exit(1); });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch(async (err) => {
  console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: "fatal", service: "maintenance-api", event: "startup_failed", error: safeErrorMessage(err) }));
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
