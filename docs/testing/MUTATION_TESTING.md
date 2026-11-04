# Mutation testing

## Architecture and scope

The repository has separate `api`, `web`, and `e2e` npm projects. API and web unit tests use Node's built-in `node:test` runner and TypeScript is loaded with `tsx`; API also has PostgreSQL-backed integration suites, and browser E2E tests use Playwright. Line/branch coverage is reported separately with c8 (see [`COVERAGE.md`](./COVERAGE.md)); mutation testing measures assertion strength, coverage measures execution.

StrykerJS is used in both API and web projects because it supports TypeScript mutation operators and its TAP runner can execute the existing `node:test` files without introducing another test framework. The TAP runner reports coverage per test file, allowing Stryker to distinguish uncovered mutations and run only relevant test files. TypeScript checking marks mutants that cannot compile as `CompileError`; those mutants are excluded from the behavioral mutation score. Configurations use bounded concurrency, a 20-second mutant timeout with a 2x timeout factor, and incremental result files. The targeted configs select only critical production logic and their direct unit tests.

The targeted API scope is attendance calculations and validation, readiness rules, data-scope query filters, role-grant normalization, and cleaning service-type derivation. The targeted web scope is session failure policy, offline connection state, queued-command conflict handling, and location-page permissions. These domains cover validation, authorization-adjacent decisions, workflows, and offline state. Full configs select executable `.ts` and `.tsx` source under `src`, excluding test files and declaration files. The web package currently has 66 `.tsx` source files, all included in its full mutation scope; five thin re-export files do not generate mutants, and API has no `.tsx` files. Full API mutation tests preload the database-isolation guard and require an available, migrated, isolated `maintenance_p1_test` database. `P1_TEST_DATABASE_URL` can supply its endpoint; the runner still verifies the database name before tests connect. E2E browser flows are not mutated: they test the running system, require database/browser infrastructure, and do not offer a practical per-mutant feedback loop. The scenario runner also accepts `P1_TEST_WEB_ORIGIN` to align CORS with its dedicated local browser origin.

## Commands

Run from the relevant package directory (`api` or `web`):

| Command | Effect |
| --- | --- |
| `npm test` | Run the package's module test suite. API uses the isolation wrapper and serial worker mode. |
| `npm run test:mutation` | Mutate the prioritized critical modules. Writes HTML/JSON reports and an incremental cache. |
| `npm run test:mutation:incremental` | Re-run the targeted scope using Stryker's incremental cache; use after code or tests change. |
| `npm run test:mutation:full` | Mutate all eligible `src/**/*.ts` and `src/**/*.tsx` production modules in that package. This can be substantially slower. |

Targeted HTML/JSON reports are `reports/stryker.html` and `reports/stryker.json`; full reports are `reports/stryker-full.html` and `reports/stryker-full.json`. Incremental caches are also under `reports/` and are local optimization state. Inspect one module at a time with Stryker's `--mutate` option when investigating a specific file, for example `npx stryker run stryker.config.mjs --mutate 'src/services/readiness.ts'` in `api`.

## Scoring and interpretation

Stryker defines detected mutants as `killed + timeout`, and undetected mutants as `survived + no coverage`. Its mutation score is `(killed + timeout) / (killed + timeout + survived + no coverage) * 100`; the covered score is `(killed + timeout) / (killed + timeout + survived) * 100`. Runtime errors and TypeScript `CompileError` mutants are excluded from both scores because those mutants could not be validly evaluated. The report is the source of actual counts and scores. Scores measure whether assertions detect behavioral changes in the selected code; they are not a substitute for domain review. See Stryker's [mutant states and metrics](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/) for the official definitions.

### Blocking threshold (`thresholds.break`) — TEST-10

The **targeted** configs now fail the run (Stryker exit code 1) when the total mutation score drops below `thresholds.break`:

| Config | Measured baseline (2026-11-03, forced full re-run) | `break` | `low` / `high` (colors) |
| --- | --- | --- | --- |
| `api/stryker.config.mjs` | 98.66 % (295 killed, 4 survived, 0 no coverage; 122 compile errors excluded) | **95** | 96 / 98 |
| `web/stryker.config.mjs` | 91.88 % (283 killed, 21 survived, 4 no coverage; 178 compile errors excluded) | **88** | 90 / 95 |

Justification: `break` is the measured baseline minus about four points. That is roughly 12 additional undetected mutants (about one new untested branch cluster) of headroom, so ordinary refactors and equivalent mutants do not flap the gate, while deleting or bypassing a module's tests, or adding a meaningful amount of untested logic to a targeted file, fails it (removing `readiness.test.ts` alone drops the API score to about 78 %). It is deliberately not a project-wide round number: the two packages have different baselines because web's targeted modules have more surviving mutants (listed in "Known survivors" below). Raise `break` only after survivors are killed or reviewed as equivalent; never lower it to make a failing run pass without recording why here.

The full configs (`stryker.full.config.mjs`) keep `break: null` on purpose: they are exploratory, their scope includes React/UI files without Node unit tests, and no full-scope baseline exists. A full-scope score must never be compared with the targeted gate.

> **Do not trust a stale incremental cache for a baseline.** The `reports/stryker.json` present before 2026-11-03 (98.9 % for web) was produced from an older code revision; a forced re-run (`npx stryker run stryker.config.mjs --force`) of the current code gives 91.88 %. When setting or revising a gate, run with `--force` once.

### Reporting a mutation result: SHA and files (required)

A mutation score is only meaningful for **a specific commit and a specific set of mutated files**, because the targeted configs cover five API and four web modules, not the whole codebase. Any score quoted in a PR, audit note or release record must state:

