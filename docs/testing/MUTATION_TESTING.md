# Mutation testing

## Architecture and scope

The repository has separate `api`, `web`, and `e2e` npm projects. API and web unit tests use Node's built-in `node:test` runner and TypeScript is loaded with `tsx`; API also has PostgreSQL-backed integration suites, and browser E2E tests use Playwright. No existing coverage collector or mutation tool was configured.

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

There is no breaking score threshold initially (`break: null`). The 60/80 low/high values are report colors only. This avoids imposing a gate before a stable baseline exists. After several scheduled runs, assess the score distribution and surviving-mutant review rate; then consider a regression threshold based on the established baseline rather than an arbitrary project-wide percentage.

## CI

`.github/workflows/mutation.yml` runs the targeted API and web suites on manual dispatch and every Monday. It installs each package, generates the Prisma client for API, runs Stryker, and uploads each targeted HTML/JSON report even when a job fails, retaining artifacts for 14 days. The full configs produce separately named reports when run locally. The existing pull-request CI remains the build, type-check, unit, integration, and E2E layer; mutation testing does not block every pull request or multiply database setup costs.

## Investigating survivors and failures

1. Open `reports/stryker.html` or inspect `reports/stryker.json`; group survivors by module and review the changed expression.
2. Confirm whether the changed expression affects an observable business result, permission decision, boundary, or state transition.
3. For a genuine gap, add a deterministic behavior-level test to the owning test file and first confirm that it passes on unmutated code.
4. Re-run the targeted module and verify the mutant changes to `Killed`.
5. Treat equivalent or non-observable changes as candidates for a narrow Stryker disable comment with a rationale. Do not weaken expected behavior or alter production logic just to kill a mutant.

`NoCoverage` means no configured test file executed the mutated expression. A timeout can be a genuinely slow path or an overly low timeout; compare with the unmutated run before adjusting. `CompileError` is a mutant that fails TypeScript checking, not a test failure. A dry-run or test-runner failure means no valid mutation score was produced. For database-backed tests, confirm the required isolated test database and generated Prisma client before expanding API mutation scope.

## Performance and maintenance

Keep regular development on `npm test`; use mutation testing before merging changes to critical logic or via incremental local runs. Targeted configurations should grow only when relevant tests exist and execution remains predictable. Expand to additional audited business modules before running full scope on a schedule. Keep generated code, dependencies, build artifacts, test files, declaration-only files, and third-party code out of mutation targets. Review surviving mutants with product behavior in mind, and refresh the incremental cache when Stryker reports changed baseline data.

