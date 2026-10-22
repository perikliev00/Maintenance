import "dotenv/config";
import { assertEnv } from "./env";
import { initializeRequiredDefaults } from "./app";
import { prisma } from "./db";
import { safeErrorMessage } from "./observability";

async function main() {
  assertEnv();
  await initializeRequiredDefaults();
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: "info", service: "maintenance-api", event: "bootstrap_complete" }));
}
main().catch((error) => {
  console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: "fatal", service: "maintenance-api", event: "bootstrap_failed", error: safeErrorMessage(error) }));
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
