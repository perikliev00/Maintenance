# Audit remediation follow-up

**Дата:** 1 ноември 2026 (update)  
**Backlog източник:** `docs/audit-independent-verification.md` (NEW-01..07 + остатъци)  
**Ограничение:** BUG-01..10 поправките не са разваляни.

## Направено

### Фаза A — blocking builds (31.10)

| Item | Статус |
|---|---|
| **NEW-01** | DONE — PermissionsPage `reloadOnConflict` |
| **NEW-02** | DONE / N/A — API build зелен |
| Gates | api/web lint+build PASS |

### Фаза B — hardening (31.10)

| Item | Статус |
|---|---|
| **NEW-03** | DONE — `permissions.changed` live |
| **NEW-07** | DONE — `sector.save` labels/filters |
| Overdue scope DB | DONE |
| startJobRun publish | DONE |
| **NEW-04** | DONE — stale/clear events UX |

### Остатъци — затворени (01.11)

| Item | Действие | Доказателство |
|---|---|---|
| **NEW-05** | `jobs.run` action; POST `/jobs/run` → `requireAction("jobs.run")`; GET остава `jobs.view`; catalog seed manager/admin; FE capabilities | `jobs.run.http.test.ts` — view-only 403 на POST; GET 200 |
| **NEW-06** | Playwright smoke `e2e/tests/audit-page-smoke.spec.ts` | 1/1 PASS |
| Historical null `locationId` | Migration `20261101140000_backfill_audit_location_ids` + `backfillAuditLocationIds()` | DB тест PASS; migrate deploy на p1 + local |
| Multi-process jobs | Postgres `pg_try_advisory_lock` в `executionLock` (`connection_limit=1`); abandon TTL 30m + **periodic sweep** на всеки scheduler tick | cross-session advisory lock тест + runLifecycle + scheduler sweep тест PASS |
| Producer ⊆ filters | `KNOWN_AUDIT_PRODUCER_ACTIONS` / `REQUIRED_AUDIT_PRODUCER_ACTIONS` + unit asserts | labels + producers тестове PASS |

### Residual risks — затворени (01.11, след PASS_WITH_RISKS)

| Risk | Действие | Доказателство |
|---|---|---|
| Липсващ advisory-lock regression test | Cross-session holder: чужд `pg_try_advisory_lock` → `{acquired:false}` | `executionLock.test.ts` |
| Crash orphans само на restart | `abandonStaleRunningJobRuns` на boot **и** на всеки interval tick | `scheduler.ts` + `scheduler.test.ts` |
| Плитък Audit E2E | Live SSE: jobs panel + settings→events без reload | `audit-page-live-refresh.spec.ts` |
| Lock deployment assumptions | `docs/operations/deploy.md` § Background job lock + `executionLock.ts` | deploy doc + `connection_limit=1` unit тест |

## Изпълнени команди (01.11)

```text
cd web && npm test && npm run lint && npm run build
→ 292 pass; lint/build PASS

cd api && npm run lint && npm run build → PASS

cd api && node ./tests/runWithP1Isolation.mjs --test-concurrency=1 \
  src/services/audit.scope.test.ts \
  src/services/audit.producers.test.ts \
  src/services/audit.backfillLocationIds.test.ts \
  src/services/jobs/runLifecycle.test.ts \
  src/services/jobs/executionLock.test.ts \
  src/services/jobs/scheduler.test.ts \
  src/events/authorizeLiveEvent.test.ts \
  tests/scenarios/jobs.db.test.ts \
  tests/scenarios/jobs.run.http.test.ts \
  tests/scenarios/scheduler.test.ts \
  tests/scenarios/audit.sla-scope.db.test.ts \
  tests/scenarios/audit.overdue-scope.db.test.ts
→ PASS (incl. cross-session advisory lock + periodic abandon sweep)

cd e2e && npx playwright test tests/audit-page-smoke.spec.ts tests/audit-page-live-refresh.spec.ts
→ smoke + live refresh PASS
```

## Отворено

**Няма** за verification backlog + residual risks от независимия reverify (lock test, periodic abandon, live E2E).

(Опционално извън scope: AST generator CI за `recordAudit` action strings; producers без live event — `sector.*` / `card.*` и др. — остават manual-refresh only.)

## Readiness

Gates + residual closures → **READY** за одитния модул (advisory lock + 30m stale TTL + periodic sweep; direct Postgres session pooling).
