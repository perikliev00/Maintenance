// Strict assertions for seed-guard allow/deny cases.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
// Guard under test: refuses destructive demo seed unless env proves a disposable DB.
import { assertDemoSeedAllowed } from "./demoSeedGuard";

// Baseline env that should pass every positive check.
const safe = { NODE_ENV: "development", ALLOW_DEMO_SEED: "true", DATABASE_URL: "postgresql://localhost/maintenance_test", DEMO_SEED_DATABASE_NAME: "maintenance_test" };
// Group covering production, opt-in, name mismatch, and reserved DB names.
describe("demo seed safety guard", () => {
  // Happy path: disposable DB name matches URL and opt-in is set.
  it("allows an explicitly named disposable database", () => assert.doesNotThrow(() => assertDemoSeedAllowed(safe)));
  // Production must never run the destructive seed.
  it("refuses every production environment", () => assert.throws(() => assertDemoSeedAllowed({ ...safe, NODE_ENV: "production" }), /disabled in production/));
  // ALLOW_DEMO_SEED must be the string "true", not a falsey stand-in.
  it("requires a destructive-operation opt in", () => assert.throws(() => assertDemoSeedAllowed({ ...safe, ALLOW_DEMO_SEED: "false" }), /requires ALLOW_DEMO_SEED/));
  // Declared name must equal the database segment in DATABASE_URL.
  it("rejects a mismatch with the database in the URL", () => assert.throws(() => assertDemoSeedAllowed({ ...safe, DEMO_SEED_DATABASE_NAME: "other_test" }), /does not match/));
  // Even a matching name is refused when it looks like a production/system DB.
  it("refuses a production database name", () => assert.throws(() => assertDemoSeedAllowed({ ...safe, DATABASE_URL: "postgresql://localhost/prod", DEMO_SEED_DATABASE_NAME: "prod" }), /does not match/));
});
