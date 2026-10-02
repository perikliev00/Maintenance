import "dotenv/config";
import { assertEnv } from "./env";
import { createApp } from "./app";
import { startJobScheduler } from "./services/jobs";

try {
  assertEnv();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

const port = Number(process.env.PORT ?? 4000);
const app = createApp();

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
  startJobScheduler();
  console.log("Background job scheduler started");
});
