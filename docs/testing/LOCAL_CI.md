# Local CI gate and Git hooks

This repository mirrors the mandatory GitHub Actions checks from
[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) through a single
root command: **`npm run ci:local`**.

## Quick start

```bash
# One-time: Compose Postgres + install deps (if needed)
docker compose up -d
cd api && npm ci && npx prisma generate && cd ..
cd web && npm ci && cd ..
cd e2e && npm ci && npx playwright install chromium && cd ..

# Install the shared pre-push hook (sets core.hooksPath for this repo only)
npm run hooks:install

# Run the full local gate (same command the hook runs)
npm run ci:local
```

On Windows/macOS/Linux, `ci:local` uses `scripts/ci/prepare-p1-test-db.mjs`
(Docker Compose `psql` via `docker exec`) so a host `psql` client is not required.
Postgres defaults to Compose `127.0.0.1:5433`. GitHub Actions continues to use
`scripts/ci/prepare-p1-test-db.sh` against the workflow service container.

## What `ci:local` runs

| Phase | Equivalent GitHub job | Commands / suites |
|---|---|---|
| Postgres + DB prep | Smoke / E2E services | Compose `db`, migrate/seed `maintenance`, prepare `maintenance_p1_test` |
| API | `API` | `npm ci`, `prisma generate`, `lint`, `build`, `typecheck:tests` |
| Web | `Web` | `npm ci`, `lint`, `build`, `typecheck:tests`, `test` |
| Smoke | `Smoke` | SQL invariants, `prove:p1-isolation`, inventory, all API suite scripts, atomic smoke scripts |
| Smoke audit upgrade | `Smoke audit upgrade` | `smoke-legacy-audit-upgrade.ts` |
| E2E | `E2E` | Playwright main suite + scenario typecheck/tests (P1 DB) |
| Containers (partial) | `Container verification` | Always: `compose.prod.yml config`. Full image build/verify only if `CI_LOCAL_CONTAINERS=1` |

Flags:

- `--skip-e2e` — skip Playwright (still fails closed on other jobs)
- `--skip-containers` — skip Compose/image checks
- `--skip-install` — skip `npm ci` in packages (use existing `node_modules`)

Any failed suite, crash, missing dependency, or timeout exits **non-zero**.
Suites are collected the same way as GitHub Smoke: one failure does not hide later suite results; the final exit is still non-zero.

## Concurrent runs and PostgreSQL isolation

Mutating suites share `maintenance_p1_test` (and smoke scripts use the working
`maintenance` DB). Two concurrent local gates would corrupt each other’s state.

`ci:local` therefore takes an **exclusive lock**:

1. Creates `%TMP%/maintenance-ci-local.lock` (or `$TMPDIR/…`) with `O_EXCL`
2. Listens on `127.0.0.1:47321` (`CI_LOCAL_LOCK_PORT` to override)

If either lock is held, the new run exits immediately with a non-zero code.
Within a run, API tests keep `--test-concurrency=1` and Playwright uses
`workers: 1`, matching CI.

Do **not** point mutating suites at the working seed DB. See
[P1_ISOLATION_DB.md](./P1_ISOLATION_DB.md).

## Pre-push hook

```bash
npm run hooks:install
```

This runs `git config core.hooksPath scripts/ci/hooks` **in this repository
only** (never global). The tracked hook `scripts/ci/hooks/pre-push` executes
`npm run ci:local` and blocks the push on failure.

There is no bypass flag in the hook. Do not use `--no-verify` to skip a red
gate; fix the failure instead.

## Local vs GitHub differences

| Check | Local `ci:local` | GitHub Actions |
|---|---|---|
| API / Web / Smoke / E2E commands | Yes (same npm scripts) | Yes |
| Postgres endpoint | Compose `127.0.0.1:5433` | Service container `:5432` |
| Smoke audit upgrade DB | Recreates empty `maintenance_audit_upgrade_smoke` | Fresh empty `maintenance` on the job service |
| Node | Developer machine (CI images use 22) | `node-version: "22"` |
| Gitleaks secret scan | **Not run** | `secret-scan` job |
| OSV / dependency-review | **Not run** | PR + push-to-main jobs |
| Trivy image scan | **Not run** | `containers` job |
| Full Docker image build + `verify-containers.mjs` | Opt-in `CI_LOCAL_CONTAINERS=1` | Always on `containers` job |

Nightly / dispatch workflows (`mutation.yml`, `nightly-perf.yml`, deploy/release)
are **out of scope** for the push gate.

## GitHub branch protection / rulesets

Prepared ruleset payload:
[`.github/rulesets/main-require-ci.json`](../../.github/rulesets/main-require-ci.json)

Apply only with a token that can administer the repository, then **verify** in
the GitHub UI or API. Until that is done, do **not** claim protection is active.

```bash
# Example (owner/admin token required) — review the JSON before applying
gh api repos/perikliev00/Maintenance/rulesets \
  --method POST \
  --input .github/rulesets/main-require-ci.json

# Verify
gh api repos/perikliev00/Maintenance/rulesets
```

Required status check **context** names must match the job `name:` values from
`ci.yml` after they have appeared on a workflow run (for example `API`, `Web`,
`Smoke`, `Smoke audit upgrade`, `E2E`, `Container verification`, `Secret scan`,
`Dependency review (PR)`). The prepared ruleset requires the OSV PR gate
(`Dependency review (PR)`); re-apply the JSON after updating it.

Manual UI path: **Settings → Rules → Rulesets** → target `main` → require the
status checks above → require PR / block force pushes per team policy.
