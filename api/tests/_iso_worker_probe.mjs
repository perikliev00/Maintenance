// Import module dependency from node:path.
﻿import path from "node:path";
// Import module dependency from node:module.
import { createRequire } from "node:module";
// Import module dependency from node:url.
import { fileURLToPath } from "node:url";
// Bind require for use in the following logic.
const require = createRequire(import.meta.url);
// Bind dotenv for use in the following logic.
const dotenv = require("dotenv");
// Bind apiRoot for use in the following logic.
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Invoke dotenv.config to perform this step.
dotenv.config({ path: path.join(apiRoot, ".env"), override: true });
// Filter items down to those relevant for this view.
const db = new URL(process.env.DATABASE_URL).pathname.split("/").filter(Boolean).pop();
// Emit diagnostic output for debugging this path.
console.log("WORKER_DB=" + db);
// Conditional branch for the case described by this guard.
if (db !== "maintenance_p1_test") process.exitCode = 2;
