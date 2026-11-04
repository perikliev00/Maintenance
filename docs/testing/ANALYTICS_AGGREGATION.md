# Analytics aggregation measurement (CODE-05)

Scope: `api/src/services/analytics/housekeepingSummary.ts`, `maintenanceSummary.ts`,
`api/scripts/measure-housekeeping-summary.ts`, `api/tests/scenarios/analytics.db.test.ts`.
Run date: 2026-11-03, PostgreSQL 16 (Docker, loopback), Node 24.22.1, Prisma 6.19.3, Windows host.

## Verdict

| Entry point | Result |
| --- | --- |
| `getMaintenanceSummary` | **Investigated, no change.** 13 statements; 61-555 ms warm for 700-3,700 tickets in the window (200-1,000 rooms, 7-90 days); 9-94 MB heap growth. All budgets met at every measured volume. |
| `getHousekeepingSummary` | **One targeted fix.** Budgets were clearly exceeded (4.4 s warm at 1,000 rooms/30 d) and it **failed outright (HTTP 500)** once a window held more than 32,767 completed tasks (500 rooms/90 d: 38,328 tasks). Fixed without SQL rewrites; results are byte-identical (parity-checked). |

The aggregation stays in application code (Prisma + JS). No SQL aggregation, no timezone/period,
percentile, scope or KPI logic was changed; only *how rows are fetched*.

## Method

`npm run measure:analytics -- --seed=<rooms> --days=<N> --runs=5 [--explain] [--out=file.json]`
(`node --expose-gc --import tsx scripts/measure-housekeeping-summary.ts`):

- `--seed` loads `tests/preloadIsolatedTestEnv` (database name is rewritten **and** asserted to be
  `maintenance_p1_test`), bulk-inserts a deterministic synthetic hotel (0.85 completed tasks per
  room per day for `2 x days` so the prior comparison window is populated, ~1.2 sessions/task with
  2 % anomalous, ~63 % approved inspections (the rest auto-accepted), ~8 % rejected-then-approved rework, 25 housekeepers, 5 tickets per 100 rooms
  per day with 70 % resolved and ~10 % room-blocking), measures, and deletes everything it created
  (`--keep` / `--cleanup=<prefix>` for manual control). Without `--seed` it is read-only against
  `DATABASE_URL` as before.
- Four cases per run: housekeeping and maintenance **unscoped** (owner/manager) and
  **assignee/reporter-scoped** (housekeeper-style `taskWhere` / `ticketWhere`).
- Per case: cold + warm wall time (median of runs 2-5), Prisma statement count and summed DB time
  (Prisma `query` events), JSON payload size, peak heap and RSS growth (`gc()` before each run,
  5 ms sampling), plus `rowsInWindow` (counts of rows the window contains) and optional
  `EXPLAIN (ANALYZE, BUFFERS)` of the hot task/session/ticket filters. Hard failures are recorded
  as evidence instead of aborting the run.
- The default analytics window is `riskWindowDays` (30) and the UI presets are today / 7 d / 30 d,
  so 30 days is the reference window; 90 days is a stress case for custom ranges.

## Budgets

Proposed before the final measurements and encoded in the script (`BUDGET`; `--enforce` exits 2 when
exceeded). They apply to the reference property of 500 rooms and the default 30-day window, and a
hard requirement of "never errors" at any window size:

| Budget | Limit |
| --- | --- |
| Warm median latency, unscoped summary | <= 2,000 ms |
| Prisma statements per summary | <= 30 |
| Peak heap growth per call | <= 256 MB |
| Failure | none at any measured window (previously: > 32,767 tasks) |

## Results

Rows are rows in the measured window (the isolated DB also holds ~80 unrelated pre-existing tasks).
"Before" is the unmodified code; "after" is with the change described below. Latency is wall time in
ms: cold = first call in a fresh process (includes Prisma connect and engine warm-up), warm = median
of the next four.

### `getHousekeepingSummary`, unscoped

| Scenario | Tasks / sessions in window | Before: warm (cold) | Before: stmts / DB ms / heap MB / RSS MB | After: warm (cold) | After: stmts / DB ms / heap MB / RSS MB |
| --- | --- | --- | --- | --- | --- |
| 200 rooms, 30 d | 5,178 / 6,266 | 946 (3,174) | 26 / 324 / 73 / 101 | **172** (2,277) | 22 / 177 / 35 / 28 |
| 500 rooms, 7 d | 2,979 / 3,599 | 537 (2,280) | 25 / 192 / 49 / 59 | **120** (2,287) | 22 / 111 / 23 / 16 |
| 500 rooms, 30 d | 12,828 / 15,498 | **2,113** (3,815) - over budget | 25 / 588 / 126 / 244 | **458** (2,513) | 22 / 381 / 74 / 75 |
| 1,000 rooms, 30 d | 25,578 / 30,789 | **4,436** (6,356) - over budget (latency, statements) | 31 / 1,128 / 255 / 422 | **898** (3,015) | 23 / 643 / 69 / 151 |
| 500 rooms, 90 d | 38,328 / 46,183 | **fails**: `too many bind variables in prepared statement, expected maximum of 32767, received 32768` | - | **1,456** (3,374) | 22 / 1,124 / 122 / 201 |

