# Mutation Testing Report

## A. Initial State

The repository has separate API, web, and e2e npm projects. API and web unit tests use Node's node:test with tsx; API also has PostgreSQL integration suites, and E2E uses Playwright. There was no coverage or mutation-testing setup before this work.

The earlier report recorded an 81-test Web baseline and a 79-test targeted API baseline. Its claim that the full API test process did not exit was not reproduced by the safe final run: the full suite exited normally after 311 tests. The earlier report's intermediate mutation scores are historical; final scores and exact run scopes are below.

## B. Implementation

- Added StrykerJS with the TAP runner and TypeScript checker, targeted and full configs, separate reports/incremental caches, and npm commands in both packages.
- Added a Monday weekly and manual GitHub Actions workflow. It always uploads targeted JSON/HTML reports for 14 days. Mutation-score thresholds remain non-blocking (break: null); the 60/80 values are display bands.
- API tests now run through runWithP1Isolation.mjs, which preloads and verifies the dedicated maintenance_p1_test database. P1_TEST_DATABASE_URL may supply its endpoint. P1_TEST_WEB_ORIGIN supports the isolated Playwright scenario origin.
- The grant-seed integration test now invokes the local Prisma CLI through process.execPath instead of four sequential npx launches.
- Full configs target executable .ts and .tsx under src, excluding test files and declarations. API has no TSX. Web contains 66 TSX files: all are in the source glob; five are re-export-only files that generated no mutants. The E2E Playwright suite is not run per mutant.

## C. Mutation Analysis

### Targeted runs

| Package | Mutants | Killed | Timeout | Survived | No coverage | Compile errors | Mutation score | Covered score | Runtime |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| API | 422 | 287 | 9 | 4 | 0 | 122 | 98.67% | 98.67% | 3m 04s |
| Web | 445 | 270 | 0 | 3 | 0 | 172 | 98.90% | 98.90% | 1m 44s |

Compile errors are excluded from Stryker's score. Stryker counts timeouts as detected; the API's nine timeout mutants are still called out separately because their execution behavior is abnormal.

API targeted results by module:

| Module | Killed | Timeout | Survived | No coverage | Compile errors | Score |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| attendanceRules.ts | 122 | 9 | 2 | 0 | 71 | 98.50% |
| dataScope/where.ts | 80 | 0 | 2 | 0 | 30 | 97.56% |
| roleGrants/normalize.ts | 15 | 0 | 0 | 0 | 6 | 100% |
| cleaning/deriveServiceType.ts | 11 | 0 | 0 | 0 | 4 | 100% |
| readiness.ts | 59 | 0 | 0 | 0 | 11 | 100% |

Web targeted results by module:

| Module | Killed | Timeout | Survived | No coverage | Compile errors | Score |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| sessionPolicy.ts | 54 | 0 | 1 | 0 | 40 | 98.18% |
| conflict.ts | 125 | 0 | 1 | 0 | 90 | 99.21% |
| connState.ts | 63 | 0 | 1 | 0 | 31 | 98.44% |
| locations/permissions.ts | 28 | 0 | 0 | 0 | 11 | 100% |

### Full Web run

The full Web run completed in 16m 23s. A later incremental full-scope refresh re-ran 198 mutants in the changed conflict module and reused 11,645 results. Stryker selected 113 source files and generated 11,843 mutants:

| Killed | Timeout | Survived | No coverage | Compile errors | Mutation score | Covered score |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 508 | 1 | 316 | 8,139 | 2,879 | 5.68% | 61.70% |

The broad score is low because the full scope includes many application modules without unit-test coverage; this is a scope result, not a claim that the targeted modules regressed. Of 66 Web TSX source files, 61 generated 7,741 mutants: 6,265 had no coverage and 1,476 were compile errors. The other five are thin re-export barrels and generated no mutants. Thus TSX is included in the configured full scope, but most TSX behavior is not covered by the current mutation test files.

The one full-Web timeout is src/offline/queueDrain.ts line 267, where mutating offset += 100 to offset -= 100 makes the bounded batch loop fail to advance. That timeout represents the expected non-terminating mutated loop, not a slow baseline test.

### Full API run

The full API config selected 203 source files and generated 12,324 mutants. Its initial isolated dry run passed 47 test files in 54 seconds. With the required single worker for shared PostgreSQL fixtures, Stryker processed 8 mutants in about 3 minutes and estimated 21–40 hours remaining. The run was stopped with Ctrl+C as prohibitively expensive; no full API score/report was produced. The 8/12,324 partial progress is not a full mutation result.

### Survivor and timeout review

The four API survivors are behaviorally equivalent for current inputs:

- Removing the scope.kind === all return still produces the same null: locationWhere(all) is {}, and the following empty-where guard returns null. Other current scope kinds yield a non-empty predicate, including the sentinel predicate for empty assigned scopes.
- The missing_end filter before closing a shift is redundant: open.flags can contain skew and duplicate-kind flags, but missing_end is added during finalization after this filter.

