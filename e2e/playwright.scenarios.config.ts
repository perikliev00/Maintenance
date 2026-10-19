import { defineConfig, devices } from "@playwright/test";
process.env.E2E_API_ORIGIN = "http://127.0.0.1:4018";
export default defineConfig({
  testDir: "./tests", fullyParallel: false, workers: 1, retries: 0,
  timeout: 60000, expect: { timeout: 10000 }, reporter: "list",
  outputDir: "test-results/scenarios",
  use: { baseURL: "http://127.0.0.1:5185", screenshot: "only-on-failure", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    { command: "node --import ./tests/registerP1TestEnv.mjs --import tsx tests/scenarios/startApi.ts", cwd: "../api", url: "http://127.0.0.1:4018/health", reuseExistingServer: false },
    { command: "node ./node_modules/vite/bin/vite.js --config vite.scenarios.config.ts", cwd: "../web", url: "http://127.0.0.1:5185", reuseExistingServer: false },
  ],
});
