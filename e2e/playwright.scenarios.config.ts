// Playwright test runner APIs for browser E2E scenarios.
import { defineConfig, devices } from "@playwright/test";
// Override env for isolation, rate-limit disable, or scheduler quieting.
process.env.E2E_API_ORIGIN = "http://127.0.0.1:4018";
// Default export of this module's primary configuration or suite entry.
export default defineConfig({
  // Serialize workers to avoid cross-test DB/UI interference.
  testDir: "./tests", fullyParallel: false, workers: 1, retries: 0,
  // Runner option controlling stability or isolation of the suite.
  timeout: 60000, expect: { timeout: 10000 }, reporter: "list",
  // Execute the next setup or assertion step for this scenario.
  outputDir: "test-results/scenarios",
  // Runner option controlling stability or isolation of the suite.
  use: { baseURL: "http://127.0.0.1:5185", screenshot: "only-on-failure", trace: "retain-on-failure" },
  // Runner option controlling stability or isolation of the suite.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Optionally boot API+Vite with P1 test DB env for local E2E.
  webServer: [
    // Execute the next setup or assertion step for this scenario.
    { command: "node --import ./tests/registerP1TestEnv.mjs --import tsx tests/scenarios/startApi.ts", cwd: "../api", url: "http://127.0.0.1:4018/health", reuseExistingServer: false },
    // Execute the next setup or assertion step for this scenario.
    { command: "node ./node_modules/vite/bin/vite.js --config vite.scenarios.config.ts", cwd: "../web", url: "http://127.0.0.1:5185", reuseExistingServer: false },
  ],
});
