// Load isolated P1 test env before any Prisma/DB clients connect.
import "../preloadIsolatedTestEnv";
import { prisma } from "../../src/db";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
import { createApp } from "../../src/app";
// Local helper main used by cases in this file.
async function main() {
  // Refuse to mutate unless connected to the isolated test database.
  await assertTestDatabase(prisma);
  process.env.E2E_DISABLE_RATE_LIMIT = "1";
  process.env.WEB_ORIGIN = "http://127.0.0.1:5185";
  // server: in-process HTTP server handle for this suite.
  const server = createApp().listen(4018, "127.0.0.1", () => console.log("Isolated scenarios API 4018 maintenance_p1_test"));
  const stop = () => server.close(() => { void prisma.$disconnect().then(() => process.exit(0)); });
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
}
// Fire-and-await side effect required before the next assertion.
void main();
