import "dotenv/config";
import { assertEnv } from "./env";
import { initializeRequiredDefaults } from "./startup/requiredDefaults";
import { prisma } from "./db";
import { log, safeErrorMessage } from "./observability";

async function main() {
  assertEnv();
  await initializeRequiredDefaults();
  log.info("bootstrap_complete");
}
main().catch((error) => {
  log.fatal("bootstrap_failed", { error: safeErrorMessage(error) });
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