The three Web survivors are also equivalent for the current contract:

- Removing the network special case from classifyRefreshFailure still falls through to transient; only 401/403 return rejected.
- Removing value !== null from isRecord makes null pass the record check, but the only caller forwards it as conflict details, which remains null either way.
- Replacing the initial clearBackoffTimer callback with a no-op has no effect: scheduling a timer replaces that callback with the timer runtime's clear function before a timer can need clearing.

All nine API targeted timeout mutants are in attendanceRules.ts around the clock-out branch (mutant IDs 154, 155, 164, 167, 169, 170, 186, 188, 189). Baseline attendance tests pass in roughly 0.26 seconds. They persisted when the targeted run was repeated with one worker, so concurrency alone is not the cause. A direct test of the reversed clock-out comparison on the single affected test failed and exited in about 0.3 seconds; running the entire test file with that mutation then remained CPU-bound for over two minutes. This indicates a mutation-induced full-file/test-runner blocking path, not a slow unmutated suite. The exact test interaction causing the full-file block remains unresolved. The configured timeout was not increased, and tests were not removed.

## D. Test Improvements and Defects

- Web offline tests now use controlled clocks, injected queue-drain/read-stat dependencies, and fake event targets. They cover online/offline and visibility changes, event state publication, retry delays and coalescing, reset and timer cleanup, the lazy drain adapter, subscription cleanup, and SSR behavior without network or IndexedDB.
- Conflict tests cover absent/blank/invalid message, code, and details; forbidden code/message classification; retry-limit transitions; URL fallback variants; and refusing rebase outside scope.
- API tests cover added date, attendance boundary, and data-scope behavior. The grant-seed child no longer pays repeated npx startup cost.
- Confirmed Web defect fixed in conflict.ts: untrusted fractional, infinite, NaN, unsafe, zero, or negative currentVersion values could be accepted for rebase even though the API requires a positive integer. Parsing now rejects them.
- Confirmed Web URL fallback defect fixed: query/hash data could leak into IDs or prevent path fallback. Fallback now parses URL.pathname and rejects malformed URLs.
- No business-rule change was made to attendance logic to improve mutation scores.

## E. Remaining Weaknesses

- The nine targeted API attendance timeout mutants remain unresolved as a test-runner/full-file interaction; they are not treated as evidence of a passing non-blocking run.
- Full API mutation testing has no score because the measured runtime was prohibitively long with the required isolated-database serialization.
- Full Web mutation results expose broad coverage gaps: 8,139 no-coverage mutants, including 6,265 in TSX. Add focused behavior tests in future work before setting score gates.
- Lint was not run because neither package has a configured lint script.

## F. Final Validation

| Check | Result |
| --- | --- |
| API full module tests, isolated | 311/311 passed; process exited 0 in 44.2s |
| API focused PostgreSQL integration (test:db), isolated | 4/4 passed |
| API broader integration/scenario files, isolated | 283/283 passed across 46 suites, 103.6s |
| Web full unit suite | 112/112 passed after final fixes |
| Playwright main E2E suite | 12/12 passed |
| Playwright scenario suite, rerun after final Web fix | 52/52 passed in 1.7m |
| API typecheck and production build | Passed |
| Web typecheck and production build | Passed; Vite emitted existing dynamic/static import chunking notices |
| E2E scenario TypeScript check | Passed |
| API/Web targeted mutation runs | Completed; results above |
| Full Web mutation run | Completed; results above |
| Full API mutation run | Incomplete; 8/12,324 processed before stopping at measured 21–40h ETA |
| Git diff whitespace check | Passed; Git emitted only line-ending conversion warnings |

All authoritative database-backed reruns used maintenance_p1_test, and prove:p1-isolation passed. For transparency, an early diagnostic before the isolation wrapper was in place used the repository's api/.env URL, which pointed to the local maintenance database rather than maintenance_p1_test; it exited successfully but is excluded from all acceptance counts. No external production database endpoint was used. Do not treat that early run as isolated validation.

The earlier claim of an API process hang was not reproducible on the final isolated full run: it exited normally, with no forced termination. The grant-seed test was the slowest module test and took 18.5 seconds on the isolated run; direct invocation of the local Prisma CLI reduced the repeated npx overhead. The runner now returns the child exit status and keeps the database guard preloaded. No live leaked handle was established after process exit.

## G. Recommendations

1. Investigate the API TAP/full-file timeout behavior separately, starting with the nine attendance mutants and a minimal reproduction. Keep the 20-second timeout unchanged until baseline evidence supports a change.
2. Add Web component/page tests, especially for TSX modules with no coverage. Use mutation results to select meaningful behaviors; do not add a score gate from this first full baseline.
3. Keep the weekly/manual targeted workflow as the routine CI job. Run full mutation scopes on a machine with enough time and isolated DB capacity, preserving the separate full reports.
4. Reassess a non-blocking-to-blocking regression threshold only after several stable targeted runs and survivor reviews.
