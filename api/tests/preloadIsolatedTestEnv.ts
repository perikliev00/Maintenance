/**
 * Side-effect preload: MUST be the first import in mutating P1 suites so
 * DATABASE_URL is rewritten before `src/db` constructs the shared PrismaClient.
 */
import path from "node:path";
// Import bindings from dotenv.
import dotenv from "dotenv";
// Guard that mutating suites only run against the isolated test database.
import { applyIsolatedTestDatabaseConfig } from "./assertTestDatabase";

// Execute the next setup or assertion step for this scenario.
dotenv.config({
  // Execute the next setup or assertion step for this scenario.
  path: path.resolve(__dirname, "../.env"),
  // Execute the next setup or assertion step for this scenario.
  override: true,
});
// Concurrency/isolation step for the race under test.
applyIsolatedTestDatabaseConfig();
