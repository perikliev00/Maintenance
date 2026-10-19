/**
 * Side-effect preload: MUST be the first import in mutating P1 suites so
 * DATABASE_URL is rewritten before `src/db` constructs the shared PrismaClient.
 */
import path from "node:path";
import dotenv from "dotenv";
import { applyIsolatedTestDatabaseConfig } from "./assertTestDatabase";

dotenv.config({
  path: path.resolve(__dirname, "../.env"),
  override: true,
});
applyIsolatedTestDatabaseConfig();
