import "../preloadIsolatedTestEnv";
import { prisma } from "../../src/db";
import { assertTestDatabase } from "../assertTestDatabase";
import { createApp } from "../../src/app";
async function main() {
  await assertTestDatabase(prisma);
  process.env.E2E_DISABLE_RATE_LIMIT = "1";
  process.env.WEB_ORIGIN = "http://127.0.0.1:5185";
  const server = createApp().listen(4018, "127.0.0.1", () => console.log("Isolated scenarios API 4018 maintenance_p1_test"));
  const stop = () => server.close(() => { void prisma.$disconnect().then(() => process.exit(0)); });
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
}
void main();