Assignee-scoped housekeeping (about 4 % of rows) was 74-320 ms warm before and 49-134 ms after in
every scenario; payloads are 1-5 KB. Unscoped payloads are 8-94 KB.

### `getMaintenanceSummary` (unchanged)

| Scenario | Tickets in window | Run A: warm (cold) | Run B: warm (cold) | Stmts / DB ms / heap MB |
| --- | --- | --- | --- | --- |
| 200 rooms, 30 d | 1,756 | 149 (151) | 127 (122) | 13 / 35-85 / 20 |
| 500 rooms, 7 d | 729 | 65 (74) | 61 (59) | 13 / 35-40 / 9 |
| 500 rooms, 30 d | 2,206 | 202 (234) | 187 (336) | 13 / 56-58 / 25 |
| 1,000 rooms, 30 d | 2,956 | 263 (259) | 242 (286) | 13 / 33-65 / 34 |
| 500 rooms, 90 d | 3,706 | 555 (2,592) | 331 (354) | 13 / 73-107 / 41-94 |

Run A and Run B are two independent seeded runs (taken before and after the housekeeping change;
this function was not modified, so the spread is run-to-run noise, including cold-start outliers).
Tickets are an order of magnitude fewer than cleaning tasks; latency scales roughly linearly and
stays well inside budget.

### Query plans

`EXPLAIN (ANALYZE, BUFFERS)` of the hot filters at 500 rooms/30 d: `CleaningTask` (12,828 of 25,658
rows match) 4.3 ms, `CleaningSession` (15,498 of 30,800) 4.4 ms, `MaintenanceTicket` (2,206 of 2,956)
0.6 ms - all sequential scans, correctly chosen because 50-75 % of the table is in the window.
Database time is therefore not the bottleneck: before the change roughly 70 % of the 2.1 s warm
latency was spent in Prisma result hydration and JS (the summed DB time was 0.59 s), which is what
the fix reduces. Existing indexes (`completedAt,status`, `finishedAt`-related, `openedAt`) are
sufficient; no index was added.

## Root cause and change

`getHousekeepingSummary` loaded every completed task in the window with
`include: { sessions, inspections, location -> floor -> building }`. Prisma executes a nested
include as separate queries of the form `... WHERE taskId IN (<every task id>)`, so (1) each task id
became a bind parameter - above 32,767 tasks PostgreSQL rejects the statement, a hard 500 for a
large property or a long custom range; (2) the `location` hierarchy was fetched and hydrated for
every task although nothing read `task.location` (only rejected inspections need labels); and
(3) full session rows (notes, command ids, timestamps) were hydrated when three columns are used.

Change (`housekeepingSummary.ts`, behaviour-preserving):

- Completed tasks are read with `select` of the six fields actually used
  (`id, locationId, dueAt, completedAt, priority, serviceType`), through one shared
  `completedTaskWhere` (status + inclusive period + scope).
- Sessions of those tasks are read in one query joined through the task relation
  (`task: completedTaskWhere`, `select` of four columns) and grouped in memory by `taskId`.
- "Auto-accepted" is a `count` with `inspections: { none: { result: approved } }` (the same
  construct the prior-period KPI already used) instead of probing a `take: 1` include per task.
- The period `completedSessions` query selects only `startedAt, finishedAt, anomalyFlags`.
- Statement count dropped from 25-31 to 22-23; the number no longer grows with task count.

Not changed: period bounds, UTC day semantics, scope merging (`...taskW` order is preserved),
anomaly threshold, percentile samples, risk-room merge, forecast, comparison deltas, response shape.

## Correctness evidence

- **Parity.** A temporary copy of the pre-change function (from `git show HEAD:...`) was compared
  with the new one using `assert.deepEqual` over the full JSON result on a 300-room/30-day seeded
  database for: unscoped 30 d (7,728 tasks), unscoped 7 d, single-assignee scope, an `OR` scope
  (`assignee OR priority=high`) and the empty-scope sentinel (`id: "__none__"`). All five were
  identical (KPIs, comparison, series, breakdowns, risk rooms, forecast). The temporary files were
  removed afterwards.
- **Regression test.** `api/tests/scenarios/analytics.db.test.ts` gained "housekeeping summary
  survives a window above the 32,767 bind-variable limit": it inserts 32,800 completed tasks and
  sessions in an isolated 1999 window, asserts counts, accepted tasks, on-time %, average and
  total valid minutes, and cleans up. It **fails on the previous implementation** with the exact
  Prisma error and passes now (about 13 s). The 13 existing tests in that file (scope, periods,
  UTC day membership, anomalies, percentile gating, forecast calendars, total ordering) still pass.
- `npx tsc --noEmit` passes for the API.

## Remaining observations (not changed)

- Cold first call is 2-3 s in every scenario (Prisma connect, engine/query-plan warm-up, settings
  read); it does not scale with data and is not specific to analytics.
- Unscoped housekeeping still materialises one row per completed task and per session in memory
  (about 125 MB RSS at 38k tasks). A SQL `GROUP BY`/percentile rewrite is only warranted if a
  single window regularly exceeds ~100k tasks; it would need parity tests for anomaly flags,
  rework and UTC-day semantics first.
- `getCleaningResults` (`api/src/services/cleaningResults/`) uses the same include-heavy pattern and
  was **not** measured here; if it serves similarly large windows it should be checked with the
  same harness.
