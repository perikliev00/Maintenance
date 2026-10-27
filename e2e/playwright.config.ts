import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(rootDir, "api");
const webDir = path.join(rootDir, "web");

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";
const apiHealthURL =
  process.env.E2E_API_HEALTH_URL ?? "http://127.0.0.1:4000/health";

/** When unset, start API + Vite locally (reuse if already running outside CI). */
const startServers = process.env.E2E_START_SERVERS !== "0";

/**
 * Main Playwright suite must use the P1 isolated test database — never ambient
 * api/.env (which may point at a seeded or production-like DB). Matches scenario
 * E2E: registerP1TestEnv.mjs enforces DATABASE_URL → maintenance_p1_test.
 */
export default defineConfig({
  testDir: "./tests",
  testIgnore: "**/scenarios/**",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: startServers
    ? [
        {
          // Fail closed: P1 register redirects dotenv .env → .env.p1_test and
          // rejects non-maintenance_p1_test database names.
          command:
            "node --import ./tests/registerP1TestEnv.mjs ./node_modules/tsx/dist/cli.mjs src/index.ts",
          cwd: apiDir,
          url: apiHealthURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: {
            ...process.env,
            // Suite logins + live polls exceed production IP budgets from one runner.
            E2E_DISABLE_RATE_LIMIT: "1",
          },
        },
        {
          command: "npm run dev -- --host 127.0.0.1 --port 5173",
          cwd: webDir,
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      ]
    : undefined,
});
