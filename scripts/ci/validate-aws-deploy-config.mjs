#!/usr/bin/env node
/**
 * Static checks for AWS EC2 deploy automation artifacts.
 * Does not prove live Environment protection rules or SSM connectivity.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const failures = [];

function mustExist(rel) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) failures.push(`missing file: ${rel}`);
  return p;
}

function read(rel) {
  return fs.readFileSync(mustExist(rel), "utf8");
}

for (const rel of [
  "infra/aws/terraform/versions.tf",
  "infra/aws/terraform/ec2.tf",
  "infra/aws/terraform/iam.tf",
  "infra/aws/terraform/ssm.tf",
  "infra/aws/terraform/s3_backup.tf",
  "infra/aws/terraform/oidc.tf",
  "infra/aws/cloud-init/user-data.yaml",
  "infra/aws/systemd/maintenance-stack.service",
  "infra/postgres/provision-roles.sql.example",
  "scripts/aws/promote-release.sh",
  "scripts/aws/rollback-app.sh",
  "scripts/aws/host-health.sh",
  "scripts/aws/backup-via-docker-network.sh",
  "scripts/aws/ssm-promote.sh",
  "scripts/aws/ssm-diag.sh",
  "scripts/aws/ssm-session.sh",
  "docs/operations/aws-ec2.md",
  "docs/operations/agent-access.md",
  ".github/workflows/deploy.yml",
]) {
  mustExist(rel);
}

const deploy = read(".github/workflows/deploy.yml");
for (const needle of [
  "id-token: write",
  "aws-actions/configure-aws-credentials",
  "ssm-promote.sh",
  "post-deploy-smoke.sh",
  "Publish immutable images",
  "EC2_INSTANCE_ID",
  "AWS_ROLE_ARN",
]) {
  if (!deploy.includes(needle)) failures.push(`deploy.yml missing required fragment: ${needle}`);
}

const cloudInit = read("infra/aws/cloud-init/user-data.yaml");
if (!cloudInit.startsWith("#cloud-config")) {
  failures.push("cloud-init must start with #cloud-config");
}
for (const needle of ["ufw allow 443", "docker-compose-plugin", "amazon-ssm-agent", "maintenance-stack.service"]) {
  if (!cloudInit.includes(needle)) failures.push(`cloud-init missing: ${needle}`);
}

const composeExample = path.join(root, ".env.production.example");
if (fs.existsSync(composeExample)) {
  const r = spawnSync(
    "docker",
    ["compose", "--env-file", ".env.production.example", "-f", "compose.prod.yml", "config", "--quiet"],
    { cwd: root, encoding: "utf8" },
  );
  if (r.status !== 0) {
    failures.push(`compose.prod.yml config failed: ${r.stderr || r.stdout}`);
  }
}

const tfDir = path.join(root, "infra/aws/terraform");
const tf = spawnSync("terraform", ["-version"], { encoding: "utf8" });
if (tf.status === 0) {
  const fmt = spawnSync("terraform", ["fmt", "-check", "-recursive"], {
    cwd: tfDir,
    encoding: "utf8",
  });
  if (fmt.status !== 0) {
    failures.push(`terraform fmt -check failed:\n${fmt.stdout || fmt.stderr}`);
  }
} else {
  console.log("terraform not on PATH; skipping fmt check");
}

if (failures.length) {
  console.error("validate-aws-deploy-config failed:");
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}

console.log("validate-aws-deploy-config: ok");
