import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const dotenv = require("dotenv");
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(apiRoot, ".env"), override: true });
// Filter items down to those relevant for this view.
const db = new URL(process.env.DATABASE_URL).pathname.split("/").filter(Boolean).pop();
// Emit diagnostic output for debugging this path.
console.log("WORKER_DB=" + db);
if (db !== "maintenance_p1_test") process.exitCode = 2;
