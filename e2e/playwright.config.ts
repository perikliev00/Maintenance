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

export default defineConfig({
  testDir: "./tests",
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
          command: "npx tsx src/index.ts",
          cwd: apiDir,
          url: apiHealthURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
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
