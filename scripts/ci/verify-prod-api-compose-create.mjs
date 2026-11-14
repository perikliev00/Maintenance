#!/usr/bin/env node
/**
 * REL-01: assert compose.prod.yml renders a single /tmp tmpfs mount string, then
 * `compose up -d --no-build --no-deps api` with production hardening. Mount parse
 * failures happen at up, not at `compose config --quiet`.
 *
 * Usage (repo root, after building the API image):
 *   API_IMAGE=maintenance-api:sha node scripts/ci/verify-prod-api-compose-create.mjs
 *   RELEASE_SHA=local API_IMAGE=maintenance-api:local node scripts/ci/verify-prod-api-compose-create.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const apiImage = process.env.API_IMAGE;
const releaseSha = process.env.RELEASE_SHA || "compose-create-check";
const imagePrefix = "local-ci-compose";
const expectedTmpfs = ["/tmp:size=32m,noexec,nosuid"];
const projectName = `rel01-${process.pid}`;

if (!apiImage) {
  console.error("Set API_IMAGE to a locally built API image tag");
  process.exit(1);
}

function run(label, command, args, opts = {}) {
  console.log(`==> ${label}`);
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    env: { ...process.env, ...(opts.env || {}) },
    stdio: opts.stdio ?? ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || "").trim();
    throw new Error(`${label} failed (exit ${result.status})${err ? `: ${err}` : ""}`);
  }
  return (result.stdout || "").trim();
}

const envPath = path.join(os.tmpdir(), `maintenance-rel01-${process.pid}.env`);
const example = fs.readFileSync(path.join(rootDir, ".env.production.example"), "utf8");
const envBody = example
  .split(/\r?\n/)
  .map((line) => {
    if (line.startsWith("RELEASE_SHA=")) return `RELEASE_SHA=${releaseSha}`;
    if (line.startsWith("IMAGE_PREFIX=")) return `IMAGE_PREFIX=${imagePrefix}`;
    return line;
  })
  .join("\n");
fs.writeFileSync(envPath, envBody, { encoding: "utf8", mode: 0o600 });

const tagged = `${imagePrefix}/maintenance-api:${releaseSha}`;
let created = false;

try {
  run("tag API image for compose", "docker", ["tag", apiImage, tagged]);

  const rendered = run("compose config json", "docker", [
    "compose",
    "--project-name",
    projectName,
    "--env-file",
    envPath,
    "-f",
    "compose.prod.yml",
    "config",
    "--format",
    "json",
  ]);
  const config = JSON.parse(rendered);
  const tmpfs = config.services?.api?.tmpfs;
  if (JSON.stringify(tmpfs) !== JSON.stringify(expectedTmpfs)) {
    throw new Error(
      `api.tmpfs must be ${JSON.stringify(expectedTmpfs)}; got ${JSON.stringify(tmpfs)}`,
    );
  }
  console.log(`api.tmpfs ok: ${tmpfs[0]}`);

  // Mount parse failures happen at up/create; --no-deps skips bootstrap dependency.
  run("compose up api (prod hardening)", "docker", [
    "compose",
    "--project-name",
    projectName,
    "--env-file",
    envPath,
    "-f",
    "compose.prod.yml",
    "up",
    "-d",
    "--no-build",
    "--no-deps",
    "api",
  ]);
  created = true;
  console.log("API container created with production Compose tmpfs");
} finally {
  if (created) {
    spawnSync(
      "docker",
      [
        "compose",
        "--project-name",
        projectName,
        "--env-file",
        envPath,
        "-f",
        "compose.prod.yml",
        "rm",
        "-sf",
        "api",
      ],
      { cwd: rootDir, encoding: "utf8" },
    );
  }
  try {
    fs.unlinkSync(envPath);
  } catch {
    // ignore cleanup errors
  }
}
