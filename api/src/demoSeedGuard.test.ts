import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertDemoSeedAllowed } from "./demoSeedGuard";

const safe = { NODE_ENV: "development", ALLOW_DEMO_SEED: "true", DATABASE_URL: "postgresql://localhost/maintenance_test", DEMO_SEED_DATABASE_NAME: "maintenance_test" };
describe("demo seed safety guard", () => {
  it("allows an explicitly named disposable database", () => assert.doesNotThrow(() => assertDemoSeedAllowed(safe)));
  it("refuses every production environment", () => assert.throws(() => assertDemoSeedAllowed({ ...safe, NODE_ENV: "production" }), /disabled in production/));
  it("requires a destructive-operation opt in", () => assert.throws(() => assertDemoSeedAllowed({ ...safe, ALLOW_DEMO_SEED: "false" }), /requires ALLOW_DEMO_SEED/));
  it("rejects a mismatch with the database in the URL", () => assert.throws(() => assertDemoSeedAllowed({ ...safe, DEMO_SEED_DATABASE_NAME: "other_test" }), /does not match/));
  it("refuses a production database name", () => assert.throws(() => assertDemoSeedAllowed({ ...safe, DATABASE_URL: "postgresql://localhost/prod", DEMO_SEED_DATABASE_NAME: "prod" }), /does not match/));
});
