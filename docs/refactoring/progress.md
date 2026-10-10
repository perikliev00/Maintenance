# Maintenance — регистър на прогреса по рефакториране

**План:** [`plan.md`](./plan.md)  
**Базова версия от плана:** `16d1b61aded6a3a19b598f9531e06ea469bf6bef`  
**Създаден:** 10 октомври 2026 г.  
**Статус на изпълнението:** F-01, T-01–T-04 изпълнени; следваща допустима задача T-12.

## Правила за бъдещите агенти

1. Преди всяка работа прочетете `docs/refactoring/plan.md` и този регистър (`progress.md`).
2. Изпълнявайте **само** изрично възложената задача (един T-xx или F-xx ID). Не започвайте съседни или „очевидни“ следващи задачи.
3. Отбелязвайте статус `done` **само** след успешни проверки според договора на задачата **и** записан commit (и PR, ако е създаден). Без доказателства задачата остава `pending` / `in_progress` / `blocked`.
4. Записвайте резултатите от проверките в колоната „Изпълнени проверки и резултати“, включително **неуспешни** или **неизпълнени** проверки (команда, среда, грешка/пропуск).
5. След приключване или блокиране обновете секцията „Следваща задача“ според реда и зависимостите в Част C на плана. **Не** започвайте автоматично следващата задача.
6. Не смесвайте чисто рефакториране (T) с функционални поправки (F/B). Отделни commits/PR-и; known behavior може да се фиксира в characterization fixture без да се обявява за желан продуктово договор.
7. Допустими статуси: `pending`, `in_progress`, `blocked`, `done`, `skipped`.
8. При промяна на `main` първо актуализирайте baseline доказателствата; не прилагайте плана сляпо върху остарели файлове.

## Следваща задача

| Поле | Стойност |
|---|---|
| **ID** | **T-12** |
| Кратко име | Единна audit signature |
| Приоритет | P2 |
| Защо е първа | Част C.2, етап 1: `T-03 → T-04 → T-12`. F-01–T-04 са `done`. |
| Точен обхват | По договора на T-12 в `plan.md` (R-06): typed `(input, db = prisma)` за recordAudit/Many. |
| Предварителни проверки | T-02–T-04; audit write fixtures (JsonNull/trim/occurredAt) и tx rollback test. |
| Не изпълнявай още | Тази секция само посочва следващата допустима задача; изпълнението започва само след изрично възлагане. |

## Регистър на задачите

Колони: ID и кратко име · приоритет · зависимости · статус · commit/PR · изпълнени проверки и резултати · блокери и бележки.

Редът в таблицата следва препоръчания ред от Част C.2 (не числовия ред на ID).

### Етап 0 — Възстановяване

