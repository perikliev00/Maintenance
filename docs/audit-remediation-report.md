# Одит лог — отчет за ремонт и независима валидация

**Дата:** 31 октомври 2026  
**Проект:** `C:\Users\Admin\Desktop\maintenance`  
**Източник на дефектите:** `Одит-лог-ръководство-и-технически-одит.md` (Codex, 29.10.2026)

## 1. Статус на 10-те дефекта

| ID | Статус | Първопричина | Поправка | Доказателство |
|---|---|---|---|---|
| **BUG-01** | **FIXED** | `recordAudit` за SLA/overdue без `locationId` → scope predicate ги изключва | `ticketSlaBreach.ts` и `overdueSessions.ts` подават `locationId` (+ summary/`after`) | DB: `audit.sla-scope.db.test.ts`, assertions в `jobs.db.test.ts`; unit: `audit.scope.test.ts` |
| **BUG-02** | **FIXED** | Безусловен `setRows` без номер на заявка | `refreshGen` + `shouldApplyAuditRefresh` в `AuditPage` / `auditPageLogic` | `auditPageLogic.test.ts` (generation + обърнат ред) |
| **BUG-03** | **FIXED** | „Обнови“ вика `refresh()` без catch/`setError` | Общ `load()` път: clear error → settle → banner; бутонът е disabled докато busy | `auditPageLogic.test.ts` (recovery след offline) |
| **BUG-04** | **FIXED** | `Promise.all` отхвърля и двете при една грешка | Независим `settleAuditFetch` + `combineAuditLoadResults` | `auditPageLogic.test.ts` (jobs fail / audit fail матрица) |
| **BUG-05** | **FIXED** | `formatScalar` → `String(object)` | Рекурсивен `appendDiffLines` + `JSON.stringify` fallback | `labels.test.ts` (nested email settings) |
| **BUG-06** | **FIXED** | `eventTypes` без `location.changed` | `AUDIT_PAGE_LIVE_EVENTS` включва `location.changed` | `auditLiveEvents.test.ts` + код в `AuditPage` |
| **BUG-07** | **FIXED** | `finishJobRun` не публикува сигнал | `jobs.changed` в bus/authorize/web allowlist; publish от `startJobRun`/`finishJobRun`/`abandonStaleRunningJobRuns` | `runLifecycle.test.ts`, `authorizeLiveEvent.test.ts` |
| **BUG-08** | **FIXED** | UI показва само тип; SLA без summary/идентичност | Summary + `after.title/locationNumber/ticketId`; `formatAuditRelated` | `labels.test.ts`, `auditPageLogic.test.ts`, DB assertions |
| **BUG-09** | **FIXED** | Филтрите изостават от producers | Филтрите се строят от label maps; добавени people/device/employee/… | `labels.test.ts` |
| **BUG-10** | **FIXED** | Липсва `JOB_KEY_LABELS.stale_open_attendance` | BG/EN етикет + scanned/flagged summary | `labels.test.ts` |

### Допълнителни hardening (извън оригиналните 10, покрити от задължителните сценарии)

- Конкурентни SLA сканирания: `FOR UPDATE` върху ticket + повторна проверка на recent marker → един одитен ред (`jobs.db.test.ts`).
- Промяна на статус по време на SLA: повторна валидация на open/paused под ключалка преди audit/notify.
- Изоставени `running` JobRun след crash: `abandonStaleRunningJobRuns` при старт на scheduler.

## 2. Съществуващи тестове (преди ремонта)