1. the **git SHA** (`git rev-parse HEAD`; note uncommitted changes if any) the run was made on;
2. the **config used** (`stryker.config.mjs` targeted vs `stryker.full.config.mjs`) and the **files mutated** (the `mutate` list, or the `--mutate` override if one was passed);
3. the Stryker counts (killed / timeout / survived / no coverage / errors) and the Node version.

The scheduled workflow records items 1-3 for every run in the job summary (`GITHUB_STEP_SUMMARY`). When running locally, copy them from `git rev-parse HEAD`, the config `mutate` array and the clear-text table. Never describe the targeted score as "the project's mutation score".

### Known survivors at baseline (2026-11-03)

API (4): `attendanceRules.ts:268` (two mutants on the `missing_end` flag filter), `dataScope/where.ts:161` and `:165` (conditional short-circuits in the sector id resolver).
Web (21 survived + 4 no coverage): `sessionPolicy.ts:32`; `offline/conflict.ts` lines 21-22, 168-169, 234 (retry counter/`validation` retry handling); `offline/connState.ts` lines 27, 29, 96, 102, 127-128, 140, 164 (command-retry cancellation and notification paths); `pages/locations/permissions.ts` lines 49, 52, 54 (`&&` → role-only checks). These are candidates for new behaviour-level tests; they were not changed as part of TEST-10.

### Runtime notes

- **Node 23+ and the TAP runner.** Since Node 23 the default test reporter is `spec` even when stdout is piped, but `@stryker-mutator/tap-runner` only parses TAP. All configs therefore pass `--test-reporter=tap`; without it every re-run mutant is reported as a runtime error (the symptom is "Tap process exited with code 1" with empty stderr, and a score computed from cached results only). Node 22 (CI) accepts the flag too.
- **Web sandbox and the shared permissions catalog.** `web/src/api/capabilities.ts` imports `../../../api/src/contracts/permissionsCatalog`, outside the web package. Stryker runs tests in `web/.stryker-tmp/sandbox-*`, where that relative path resolves to `web/.stryker-tmp/api/...`. `web/stryker.config.mjs` copies `api/src/contracts` there when the config loads; without it the dry run fails with `ERR_MODULE_NOT_FOUND` (this broke the web mutation job after the catalog became shared).
- **Source-text tests in the full web scope.** `src/pages/liveBoardController.test.ts` and `src/hooks/useLiveRefresh.events.test.ts` assert on production source text; instrumentation rewrites that text, so `web/stryker.full.config.mjs` lists test files explicitly and omits those two (the tap runner has no negative globs).

## Investigating survivors and failures

1. Open `reports/stryker.html` or inspect `reports/stryker.json`; group survivors by module and review the changed expression.
2. Confirm whether the changed expression affects an observable business result, permission decision, boundary, or state transition.
3. For a genuine gap, add a deterministic behavior-level test to the owning test file and first confirm that it passes on unmutated code.
4. Re-run the targeted module and verify the mutant changes to `Killed`.
5. Treat equivalent or non-observable changes as candidates for a narrow Stryker disable comment with a rationale. Do not weaken expected behavior or alter production logic just to kill a mutant.

`NoCoverage` means no configured test file executed the mutated expression. A timeout can be a genuinely slow path or an overly low timeout; compare with the unmutated run before adjusting. `CompileError` is a mutant that fails TypeScript checking, not a test failure. A dry-run or test-runner failure means no valid mutation score was produced. For database-backed tests, confirm the required isolated test database and generated Prisma client before expanding API mutation scope.

## CI

`.github/workflows/mutation.yml` runs the targeted API and web suites on manual dispatch and every Monday. It installs each package, generates the Prisma client for API, runs Stryker (now failing the job below the `break` score), records the SHA and mutated files in the job summary, and uploads each targeted HTML/JSON report even when a job fails, retaining artifacts for 14 days. The full configs produce separately named reports when run locally. The existing pull-request CI remains the build, type-check, unit, integration, and E2E layer; mutation testing does not block every pull request or multiply database setup costs, so the gate blocks the scheduled/dispatched mutation run (and anyone running `npm run test:mutation`), not merges.

## Full configuration test selection

`api/stryker.full.config.mjs` now runs `src/**/*.test.ts` **and** `tests/**/*.test.ts` (the same set as `npm run test:all`). Previously only `src/**` tests ran, so code reached only by the lifecycle/scenario/HTTP suites showed as `NoCoverage`. It needs the isolated database and is serial (`concurrency: 1`). `web/stryker.full.config.mjs` runs all web `src/**` tests except the two source-text tests described above (web has no tests outside `src`; Playwright is not mutated). Neither full run is part of CI.

Verification (2026-11-03, `--dryRunOnly`, no mutants executed): the web full config instruments 192 files / 17,997 mutants and its dry run passes. The API full config instruments 269 files / 15,911 mutants; its dry run (about 5 minutes, all `src` + `tests` files in the sandbox against the isolated DB) ran every test and reported only the three `permissions.http.test.ts` failures that also fail under plain `npm run test:all` (uncommitted work in `api/src/controllers/permissions.ts` changed an error message). Fix or revert that work before running the full API mutation suite. The full mutation run itself was not executed (15.9k mutants, serial).

## Performance and maintenance

Keep regular development on `npm test`; use mutation testing before merging changes to critical logic or via incremental local runs. Targeted configurations should grow only when relevant tests exist and execution remains predictable. Expand to additional audited business modules before running full scope on a schedule. Keep generated code, dependencies, build artifacts, test files, declaration-only files, and third-party code out of mutation targets. Review surviving mutants with product behavior in mind, and refresh the incremental cache when Stryker reports changed baseline data.

