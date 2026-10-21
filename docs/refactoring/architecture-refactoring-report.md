# Architecture refactoring report

Date: 2026-10-20

## Scope and approach

The audit covered the TypeScript production sources in `api/src` (249 files,
approximately 31,000 lines) and `web/src` (125 files, approximately 22,000
lines), their adjacent tests, package scripts, route/controller/service
boundaries, and the largest files by responsibility rather than line count.

The repository already has useful domain boundaries. In particular, the API
separates Express routes/controllers from most domain services, while critical
cleaning lifecycle support is already split into claims, locks, cycle handling,
idempotency, status projection, and Prisma-conflict mapping. The web app uses
feature folders for Settings, Repairs, Locations, Plan, and My Work. This audit
therefore deliberately avoided a mechanical file split.

## Changed modules

### `api/src/services/analytics/maintenanceSummary.ts`

- **Original issue:** The monthly projection calculation duplicated the same
  28-day UTC lookback, calendar-day calculation, display rounding, and formula
  construction used by the housekeeping summary.
- **Change:** Replaced that sequence with `forecastWindowStart` and
  `buildMonthlyForecast`.
- **Behavior preserved:** The ticket query, scope predicate, 28-day window,
  rounding, response fields, `unit`, and formula text remain unchanged.

### `api/src/services/analytics/housekeepingSummary.ts`

- **Original issue:** Same duplicated forecast algorithm, with only the query
  and human-readable metric label differing.
- **Change:** Uses the same shared forecast helpers while keeping its own
  completed-task query and `cleaned tasks` formula label.
- **Behavior preserved:** Cleaning-task scope, time bounds, output shape, and
  `cleaned_tasks` unit remain unchanged.

### New `api/src/services/analytics/forecast.ts`

- **Responsibility:** Owns the analytics-wide forecast policy: a 28-day UTC
  lookback, remaining UTC calendar days, one-decimal display rounding, and
  domain-neutral response fields.
- **Reuse:** Called by both maintenance and housekeeping summary builders.
- **Boundary:** It does not query Prisma or receive scope filters. Callers keep
  their own transaction/query and authorization semantics.

### New `api/src/services/analytics/forecast.test.ts`

- **Coverage:** Proves the exact UTC lookback, formula string, rounding, and
  zero forecast at month end.

## Analyzed and intentionally not refactored

| Area / files | Finding | Decision |
| --- | --- | --- |
| `api/src/services/cleaning/sessions.ts` (724 lines) | Large lifecycle orchestrator for start/complete/cancel, but its lock order, idempotency rechecks, conditional claims, audit, and post-commit events are deliberately co-located per transition. | Do not split transaction flows. Moving shared-looking complete/cancel steps would blur different state transitions and could affect lock/transaction boundaries. Existing helpers already isolate the reusable mechanisms. |
| `api/src/services/analytics/housekeepingSummary.ts` (494 lines) | Dense but a single scoped analytics aggregate with distinct housekeeping KPIs. | Retained after extracting the only fully equivalent shared forecast algorithm. Query decomposition would introduce data-shaping layers without reducing domain complexity. |
| `api/src/controllers/maintenance/tickets.ts` (432 lines) and `api/src/controllers/locations.ts` (337 lines) | Multiple HTTP endpoints, validation, scope checks, and delegation to services. | Retained: controllers preserve endpoint-specific validation/status behavior; superficial Zod parsing similarity is not a safe common abstraction. |
| `api/src/services/locations/crud.ts`, `api/src/services/shifts.ts`, `api/src/services/operationsLive.ts`, `api/src/services/notifications.ts` | Larger service files, each centred on one domain workflow and already supported by adjacent focused modules/tests. | No evidence of a coherent extraction that improves dependency direction without expanding APIs. |
| `api/src/services/sync/{pull,push,device,conflicts,commands}` | Offline synchronization is already decomposed by protocol stage. | No change; transaction and conflict semantics are intentionally separated. |
| `web/src/offline/queueDrain.ts` (475 lines) | Long queue-draining pipeline with retry/conflict/state stages. | Retained: stages share ordering and outbox ownership; existing focused helper modules and tests cover surrounding responsibilities. |
| `web/src/api/capabilities.ts` (468 lines) and `web/src/api/maintenanceApi.ts` (393 lines) | Large typed API façades. | Retained: endpoint mapping is their single responsibility; splitting by CRUD verb would make discovery and imports worse. |
| Large web pages/components: `AnalyticsPage.tsx`, `CardsPage.tsx`, `TeamPage.tsx`, `ControlPage.tsx`, `IssueCatalogPanel.tsx`, `RepairsPage/index.tsx` | Screen-specific UI state and rendering, with existing feature folders where extraction is worthwhile. | No change without a demonstrated reusable state/visual unit. Similar date display and form patterns have context-specific locale/validation behavior. |
| Validation and error-response patterns across controllers | Repeated `safeParse` / HTTP response shapes were found. | Intentionally not centralized: status codes and response payload contracts vary across endpoints; a generic wrapper would obscure API-specific semantics. |

## Verification

- `api`: `npx tsx --test src/services/analytics/forecast.test.ts` — **2 passed**.
- `api`: `npm run build` — **passed** (`tsc`).
- `api`: `npm run typecheck:tests` — **passed**.
- `web`: `npm run build` — **passed**. Vite reported existing dynamic/static
  import chunking warnings for the offline queue modules; it still produced the
  production bundle and these files were not changed.
- `git diff --check` — **passed**.
- A broad `npm test` was attempted. The new forecast suite passed, but the full
  pre-existing database-heavy suite encountered unrelated concurrency failures:
  `dataScope HTTP` hit Prisma `P2028` (interactive transaction exceeded its
  5-second timeout) and `permissions HTTP` timed out waiting on its PostgreSQL
  barrier. No changed analytics module appears in either stack trace. These
  suites should be rerun in the project’s isolated DB test environment before
  treating the full-suite result as green.

## Remaining risks

- The shared forecast has pure unit coverage; the existing scoped analytics HTTP
  tests remain the integration safeguard for Prisma filters and response use.
- No schema, migration, authorization, HTTP contract, or transaction code was
  changed.