| Файл | Вид | Какво покрива | Ограничение спрямо BUG-ите |
|---|---|---|---|
| `api/src/services/audit.scope.test.ts` | Unit | Scope predicate / where builder | Не доказва producers/`locationId` |
| `api/src/services/audit.write.test.ts` | DB | `recordAudit` write contract | Не SLA/overdue |
| `api/tests/scenarios/jobs.db.test.ts` | DB | Overdue/SLA/lock/orchestrator | Броеше events, **без** `locationId` |
| `api/tests/scenarios/jobs.run.http.test.ts` | HTTP | POST `/jobs/run` lock | Не Audit UI |
| `api/src/services/jobs/executionLock.test.ts` | Unit | In-process lock | — |
| `api/src/services/dataScope/scope.http.test.ts` | HTTP | T-AUDIT-HTTP-01 location filter | Не job producers |
| `api/src/events/authorizeLiveEvent.test.ts` | Unit | SSE delivery | Без `jobs.changed` |
| `web/src/pages/liveBoard.audit.test.ts` | Unit | **Не** Audit страница (live board) | Името е подвеждащо |
| `api/tests/scenarios/operations-live.audit.db.test.ts` | DB | **Не** Audit лог | Името е подвеждащо |

## 3. Добавени / разширени тестове

| Файл | Вид | Сценарий |
|---|---|---|
| `web/src/audit/labels.test.ts` | Unit | BUG-05 nested JSON; BUG-09 filters; BUG-10 labels; BUG-08 summary |
| `web/src/pages/auditPageLogic.test.ts` | Unit / concurrency | BUG-02 race; BUG-03 recovery; BUG-04 partial failure; BUG-08 identity |
| `web/src/pages/auditLiveEvents.test.ts` | Contract | BUG-06/07 eventTypes |
| `api/src/services/jobs/runLifecycle.test.ts` | DB + bus | BUG-07 publish; abandoned running |
| `api/tests/scenarios/audit.sla-scope.db.test.ts` | DB integration | BUG-01 own vs foreign scope |
| `api/tests/scenarios/jobs.db.test.ts` (разширен) | DB | `locationId`/summary; concurrent SLA |
| `api/src/services/audit.scope.test.ts` (разширен) | Unit | null `locationId` exclusion |
| `api/src/events/authorizeLiveEvent.test.ts` (разширен) | Unit | `jobs.changed` delivery |

## 4. Матрица на покритие

| Функционалност | Сценарий | Риск | Съществуващ | Добавен | Тип | Приоритет |
|---|---|---|---|---|---|---|
| SLA audit scope | Собствено помещение видимо | Висок | Частичен (count) | `audit.sla-scope` + jobs asserts | DB | P0 |
| SLA audit scope | Чуждо помещение скрито | Висок | — | `audit.sla-scope` | DB | P0 |
| Overdue audit | `locationId` записан | Висок | Count only | jobs.db assert | DB | P0 |
| Filter race | Стар HTTP след нов филтър | Висок | — | auditPageLogic | Unit/concurrency | P0 |
| Refresh errors | Offline → banner; recovery | Среден | — | auditPageLogic | Unit | P1 |
| Partial failure | Jobs 403, audit OK | Висок | — | auditPageLogic | Unit | P0 |
| Nested details | settings email object | Среден | — | labels.test | Unit | P1 |
| Live location | `location.changed` subscribed | Среден | — | auditLiveEvents | Contract | P1 |
| Job finish | `jobs.changed` publish | Среден | — | runLifecycle | DB | P1 |
| SLA identity | Две повреди различими | Среден | — | formatAuditRelated + summary | Unit+DB | P1 |
| Filters | people/device/… | Нисък | — | labels catalogues | Unit | P2 |
| Job label | `stale_open_attendance` BG | Нисък | — | labels | Unit | P2 |
| Concurrent SLA | Два паралелни scan | Среден | 12h window | concurrent test + FOR UPDATE | DB/concurrency | P1 |
| Abandoned jobs | running след restart | Среден | — | abandonStaleRunningJobRuns | DB | P1 |
| Roles/scope HTTP | Чужди данни | Висок | scope.http T-AUDIT | — | HTTP | вече покрит |
| E2E browser | Пълен UI поток | Среден | — | **липсва** | E2E | остатъчен |

## 5. Изпълнени команди и резултати