| ID и кратко име | Приоритет | Зависимости | Статус | Commit/PR | Изпълнени проверки и резултати | Блокери и бележки |
|---|---|---|---|---|---|---|
| F-01 — Seed reset FK (NotificationDelivery→Notification преди Employee) | P1 | — | done | `9840223` | Disposable PG `localhost:5434/maintenance_f01`. Преди fix: `migrate deploy` → `db:seed` → `npm test` (128/128) → втори `db:seed` → P2003 `Notification_recipientEmployeeId_fkey` на `employee.deleteMany()`. Baseline: RoleGrant=164; AppliedDataSeed=`grants.sectors.transfer_cross.v1`; Notification=20 / Delivery=60. След fix: seed → test 128/128 → втори seed OK → 6 atomic smokes OK; RoleGrant=164; AppliedDataSeed непроменен. | Само `api/prisma/seed.ts` (+2 deleteMany без catch). Schema/CI/roleGrants непроменени. |
| T-01 — Компилируеми тестове и smoke скриптове | P1 | F-01 | done | `9b6251c` | Disposable PG `localhost:5434/maintenance_t01`. Преди: migrate+seed; api/web production tsc=0; api `npm test` 128/128; web `npm test` 34/34. След: api/web production tsc+build=0; `typecheck:tests`=0 (api+web); web `listFilesOnly` включва 4-те `*.test.ts`; api test 128/128; web test 34/34; `smoke-daily-plan-atomic` OK; `smoke-ticket-lifecycle-idempotency` OK. | `api/tsconfig.tests.json`, `web/tsconfig.tests.json`, `typecheck:tests` scripts; web `types:[]` + `@types/node@^22`; FormattedMaintenanceTicket; roomRow; ingest timeZone/annotations; stale includes-before-deepEqual. CI непроменян. |
| T-02 — CI изпълнява наличните реални проверки | P1 | F-01, T-01 | done | `b53d8ef`; [Actions run 38081720492](https://github.com/perikliev00/Maintenance/actions/runs/38081720492) | CI green (api/web/smoke/smoke-audit-upgrade). PG16 predicates: SessionStatus `running`; TaskStatus `= ANY (ARRAY[...])`; TicketEvent `indpred` NULL. Negative: DROP `CleaningSession_one_running_per_task` → assert exit 1; recreate+migrate → exit 0. Local disposable `maintenance-t02-pg@5435`: migrate→SQL→seed→test 128→seed→lifecycle→6 atomics; api/web typecheck+build; web test 34. CI steps: typecheck:tests (api+web), web test, SQL invariants, lifecycle, 6 atomics. | `assert-sql-invariants.ts`; `test:db`; ci.yml. Без skip/`continue-on-error`. |

### Етап 1 — Реални договори

| ID и кратко име | Приоритет | Зависимости | Статус | Commit/PR | Изпълнени проверки и резултати | Блокери и бележки |
|---|---|---|---|---|---|---|
| T-03 — Реални grant bootstrap тестове и точни fixtures | P2 | T-01, T-02 | done | `d02c0fc`; [Actions run 38083739741](https://github.com/perikliev00/Maintenance/actions/runs/38083739741) | Ephemeral DB + child processes: real `ensureDefaultRoleGrants`/`applyCatalogGrantSeed`; test seedId `grants.t03.catalog.v1`; G1–G6 + restart spawn; control ledger `grants.t03.control`. Attendance/cards: own employee/user fixtures; history/AND asserts запазени; FK cleanup + notifications; control `t03-unrelated-control@test.local`. Local `@5433`: typecheck:tests; `npm test` 125/125 ×2 (+5 stress); `test:db` 3/3. CI api/web/smoke/audit-upgrade green. | `api/tests/fixtures.ts`, `roleGrants.bootstrap.child.ts`; tsconfig include `tests/**`. Без seed reset като revoke proof. |
| T-04 — Scope smoke с истински откази | P1 | T-03 | done | `4dfaee3`; [Actions run 38085520819](https://github.com/perikliev00/Maintenance/actions/runs/38085520819) | Assert-based `smoke-data-scope.ts`: createApp+listen; two-sector fixtures; own allowed / foreign 403; hk foreign assignee=0; empty scope ≠ all; ticket/audit/live via exports. Negative: expect 200 on foreign GET → exit 1. CI smoke step after daily-plan atomic. | `api/tests/fixtures.ts` scope builders; no backfill; no production scope changes. |
| T-12 — Единна audit signature | P2 | T-02, T-03, T-04 | pending | — | — | R-06. Без промяна на payload/transaction ownership. |

### Етап 2 — Command boundary

| ID и кратко име | Приоритет | Зависимости | Статус | Commit/PR | Изпълнени проверки и резултати | Блокери и бележки |
|---|---|---|---|---|---|---|
| T-05 — Един cleaning conflict snapshot | P2 | T-04, T-12 | pending | — | — | R-05. Pure extraction. |
| T-06 — Typed command inputs и общ actor/access context | P1 | T-05 | pending | — | — | R-05. Transport различия (B-02) остават до F-02. |

### Етап 3 — Cleaning

| ID и кратко име | Приоритет | Зависимости | Статус | Commit/PR | Изпълнени проверки и резултати | Блокери и бележки |
|---|---|---|---|---|---|---|
| T-07 — Самостоятелен cleaning cycle module | P1 | T-04, T-12 | pending | — | — | R-03. Caller подава tx; без нов transaction във façade. |
| T-09 — Cleaning notification payload construction | P2 | T-07 | pending | — | — | R-03. След cycle, преди session extraction. |
| T-08 — Session commands отделени от task management | P2 | T-06, T-07, T-09 | pending | — | — | R-03. Atomic smokes задължителни преди merge. |
| T-15 — Общ daily-plan task patch | P2 | T-07, T-08 | pending | — | — | R-09. Без сливане на whole plan create и manual cleaning create. |

### Етап 4 — Останал backend

| ID и кратко име | Приоритет | Зависимости | Статус | Commit/PR | Изпълнени проверки и резултати | Блокери и бележки |
|---|---|---|---|---|---|---|
| T-10 — Ticket projections, DTO и queries | P2 | T-02, T-12 | pending | — | — | R-04. |
| T-11 — Чисти maintenance policy и event mapping | P2 | T-10 | pending | — | — | R-04. |
| T-13 — People business service | P2 | T-03, T-12 | pending | — | — | R-07. Без H-01/H-02 transaction промени. |
| T-14 — Catalog route и async error forwarding | P2 | T-06, T-10 | pending | — | — | R-08. Optional ако няма работа по catalog/lifecycle. |
| T-16 — Typed location projections | P2 | T-07, T-10 | pending | — | — | R-10. B-03/F-03 отделно. |
| T-17 — Общи cleaning метрики | P2 | T-02 | pending | — | — | R-11. Може да се отложи (E.3). |
| T-18 — JobRun wrapper и scheduler boundary | P2 | T-12 | pending | — | — | R-12. F-08 е отделен commit. Може да се отложи (E.3). |

### Етап 5 — Offline

| ID и кратко име | Приоритет | Зависимости | Статус | Commit/PR | Изпълнени проверки и резултати | Блокери и бележки |
|---|---|---|---|---|---|---|
| T-19 — Offline characterization и browser regression harness | P1 | F-01, T-01, T-02, T-04 | pending | — | — | R-13. Test-only преди extraction. |
| T-20 — Offline transport отделен | P1 | T-19 | pending | — | — | R-13. |
| T-21 — Offline drain engine с един runtime owner | P1 | T-20 | pending | — | — | R-13. Най-рисков frontend move. |

### Етап 6 — Frontend API/types

| ID и кратко име | Приоритет | Зависимости | Статус | Commit/PR | Изпълнени проверки и резултати | Блокери и бележки |
|---|---|---|---|---|---|---|
| T-22 — Location и people/invitation API ownership | P2 | T-20, T-21 | pending | — | — | R-14. По един домейн на commit. F-06 отделно. |
| T-23 — Plan/settings/permissions API и един timezone cache | P2 | T-22 | pending | — | — | R-14. |
| T-24a — Attendance API extraction | P2 | T-23 | pending | — | — | R-14. |
| T-24b — Cards API extraction | P2 | T-24a | pending | — | — | R-14. Без F-04 datetime fix в този move. |
| T-24c — Sectors/shifts API extraction | P2 | T-24b | pending | — | — | R-14. |
| T-24d — Analytics/operations API extraction | P2 | T-24c | pending | — | — | R-14. |
| T-24e — Оставащи audit/jobs/sync/notification API exports | P2 | T-24d | pending | — | — | R-14. |
| T-25 — Typed v2 MyWork cache | P2 | T-21, T-24e | pending | — | — | R-15. Без DB version change. |

### Етап 7 — Frontend workflows

| ID и кратко име | Приоритет | Зависимости | Статус | Commit/PR | Изпълнени проверки и резултати | Блокери и бележки |
|---|---|---|---|---|---|---|
| T-26 — Един offline status hook и indicator | P2 | T-19, T-21, T-25 | pending | — | — | R-16. |
| T-27 — Locations data/form/drawer ownership | P2 | T-22, T-26 | pending | — | — | R-17. Стъпките са отделни commits. |
| T-28 — Repairs report form и ticket event hook | P2 | T-24e, T-26 | pending | — | — | R-18. F-09 guard се пренася само ако F-09 е done. |
| T-29 — Sector form ownership | P2 | T-24c, T-26 | pending | — | — | R-19. |
| T-30 — Shift/roster form ownership | P2 | T-29 | pending | — | — | R-19. F-10b е отделен PR. |

### Етап 8 — Финална приемка

Пълен regression gate и before/after договори само за приключени и проверени задачи. Optional задачиките (напр. T-14, T-17, T-18, T-27–T-30 според E.3) могат да се маркират `skipped` с бележка, не `done`.

### Отделни дефектни задачи (F) — извън pure T потока

F-01 е в етап 0 по-горе. Останалите F задачи не са предварителни условия за pure extraction, ако known behavior е фиксирано явно; изпълняват се в отделни commits/PR-и.

| ID и кратко име | Приоритет | Зависимости | Статус | Commit/PR | Изпълнени проверки и резултати | Блокери и бележки |
|---|---|---|---|---|---|---|
| F-02 — Еквивалентни REST/sync command access flags | P1 | Желателни T-05, T-06; characterization на bypass матрицата | pending | — | — | Не се смесва с T-05/T-06 extraction. |
| F-03 — Mark-dirty projection (blocking statuses + sector) | P2 | DTO diff vs GET; T-16 може да помогне | pending | — | — | Отделно от T-16 types-only. |
| F-04 — Cards/Attendance datetime conversion helper | P2 | Избран browser-local или hotel-local договор; 12Z→09Z case | pending | — | — | UI conversion; без DB rewrite на история. |
| F-05 — Theme: apply DOM отделно от explicit persistence | P2 | Empty localStorage + server default light fixtures | pending | — | — | Без settings schema change. |
| F-06 — Team invitation QR локално генериране | P1 | Независим от етап 0 T потока (C.2: може отделен PR) | pending | — | — | Security correction; предпочитайте поправка напред пред revert към disclosure. |
| F-07 — Analytics CSV helper (3-column договор) | P2 | Quote/comma/newline regression fixture | pending | — | — | — |
| F-08 — Scheduler initial timeout tracking/clear | P2 | Fake-clock stop-before-15s; T-18 по желание | pending | — | — | Отделен от T-18 extraction. |
| F-09 — Query response guards (Attendance/Analytics/Results/Plan/Repairs) | P2 | Deferred A/B + loadMore fixtures; една страница на PR | pending | — | — | Не се смесва с T-28. |
| F-10a — Role-only UI controls → canPerformAction (+ legacy fallback) | P2 | DB custom grants / revoked / owner / legacy tests | pending | — | — | Server checks остават authoritative. |
| F-10b — Housekeeping independent permission-aware loading | P2 | Sectors allowed / shifts denied / people denied fixtures | pending | — | — | Отделен от T-30. |

## Обобщение

| Категория | Брой | Статус |
|---|---|---|
| T задачи (вкл. T-24a–T-24e) | 34 | 4× `done` (T-01–T-04); 30× `pending` |
| F задачи (вкл. F-10a, F-10b) | 11 | 1× `done` (F-01); 10× `pending` |
| **Общо регистрирани** | **45** | 5× `done` |
| Предложена следваща | T-12 | не е започната |

## Журнал на промени по регистъра

| Дата | Промяна |
|---|---|
| 2026-10-10 | Създадени `plan.md` (пълен прикачен документ) и този регистър. Приложен код не е променян. Следваща задача: F-01. |
| 2026-10-10 | F-01 изпълнена (`9840223`): `seed.ts` reset трие NotificationDelivery→Notification преди Employee. Възпроизведен P2003 преди fix; след fix втори seed + 6 atomic smokes + ledger/grants OK на disposable PostgreSQL 16 (`maintenance_f01` @ 5434). Следваща задача: T-01 (не е стартирана). |
| 2026-10-10 | T-01 изпълнена (`9b6251c`): test tsconfigs + typecheck scripts; web `types:[]` и `@types/node@^22`; lifecycle FormattedMaintenanceTicket; daily-plan roomRow; ingest/stale fixture types. Baseline и after на `maintenance_t01@5434`: api 128/128, web 34/34; двата задължителни smokes OK. Следваща задача: T-02 (не е стартирана). |
| 2026-10-10 | T-02 изпълнена (`b53d8ef`): CI api `typecheck:tests`; web `typecheck:tests`+`npm test`; smoke migrate→SQL invariants→seed→test→seed→lifecycle→6 atomics; audit-upgrade непроменен. PG16-измерени predicates в `assert-sql-invariants.ts`; negative DROP INDEX exit 1 → recreate exit 0. Actions: https://github.com/perikliev00/Maintenance/actions/runs/38081720492 (success). Следваща задача: T-03 (не е стартирана). |
| 2026-10-10 | T-03 изпълнена (`d02c0fc`): реални grant bootstrap тестове на ephemeral PG + child restart; attendance/cards fixtures с точен FK cleanup; `api/tests/fixtures.ts`. Aggregate `npm test` 125/125 (×2); Actions: https://github.com/perikliev00/Maintenance/actions/runs/38083739741 (success). Следваща задача: T-04 (не е стартирана). |
| 2026-10-10 | T-04 изпълнена (`4dfaee3`): assert-based scope smoke + in-process server + CI; two-sector fixtures; foreign 403. Actions: https://github.com/perikliev00/Maintenance/actions/runs/38085520819 (success). Следваща задача: T-12 (пакет фаза B). |
