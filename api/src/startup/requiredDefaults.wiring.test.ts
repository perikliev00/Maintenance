import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const srcRoot = join(__dirname, "..");

describe("requiredDefaults wiring", () => {
  it("startup module does not import Express app or readiness flags", () => {
    const raw = readFileSync(join(__dirname, "requiredDefaults.ts"), "utf8");
    assert.doesNotMatch(raw, /from ["']\.\.\/app["']/);
    // Ensure the startup module never imports Express directly.
    assert.doesNotMatch(raw, /from ["']express["']/);
    // Ensure readiness flag helpers are not referenced from this module.
    assert.doesNotMatch(raw, /\bsetBootstrapComplete\b|\bsetShuttingDown\b/);
  });

  it("bootstrap and index import defaults from startup, not app", () => {
    const bootstrap = readFileSync(join(srcRoot, "bootstrap.ts"), "utf8");
    const index = readFileSync(join(srcRoot, "index.ts"), "utf8");
    // Assert bootstrap pulls requiredDefaults from the startup path.
    assert.match(bootstrap, /from ["']\.\/startup\/requiredDefaults["']/);
    assert.match(index, /from ["']\.\/startup\/requiredDefaults["']/);
    // Assert bootstrap does not import defaults via app.ts.
    assert.doesNotMatch(bootstrap, /from ["']\.\/app["']/);
    // Assert index does not import initializeRequiredDefaults from app.
    assert.doesNotMatch(index, /initializeRequiredDefaults.*from ["']\.\/app["']/);
  });

  it("index marks readiness only after successful defaults, before scheduler wire", () => {
    const index = readFileSync(join(srcRoot, "index.ts"), "utf8");
    const thenIdx = index.indexOf("initializeRequiredDefaults()");
    const markIdx = index.indexOf("setBootstrapComplete(true)");
    const wireIdx = index.indexOf("wireJobSchedulerAfterBootstrap(closing)");
    assert.ok(thenIdx >= 0 && markIdx > thenIdx && wireIdx > markIdx);
  });
});