```text
# Web unit
cd web && npm test
→ 285 pass / 0 fail

# API focused unit
cd api && node ./tests/runWithP1Isolation.mjs --test-concurrency=1 \
  src/services/audit.scope.test.ts \
  src/services/jobs/runLifecycle.test.ts \
  src/events/authorizeLiveEvent.test.ts
→ 18 pass / 0 fail

# API DB scenarios (maintenance_p1_test via .env.p1_test)
cd api && node ./tests/runWithP1Isolation.mjs --test-concurrency=1 \
  tests/scenarios/jobs.db.test.ts \
  tests/scenarios/audit.sla-scope.db.test.ts
→ 9 pass / 0 fail

# Lint / build
cd api && npm run lint && npm run build → OK
cd web && npm run lint → OK
cd web && npm run build → FAIL (pre-existing PermissionsPage.tsx:203 type error; out of audit scope)
```

Изолирана база: `maintenance_p1_test` на `127.0.0.1:5433`. Работната seed база не е пипана.

## 6. Независим одит

| Поле | Стойност |
|---|---|
| Агент | Отделен `generalPurpose` субагент с чист контекст ([Independent audit validation](db5711fc-cacc-47e3-bb41-93a1f55d5a5d)) |
| Вердикт | **PASS_WITH_RISKS** |
| BUG-01..10 | Всички **FIXED** (потвърдени по код + тестове, без доверие на имплементаторски твърдения) |
| Mutation probes (ръчни) | Премахнат `locationId` → 3 DB fail; `shouldApply` always true → 1 fail; `String(object)` → 1 fail |
| Бележки | Няма DOM/E2E тест за `AuditPage`; helper-level race тест не убива липсващ wiring в компонента без code review |

След независимия одит са приложени две допълнителни подобрения: паралелни settle заявки; `jobs.changed` и при `startJobRun`.

## 7. Оставащи рискове / непроверени сценарии

1. **Няма Playwright E2E** за Audit страницата (филтри, refresh, SSE в браузър).
2. **Няма React component/DOM тест** — race/partial failure са покрити през pure helpers + code review на wiring.
3. **Исторически SLA/overdue редове с `locationId = null`** не са backfill-нати; остават невидими под sector scope.
4. **`abandonStaleRunningJobRuns` при multi-process** би маркирал чужди `running` редове — текущият scheduler е in-process (същият модел като execution lock).
5. **`jobs.changed` се доставя на всички SSE абонати** (без payload); UI панелът остава gated с `jobs.view`.
6. **Web `tsc -b`** е счупен от предварителна грешка в `PermissionsPage.tsx` (извън обхвата на Одит).

## 8. Регресии и как са изключени

| Област | Как е проверена |
|---|---|
| Съществуващи jobs DB сценарии P1-122..125 / P2-54/56 | Пълен `jobs.db.test.ts` зелен след промените |
| Audit scope unit | Пълен `audit.scope.test.ts` зелен |
| Live event authorization | Пълен `authorizeLiveEvent.test.ts` зелен |
| Web regression suite | 285/285 pass |
| API typecheck | `tsc` build зелен |
| Чужди модули (Permissions build) | Известен предварителен fail — не въведен от този ремонт |

## 9. Финален статус

| BUG | Статус |
|---|---|
| BUG-01 | **FIXED** |
| BUG-02 | **FIXED** |
| BUG-03 | **FIXED** |
| BUG-04 | **FIXED** |
| BUG-05 | **FIXED** |
| BUG-06 | **FIXED** |
| BUG-07 | **FIXED** |
| BUG-08 | **FIXED** |
| BUG-09 | **FIXED** |
| BUG-10 | **FIXED** |

**Критерий за приключване:** 10/10 коригирани и покрити с подходящи тестове; релевантните изолирани проверки преминават; независимата валидация е **PASS_WITH_RISKS** (без незатворени съществени дефекти; остатъчните рискове са документирани по-горе).
