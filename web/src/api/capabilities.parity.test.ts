/**
 * keep web capability catalogs in lockstep with api / src / permissions.ts.
 * No shared package — parse the API source and compare token lists.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ALL_ACTIONS, ALL_PANELS } from "./capabilities";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiPermissionsPath = path.resolve(
  here,
  "../../../api/src/permissions.ts",
);

function extractConstStringArray(source: string, name: string): string[] {
  const re = new RegExp(
    `export const ${name} = \\[([\\s\\S]*?)\\] as const`,
  );
  const match = source.match(re);
  assert.ok(match, `expected export const ${name} in api permissions`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

test("TD: ALL_PANELS matches api / src / permissions.ts", () => {
  const source = fs.readFileSync(apiPermissionsPath, "utf8");
  const apiPanels = extractConstStringArray(source, "ALL_PANELS");
  assert.deepEqual([...ALL_PANELS], apiPanels);
});

test("TD: ALL_ACTIONS matches api / src / permissions.ts", () => {
  const source = fs.readFileSync(apiPermissionsPath, "utf8");
  const apiActions = extractConstStringArray(source, "ALL_ACTIONS");
  assert.deepEqual([...ALL_ACTIONS], apiActions);
});
