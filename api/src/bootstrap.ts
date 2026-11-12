// Load .env into process.env before assertEnv reads required secrets.
import "dotenv/config";
// Fail fast when JWT_SECRET / production constraints are missing or unsafe.
import { assertEnv } from "./env";
// Seeds required RoleGrant / defaults so the API can authorize after boot.
import { initializeRequiredDefaults } from "./startup/requiredDefaults";
// Shared Prisma singleton used to disconnect after bootstrap finishes.
import { prisma } from "./db";
// Structured logging helpers for success and fatal failure paths.
import { log, safeErrorMessage } from "./observability";

// One-shot CLI entry: validate env, seed defaults, then exit.
async function main() {
  // Refuse to continue with missing or insecure configuration.
  assertEnv();
  // Persist required DB defaults (grants, etc.) before operators rely on the API.
  await initializeRequiredDefaults();
  // Signal successful offline bootstrap for operators/logs.
  log.info("bootstrap_complete");
}
// Run main and mark the process failed if bootstrap throws.
main().catch((error) => {
  // Never print raw secrets; safeErrorMessage redacts connection strings.
  log.fatal("bootstrap_failed", { error: safeErrorMessage(error) });
  // Non-zero exit for scripts/CI without an immediate hard exit.
  process.exitCode = 1;
// Always release the Prisma pool whether bootstrap succeeded or failed.
}).finally(() => prisma.$disconnect());
