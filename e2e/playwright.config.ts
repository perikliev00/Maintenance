// Playwright test runner APIs for browser E2E scenarios.
import { defineConfig, devices } from "@playwright/test";
// Import bindings from node:path.
import path from "node:path";
// Import bindings from node:url.
import { fileURLToPath } from "node:url";

// rootDir: path/URL used to reach the system under test.
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// apiDir: path/URL used to reach the system under test.
const apiDir = path.join(rootDir, "api");
// webDir: path/URL used to reach the system under test.
const webDir = path.join(rootDir, "web");

// baseURL: path/URL used to reach the system under test.
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";
// apiHealthURL: path/URL used to reach the system under test.
const apiHealthURL =
  // Override env for isolation, rate-limit disable, or scheduler quieting.
  process.env.E2E_API_HEALTH_URL ?? "http://127.0.0.1:4000/health";

/** When unset, start API + Vite locally (reuse if already running outside CI). */
const startServers = process.env.E2E_START_SERVERS !== "0";

/**
 * Main Playwright suite must use the P1 isolated test database — never ambient
 * api/.env (which may point at a seeded or production-like DB). Matches scenario
 * E2E: registerP1TestEnv.mjs enforces DATABASE_URL → maintenance_p1_test.
 */
export default defineConfig({
  // Runner option controlling stability or isolation of the suite.
  testDir: "./tests",
  // Execute the next setup or assertion step for this scenario.
  testIgnore: "**/scenarios/**",
  // Serialize workers to avoid cross-test DB/UI interference.
  fullyParallel: false,
  // Override env for isolation, rate-limit disable, or scheduler quieting.
  forbidOnly: !!process.env.CI,
  // Override env for isolation, rate-limit disable, or scheduler quieting.
  retries: process.env.CI ? 1 : 0,
  // Serialize workers to avoid cross-test DB/UI interference.
  workers: 1,
  // Override env for isolation, rate-limit disable, or scheduler quieting.
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  // Runner option controlling stability or isolation of the suite.
  timeout: 60_000,
  // Runner option controlling stability or isolation of the suite.
  expect: { timeout: 15_000 },
  // Runner option controlling stability or isolation of the suite.
  use: {
    // Execute the next setup or assertion step for this scenario.
    baseURL,
    // Configure trace for the request/server under test.
    trace: "on-first-retry",
    // Configure screenshot for the request/server under test.
    screenshot: "only-on-failure",
    // Configure video for the request/server under test.
    video: "retain-on-failure",
  },
  // Runner option controlling stability or isolation of the suite.
  projects: [
    {
      // Fixture field name for the seeded actor/entity.
      name: "chromium",
      // Runner option controlling stability or isolation of the suite.
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Optionally boot API+Vite with P1 test DB env for local E2E.
  webServer: startServers
    ? [
        {
          // Fail closed: P1 register redirects dotenv .env → .env.p1_test and
          // rejects non-maintenance_p1_test database names.
          command:
            // Execute the next setup or assertion step for this scenario.
            "node --import ./tests/registerP1TestEnv.mjs ./node_modules/tsx/dist/cli.mjs src/index.ts",
          // Configure cwd for the request/server under test.
          cwd: apiDir,
          // Configure url for the request/server under test.
          url: apiHealthURL,
          // Override env for isolation, rate-limit disable, or scheduler quieting.
          reuseExistingServer: !process.env.CI,
          // Runner option controlling stability or isolation of the suite.
          timeout: 120_000,
          // Configure env for the request/server under test.
          env: {
            // Continue the call chain for setup or assertion detail.
            ...process.env,
            // Suite logins + live polls exceed production IP budgets from one runner.
            E2E_DISABLE_RATE_LIMIT: "1",
            // Avoid boot/interval job cycles holding the advisory lock during
            // Audit live E2E POST /jobs/run (otherwise 409 job_already_running).
            DISABLE_JOB_SCHEDULER: "1",
          },
        },
        {
          // Configure command for the request/server under test.
          command: "npm run dev -- --host 127.0.0.1 --port 5173",
          // Configure cwd for the request/server under test.
          cwd: webDir,
          // Configure url for the request/server under test.
          url: baseURL,
          // Override env for isolation, rate-limit disable, or scheduler quieting.
          reuseExistingServer: !process.env.CI,
          // Runner option controlling stability or isolation of the suite.
          timeout: 120_000,
        },
      ]
    : undefined,
});
