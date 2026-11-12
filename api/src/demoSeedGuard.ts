// Env shape accepted by the guard (process.env or a test stub).
type SeedEnvironment = {
  NODE_ENV?: string;
  ALLOW_DEMO_SEED?: string;
  DATABASE_URL?: string;
  DEMO_SEED_DATABASE_NAME?: string;
};

/** Fail closed before the destructive demo seed touches the database. */
export function assertDemoSeedAllowed(env: SeedEnvironment = process.env): void {
  // Never allow destructive seed against a production deployment.
  if (env.NODE_ENV === "production") throw new Error("Demo seed is disabled in production");
  // Require an explicit opt-in even in development/test.
  if (env.ALLOW_DEMO_SEED !== "true") throw new Error("Destructive demo seed requires ALLOW_DEMO_SEED=true");
  // URL and expected DB name must both be present for the name check.
  const databaseUrl = env.DATABASE_URL;
  // Trim so accidental whitespace cannot widen the allowlist.
  const expectedName = env.DEMO_SEED_DATABASE_NAME?.trim();
  // Missing either value means we cannot prove the target is disposable.
  if (!databaseUrl || !expectedName) throw new Error("Demo seed requires DATABASE_URL and DEMO_SEED_DATABASE_NAME for an explicitly disposable database");
  // Parsed database name from the URL path (last non-empty segment).
  let actualName: string;
  // Extract the DB name; invalid URLs fail closed.
  try { actualName = new URL(databaseUrl).pathname.split("/").filter(Boolean).pop() ?? ""; }
  catch { throw new Error("Demo seed requires a valid DATABASE_URL"); }
  // Name must match the declared disposable DB and must not look like a system/prod DB.
  if (actualName !== expectedName || /^(postgres|template0|template1|production|prod)$/i.test(actualName)) {
    throw new Error(`Refusing destructive demo seed: database '${actualName}' does not match the declared disposable database`);
  }
}
