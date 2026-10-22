type SeedEnvironment = {
  NODE_ENV?: string;
  ALLOW_DEMO_SEED?: string;
  DATABASE_URL?: string;
  DEMO_SEED_DATABASE_NAME?: string;
};

/** Fail closed before the destructive demo seed touches the database. */
export function assertDemoSeedAllowed(env: SeedEnvironment = process.env): void {
  if (env.NODE_ENV === "production") throw new Error("Demo seed is disabled in production");
  if (env.ALLOW_DEMO_SEED !== "true") throw new Error("Destructive demo seed requires ALLOW_DEMO_SEED=true");
  const databaseUrl = env.DATABASE_URL;
  const expectedName = env.DEMO_SEED_DATABASE_NAME?.trim();
  if (!databaseUrl || !expectedName) throw new Error("Demo seed requires DATABASE_URL and DEMO_SEED_DATABASE_NAME for an explicitly disposable database");
  let actualName: string;
  try { actualName = new URL(databaseUrl).pathname.split("/").filter(Boolean).pop() ?? ""; }
  catch { throw new Error("Demo seed requires a valid DATABASE_URL"); }
  if (actualName !== expectedName || /^(postgres|template0|template1|production|prod)$/i.test(actualName)) {
    throw new Error(`Refusing destructive demo seed: database '${actualName}' does not match the declared disposable database`);
  }
}
