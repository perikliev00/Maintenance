# Coverage baseline (TEST-09)

Reproducible line/function/branch coverage for the `api` and `web` packages using
[c8](https://github.com/bcoe/c8) (V8 native coverage), which works with `tsx` and `node:test`
without changing how tests run. Reporting only: **no coverage gate is enforced yet**.

## Commands

Run from the package directory.

| Command | What runs | Needs DB |
| --- | --- | --- |
| `cd api && npm run coverage` | Same files as `npm test` (`src/**/*.test.ts`) via the P1 isolation wrapper | yes (`maintenance_p1_test`) |
| `cd api && npm run coverage:all` | Same files as `npm run test:all` (`src/**` + `tests/**`: lifecycle, scenario, HTTP suites) | yes (`maintenance_p1_test`) |
| `cd web && npm run coverage` | Same files as `npm test` (`src/**/*.test.ts`) | no |

API commands need the isolated database described in [`P1_ISOLATION_DB.md`](./P1_ISOLATION_DB.md)
(`P1_TEST_DATABASE_URL` works). `coverage:all` takes about 6-7 minutes and currently ends with exit
code 1 because of 3 unrelated failing tests (see "Baseline" below); coverage is still written.

Reports are written to `api/coverage/` and `web/coverage/` (git-ignored):
`index.html` (browsable), `lcov.info`, `coverage-summary.json`; a text summary is printed.
Settings live in `api/.c8rc.json` and `web/.c8rc.json`.

## What is in the denominator

- `all: true` + `include`: **every production `.ts` file under `src/`** (API) and **every `.ts`/`.tsx`
  file under `src/`** (web) is counted, including files no test imports (reported as 0 %).
  Verified: API reports 269 files and web 192 files, matching the production file count on disk.
- Excluded: `*.test.ts(x)`, `*.d.ts`, `fixtures/`, `__fixtures__/`, `__mocks__/`, `generated/`,
  `node_modules/`. Test helpers under `api/tests/` are outside `src/` and never counted.
  There is currently no generated source under `src/` (the Prisma client lives in `node_modules`).

## Baseline (2026-11-03, Node 24.22.1, c8 12.0.0, branch `chore/tech-debt-test-coverage`)

| Run | Lines / statements | Branches | Functions | Tests |
| --- | --- | --- | --- | --- |
| API `coverage` (`npm test` set) | 58.07 % (18112 / 31188) | 78.06 % | 70.24 % | 476, 3 failing* |
| API `coverage:all` (`test:all` set) | **89.84 %** (28022 / 31188) | 82.58 % | 91.23 % | 895, 3 failing* |
| Web `coverage` (Node unit tests) | **24.70 %** (8020 / 32458) | 74.76 % | 51.41 % | 349 passing |

\* The failing tests are `src/services/roleGrants/permissions.http.test.ts` (3 cases expect
`Owner grants cannot be edited` but receive `Unknown or non-matrix role`). They come from the
uncommitted, in-progress change to `api/src/controllers/permissions.ts` in the working tree and are
unrelated to coverage tooling; the totals above include their (partial) execution.

API `coverage:all` by top-level directory (lines):

| Dir | Files | Files at 0 % | Lines |
| --- | --- | --- | --- |
| `(root)` | 11 | 2 | 85.4 % |
| `auth` | 2 | 0 | 87.3 % |
| `contracts` | 1 | 0 | 99.4 % |
| `controllers` | 29 | 0 | 76.9 % |
| `events` | 2 | 0 | 93.6 % |
| `middleware` | 4 | 0 | 97.6 % |
| `routes` | 28 | 0 | 98.5 % |
| `scripts` | 1 | 0 | 80.0 % |
| `services` | 191 | 7 | 91.4 % |

Web (Node unit tests only) by top-level directory (lines):

| Dir | Files | Files at 0 % | Lines |
| --- | --- | --- | --- |
| `(root)` | 5 | 3 | 48.9 % |
| `api` | 23 | 0 | 70.4 % |
| `app` | 6 | 5 | 2.8 % |
| `audit` | 2 | 0 | 81.9 % |
| `components` | 17 | 13 | 5.9 % |
| `hooks` | 8 | 7 | 2.0 % |
| `lib` | 1 | 0 | 91.9 % |
| `offline` | 14 | 2 | 69.4 % |
| `pages` | 116 | 93 | 13.2 % |

## How to read these numbers

- **Web coverage is Node unit-test coverage only.** The Node tests exercise pure logic, state
  machines, label/permission helpers and offline queue code. React components, hooks that need a
  DOM, CSS, routing and real browser behaviour are exercised by Playwright (`e2e/`), which is **not**
  measured here. The 24.7 % figure therefore says nothing about browser UI coverage; low numbers in
  `components/`, `pages/`, `hooks/` and `app/` mean "no Node unit test imports these", not "untested".
- Files that no test imports are added to the denominator as lines only. They carry no branch or
  function data, so the **branch and function percentages cover loaded files only** and are
  optimistic; the line/statement percentage is the honest whole-codebase number.
- API figures count code reached by DB-backed integration and HTTP tests (`coverage:all`). A route or
  service hit only through a failing assertion still counts as executed.
- V8 coverage is line/range based; "statements" equals "lines" here.
- Coverage shows which code ran, not whether assertions are meaningful. Use mutation testing
  ([`MUTATION_TESTING.md`](./MUTATION_TESTING.md)) for assertion quality.

## Gating (not enabled)

No `check-coverage` threshold is set. A reasonable first step, once the 3 failing tests are fixed, is
to enforce a non-regression floor slightly below the API `coverage:all` baseline (for example lines
85 %) in CI, and to track web separately from Playwright. Do not set one for web Node coverage as a
proxy for UI quality.

## CI

Not wired into `.github/workflows/ci.yml` yet: API suites there are split across many `run_suite`
invocations and a single merged report would need `c8 report` over a shared `NODE_V8_COVERAGE`
directory. The local commands above are the reproducible baseline.
