// Import module dependency from node:assert/strict.
import assert from "node:assert/strict";
// Import module dependency from node:fs.
import { readFileSync } from "node:fs";
// Import module dependency from node:path.
import { join } from "node:path";
// Import module dependency from node:test.
import { describe, it } from "node:test";

// Bind srcRoot for use in the following logic.
const srcRoot = join(__dirname, "..");

// Group related tests under a shared suite name.
describe("requiredDefaults wiring", () => {
  // Define a single test case and its expectation.
  it("startup module does not import Express app or readiness flags", () => {
    // Bind raw for use in the following logic.
    const raw = readFileSync(join(__dirname, "requiredDefaults.ts"), "utf8");
    // Invoke assert.doesNotMatch to perform this step.
    assert.doesNotMatch(raw, /from ["']\.\.\/app["']/);
    // Ensure the startup module never imports Express directly.
    assert.doesNotMatch(raw, /from ["']express["']/);
    // Ensure readiness flag helpers are not referenced from this module.
    assert.doesNotMatch(raw, /\bsetBootstrapComplete\b|\bsetShuttingDown\b/);
  });

  // Define a single test case and its expectation.
  it("bootstrap and index import defaults from startup, not app", () => {
    // Bind bootstrap for use in the following logic.
    const bootstrap = readFileSync(join(srcRoot, "bootstrap.ts"), "utf8");
    // Bind index for use in the following logic.
    const index = readFileSync(join(srcRoot, "index.ts"), "utf8");
    // Assert bootstrap pulls requiredDefaults from the startup path.
    assert.match(bootstrap, /from ["']\.\/startup\/requiredDefaults["']/);
    // Invoke assert.match to perform this step.
    assert.match(index, /from ["']\.\/startup\/requiredDefaults["']/);
    // Assert bootstrap does not import defaults via app.ts.
    assert.doesNotMatch(bootstrap, /from ["']\.\/app["']/);
    // Assert index does not import initializeRequiredDefaults from app.
    assert.doesNotMatch(index, /initializeRequiredDefaults.*from ["']\.\/app["']/);
  });

  // Define a single test case and its expectation.
  it("index marks readiness only after successful defaults, before scheduler wire", () => {
    // Bind index for use in the following logic.
    const index = readFileSync(join(srcRoot, "index.ts"), "utf8");
    // Bind thenIdx for use in the following logic.
    const thenIdx = index.indexOf("initializeRequiredDefaults()");
    // Bind markIdx for use in the following logic.
    const markIdx = index.indexOf("setBootstrapComplete(true)");
    // Bind wireIdx for use in the following logic.
    const wireIdx = index.indexOf("wireJobSchedulerAfterBootstrap(closing)");
    // Invoke assert.ok to perform this step.
    assert.ok(thenIdx >= 0 && markIdx > thenIdx && wireIdx > markIdx);
  });
});
