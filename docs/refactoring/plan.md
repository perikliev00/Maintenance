# Maintenance — анализ и план за рефакториране

**Дата:** 10 октомври 2026 г.  
**Източник:** [perikliev00/Maintenance](https://github.com/perikliev00/Maintenance), branch `main`.  
**Фиксирана версия:** `16d1b61aded6a3a19b598f9531e06ea469bf6bef`, commit „Harden ticket lifecycle idempotency and deferred departure assignees“, 9 октомври 2026 г.

Анализът и всички препратки са за тази версия. **Не е променян изходен код.** Това е план, а не изпълнена миграция или рефакториране.

## Как да се използва докладът

- **R-xx** означава доказан проблем с вътрешната организация или качеството и предложение за рефакториране.
- **B-xx** означава отделен функционален дефект; поправката му променя сегашното поведение.
- **H-xx** означава установен рисков път или въпрос, за който липсва достатъчно проверка или уточнен договор.
- **T-xx** е малка задача от плана. **F-xx** е отделна задача за дефект, извън чистото рефакториране.
- „Статично потвърдено“ означава доказуемо от кода; не означава възпроизведено в работещ браузър или production.
- „Проверка преди промяна“ означава фиксиране на текущия договор, включително неочевидни детайли. Ако той съдържа B-xx, поправката се извършва в отделен commit/PR и новият договор се приема изрично.

**Не е установен доказан P0 структурен проблем. Има P1 проблеми:** ненадежден регресионен вход към рефакториране, повторени проверки на командите в REST/sync, обвързване на cleaning cycle с големия orchestration модул и смесени отговорности на offline опашката. Това не е основание за цялостно пренаписване.

# Част A: Архитектурен преглед

## A.1. Текуща структура

| Област | Текуща организация и отговорности |
|---|---|
| `api/src/app.ts`, `index.ts` | Express приложение, middleware, mount на маршрути, error handler, bootstrap на настройки/каталози, стартиране на jobs. |
| `api/src/routes/` | HTTP договори, Zod validation, права и data scope, извикване на услуги. Изключение с по-много бизнес работа е `people.ts`. |
| `api/src/services/` | Домейн команди, Prisma заявки, транзакции, audit, notifications, DTO mapping, изчисления. |
| `api/src/middleware/`, `auth/`, `permissions.ts` | Сесии, cookie/CSRF защита, JWT, права, role assignment. Runtime grant-овете са от БД. |
| `api/src/events/` | In-process event bus и авторизация за получаване на live events. SSE transport е в `routes/events.ts`. |
| `api/prisma/` | 37 модела, 25 enum-а, 34 SQL миграции, destructive demo seed и SQL за възстановяване на стара audit история. |
| `api/scripts/` | 9 smoke скрипта: atomicity, invitations, scope, audit upgrade и ticket idempotency. |
| `web/src/App.tsx` | Session bootstrap, права/модули, избор на панел, тема и shell. Навигацията е чрез state и специален room QR hash. |
| `web/src/pages/` | 22 страници; local React state, fetch, mutations, филтри и JSX. |
| `web/src/components/` | 14 компонента, включително вече отделени catalog/sector/shift панели, ticket lifecycle действия и charts. |
| `web/src/api/` | Общ HTTP/session transport, capabilities, SSE client; отделени cleaning/maintenance API модули; оставащ голям `client.ts`. |
| `web/src/offline/` | IndexedDB v2, команди, конфликтни решения, owner partition, outbox и drain/retry orchestration. |
| `web/src/hooks/useLiveRefresh.ts` | Споделено опресняване при SSE със събиране на поредица от събития. |
| `.github/workflows/ci.yml`, `docker-compose.yml` | API/web build; PostgreSQL 16 за API тестове и smoke; локален PostgreSQL. |

Backend е модулен монолит: Express 4 + strict TypeScript + Prisma/PostgreSQL + Zod. Frontend е React 19/Vite/PWA с локално state управление. Не се вижда необходимост от microservices, универсален repository layer, dependency injection container, Redux или замяна на Prisma.

Инвентаризацията обхваща 221 Git blob файла. Изтеглените 216 текстови файла са проверени спрямо Git blob SHA; съдържанието им е запазено. `api/src` е 21 081 реда с тестовете, `web/src` — 20 020 с CSS/тестовете, `api/scripts` — 3 524, `api/prisma` — 5 549. Размерите са контекст, не самостоятелно основание за разделяне.

## A.2. Силни страни — да се запазят

1. **Readiness е централизирана чиста функция.** Не зависи от Express или Prisma; отделя occupancy, cleaning, service, catalog и blocking ticket. [api/src/services/readiness.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/readiness.ts)
2. **Cleaning инвариантите са защитени на няколко нива:** транзакции, `FOR UPDATE`, task version/CAS, cleaning cycle и partial unique индекси за една running session на task/employee и една active task за помещение/дата. [api/src/services/cleaning.ts:109–348](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/cleaning.ts#L109-L348); [api/prisma/migrations/20261006210000_cleaning_atomic_invariants/migration.sql:59–67](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261006210000_cleaning_atomic_invariants/migration.sql#L59-L67)
3. **Data scope и допустимите assignees вече имат общи услуги.** Snapshot-ът на сектор/супервайзър се различава от текущото членство по основателна домейн причина. Те не трябва да се заменят с общо „role === supervisor“. [api/src/services/dataScope.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/dataScope.ts); [api/src/services/assignees.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/assignees.ts)
4. **Ticket lifecycle има добра съществуваща защита:** заключване/CAS, audit/event в транзакцията, commandId fingerprint за lifecycle replay. Последният commit вече решава част от предишните idempotency проблеми. [api/src/services/maintenance.ts:133–249](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/maintenance.ts#L133-L249); [api/prisma/migrations/20261009220000_ticket_event_command_id/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261009220000_ticket_event_command_id/migration.sql)
5. **Сесиите и поканите не разчитат само на JWT role claim.** Active session/DB role, refresh rotation, row locking и атомично redeem са реални защити, които трябва да останат. [api/src/services/authSessions.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/authSessions.ts); [api/src/services/invitations.ts:295–478](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/invitations.ts#L295-L478)
6. **SSE има споделена клиентска връзка и проверка на получателя/scope**, включително обновяване на сесия и scope. Не е необходимо всяка страница да отваря свой stream. [api/src/events/authorizeLiveEvent.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/events/authorizeLiveEvent.ts); [api/src/routes/events.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/routes/events.ts); [web/src/api/liveEvents.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/api/liveEvents.ts)
7. **Attendance вече е разделено** на orchestration, правила и reports. Има стабилна pagination, batch export/лимит, правилно CSV escaping и запазване на adjustment history при rebuild. [api/src/services/attendance.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/attendance.ts); [api/src/services/attendanceRules.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/attendanceRules.ts); [api/src/services/attendanceReports.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/attendanceReports.ts)
8. **Offline данните са partition-нати по userId.** Account switch и logout чистят private store; transient bootstrap failure запазва offline работа; authenticated GET не се кешира от production SW. Това вече е правилно, не е нова задача. [web/src/offline/index.ts:166–246](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/offline/index.ts#L166-L246); [web/src/api/sessionPolicy.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/api/sessionPolicy.ts); [web/vite.config.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/vite.config.ts)
9. **Shifts, issue catalog, cleaning query include, conflict rules и ticket действия вече са отделени.** Използвайте съществуващите граници. [api/src/services/shifts.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/shifts.ts); [api/src/services/issueCatalog.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/issueCatalog.ts); [api/src/services/cleaningTasksQuery.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/cleaningTasksQuery.ts); [web/src/offline/conflict.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/offline/conflict.ts); [web/src/components/TicketLifecycleActions.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/components/TicketLifecycleActions.tsx)
10. **AppliedDataSeed ledger защитава умишлено отнетите grants.** Bootstrap не трябва да попълва всички „липсващи default права“ при всеки restart. [api/src/services/roleGrants.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/roleGrants.ts)
11. **Текущите audit миграции вече копират и проверяват историята преди DROP.** Upgrade smoke в разглеждания CI е успешен. Не се отчита вече поправеният DROP-only код като текущ дефект. [api/prisma/migrations/20261002260000_unified_audit_events/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261002260000_unified_audit_events/migration.sql); [api/prisma/scripts/restore_permission_setting_history.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/scripts/restore_permission_setting_history.sql)

## A.3. Системни слабости

Основният проблем е, че полезните граници не са довършени последователно. Cycle policy е скрита в service, който прави много други неща; REST и sync имат собствени authorization/coercion пътища; query projection и mapper типове могат да се разминат; offline storage/transport/session/retry се събират в един orchestration файл. В няколко React страници домейн формите и lifecycle на заявките се управляват от един общ parent.

Тестовият вход не дава достатъчна защита за тези рискови области. Има добри unit тестове и atomic smoke проверки, но част от тях не достигат до изпълнение, други не се компилират с типовете, а scope smoke не assert-ва проверяваното поведение.

Статичният граф на относителните TS imports не показва backend цикли. На frontend има цикъл `http.ts → offline/index.ts → commands.ts → http.ts`, включващ отложен import от session cleanup. **Това само по себе си не доказва runtime дефект.** То показва обвързването, което R-13 трябва да направи по-ясно; не налага масово пренареждане.

## A.4. Какво действително е проверено

| Проверка | Резултат и ограничение |
|---|---|
| Изходен код | Фиксиран commit; 216/216 изтеглени blob-а са непроменени. |
| API/web зависимости | `npm ci` с lockfile, без lifecycle scripts; Prisma client е генериран успешно. Това не е security audit на dependencies. |
| Production TypeScript | API и web: `tsc --noEmit` успешно. |
| API тестове локално | `node --import tsx --test 'src/**/*.test.ts'`: 128 теста, 126 успешни, 2 неуспешни заради липсващ `DATABASE_URL`. Двата са реални DB integration тестове; не се считат за доказани регресии. |
| Web тестове локално | Същият Node test runner: 34 успешни, 0 неуспешни. |
| Оригиналното `npm test` локално | `tsx` CLI не може да създаде IPC pipe: EPERM в средата. Използван е алтернативният loader по-горе; това не е промяна в проекта. |
| API разширена проверка на типове | Същите compiler options, плюс тестове/scripts/seed: 24 грешки в 4 файла. Разбивката е под таблицата. |
| Web разширена проверка на типове | Същите compiler options, включени тестове: 8 грешки, липсващи `node:assert/strict`/`node:test` типове в 4 test файла. Production компилацията не е засегната. |
| CI за същия SHA | [Run 37982024361](https://github.com/perikliev00/Maintenance/actions/runs/37982024361): API build, web build и audit-upgrade job успешни; Smoke job неуспешен при втория seed. API тестовете преди него са 128/128 успешни. |
| Runtime/БД/браузър | Не е стартирана PostgreSQL инстанция локално, не са изпълнявани atomic smokes локално, няма браузърна UI/IndexedDB/offline проверка или production данни/EXPLAIN. |
| Малки функционални възпроизвеждания | Изолирани date/CSV преобразувания показват UTC/local изместване и неправилен CSV round-trip. Това не е пълен UI тест. |

Разширената API проверка отчита:
- `smoke-daily-plan-atomic.ts`: 6 TS18047 грешки за nullable `room` в closures, редове 718–771.
- `smoke-ticket-lifecycle-idempotency.ts`: 9 TS2339 грешки за `status`/`id` заради тесния inferred lifecycle result тип.
- `attendance.ingest.test.ts`: 5 остарели `hotelDate` свойства в входа на `pairEvents` и 3 TS7022 inferred-any променливи.
- `attendance.stale.test.ts`: 1 TS2345 за `includes("missing_end")` върху inferred `never[]`.

Локалната среда е Node 24.19.0; workflow задава Node 22. Резултатите не се представят като еквивалент на пълно CI изпълнение.

# Част B: Пълен регистър на установените проблеми

Това е пълният регистър **на установеното в описания обхват**, не твърдение, че в непроверените сценарии няма други проблеми. Приоритетът оценява риска и ползата в Maintenance, а не броя редове.

## B.1. Регистър на рефакториранията и необходимата тестова подготовка

### R-01 — Непълен и в момента прекъснат регресионен вход — P1

**Местоположение/състояние:** [.github/workflows/ci.yml](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/.github/workflows/ci.yml); [api/tsconfig.json](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/tsconfig.json); [web/tsconfig.json](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/tsconfig.json); споменатите test/smoke файлове. CI компилира production, API tests се изпълняват в Smoke, но web tests не са включени. Тестовете са изключени от TypeScript build; API scripts/seed са извън `rootDir/src`. Ticket lifecycle idempotency smoke не е включен във workflow.

**Проблем и причина:** успешният build не открива 24 API и 8 web test type грешки. Реалният CI спира при B-01 преди шест atomic smoke проверки. Рефакториране на lock/CAS/offline код без тази защита би било ненужно рисково.

**Решение/файлове:** първо отделна поправка B-01; после `api/tsconfig.tests.json` и `web/tsconfig.tests.json`, test typecheck scripts и подходящи Node типове за web tests; добавяне на web tests и ticket lifecycle smoke в CI. Scope smoke се включва след R-02. SQL partial unique invariants се assert-ват в test DB след `migrate deploy`.

**Полза:** CI действително проверява чувствителните договори. **Риск:** новият gate ще покаже съществуващи проблеми; не бива да се заобикаля с `any`, изключвания или премахване на asserts. **Проверка:** всички jobs достигат до тестовете и smokes; повторен seed в disposable DB; runtime build отделен от test typecheck. **Тип:** тестова/инфраструктурна подготовка, не промяна на бизнес логика. Задачи T-01–T-04.

### R-02 — Част от проверките симулират правилото вместо implementation; fixture coupling — P1 за scope, P2 за изолацията

**Доказателства:** [api/scripts/smoke-data-scope.ts:43–123](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/scripts/smoke-data-scope.ts#L43-L123) отпечатва counts, чужда стая, reassign HTTP резултат и чужди assignees, без asserts за очакваните 403/0. При липса на чужд обект продължава успешно. Преди проверките backfill-ва tasks. [api/src/services/roleGrants.ensure.test.ts:14–45](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/roleGrants.ensure.test.ts#L14-L45) тества локални `wouldReseedMissingDefaults`/`simulateApplyCatalogGrantSeed`, без да извиква реалните bootstrap функции. [api/src/services/attendance.rebuild.test.ts:23–34](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/attendance.rebuild.test.ts#L23-L34) cleanup изтрива всички intervals/adjustments на demo employee, а не само създадените от теста. Smokes използват demo акаунти/първа активна стая и споделена DB.

**Проблем/причина:** diagnostic script може да мине при scope нарушение; копие на алгоритъма може да остане зелено след регресия в production функцията; fixtures променят общи данни и правят резултата зависим от реда на изпълнение.

**Решение/файлове:** assert-based scope fixtures с две контролирани области и реален HTTP server; тест на реалните `ensureDefaultRoleGrants`/`applyCatalogGrantSeed` с test DB или тесен fake на DB boundary; test-only fixture builders в `api/tests/fixtures.ts`, отделни записи/IDs и точен cleanup. Не се създава универсална fixture framework.

**Полза:** проверки на действителните откази и повторяеми тестове. **Риск:** промяна на setup може да скрие съществуващ edge case; всички текущи assertions се запазват или се заменят с еквивалентни върху реалния код. **Проверка:** scope smoke fails при разрешен foreign read/write; revoke→restart не връща grant; два последователни запуска и различен ред на независимите smokes. **Тип:** тестова подготовка. T-03/T-04.

### R-03 — Cleaning cycle е обвързан с целия cleaning orchestration — P1

**Местоположение:** [api/src/services/cleaning.ts:33–348](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/cleaning.ts#L33-L348) и [api/src/services/cleaning.ts:456–1507](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/cleaning.ts#L456-L1507); [api/src/services/dailyPlanEffects.ts:13–17](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/dailyPlanEffects.ts#L13-L17).

**Състояние:** един модул определя service type/cycle, прави lock/CAS и unique-conflict mapping, изпълнява create/start/complete/cancel/inspect/reassign, overdue query, room dirty, audit, publish и notifications. Daily plan imports low-level cycle helpers от същия lifecycle service.

**Проблем/причина:** cycle има самостоятелна отговорност и два потребителя, но е скрит зад module с множество side effects. Промяна на generation policy изисква навигация през commands, notification и DTO код. Това е реална граница на отговорности, не аргумент „1507 реда е много“.

**Решение/файлове:** първо `cleaningCycle.ts` за cycle/location locking и service type policy; запазени exports през `cleaning.ts`. След това, само по домейн граници: `cleaningSessions.ts` за start/complete/cancel и `cleaningNotifications.ts` за съществуващите notification payload builders. Task create/reassign/inspection могат да останат във façade, докато отделянето носи доказана полза. Няма generic state-machine engine.

**Полза:** cycle се използва директно от daily plan и се проверява независимо; commands остават четими. **Риск:** най-чувствителното разделяне — ред на locks, transaction client, idempotent replay и soft cycle guard. При stale session сегашният complete/cancel може да приключи старата работа, без да презапише по-новия room cycle; не трябва да се превърне автоматично в reject.

**Проверка:** cleaning cycle/conflict unit tests и atomic smoke; start/start, complete/cancel, reassign/start races; една session/task/employee; future cycle=0; stale completion пази newer room state; audit count и DTO равенство. **Тип:** чисто рефакториране. T-07–T-09.

### R-04 — Maintenance lifecycle смесва заявки, чисти SLA правила и event presentation — P2

**Местоположение:** [api/src/services/maintenance.ts:45–249](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/maintenance.ts#L45-L249), [api/src/services/maintenance.ts:251–360](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/maintenance.ts#L251-L360), [api/src/services/maintenance.ts:1031–1108](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/maintenance.ts#L1031-L1108).

**Състояние:** lifecycle commands, relation includes/formatting/list queries, SLA pause/unpause, replay fingerprint, audit summary/action mapping и notification payload-и са в един модул. Тесният inferred replay result вече води до type errors при smoke callers.

**Проблем/причина:** четенето/DTO, чистата pause arithmetic и transactional commands имат различни причини за промяна. Event kind се преобразува на няколко места; типът на public lifecycle резултата не описва надеждно реалния ticket.

**Решение/файлове:** `maintenanceQueries.ts` за includes/mapper/list; `maintenancePolicy.ts` за pause/unpause и fingerprint; `maintenanceEvents.ts` за съществуващото event/audit mapping. `maintenance.ts` остава façade и явни lifecycle guards. Да се зададе реален typed ticket response, не `as any`.

**Полза:** проверими pure функции и един източник на DTO. **Риск:** `Date/now` timing, nullable поля, legacy event payload без fingerprint, replay side effects, category snapshot. **Проверка:** exact lifecycle replay, changed actor/entity/payload rejection, concurrent retry, one event/audit, wait/resume SLA pause arithmetic, list ordering/filters. **Тип:** чисто рефакториране. T-01/T-10/T-11.

### R-05 — REST и sync повтарят authorization, scope и command adaptation — P1

**Местоположение:** [api/src/routes/cleaning.ts:92–124](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/routes/cleaning.ts#L92-L124), [api/src/routes/cleaning.ts:212–240](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/routes/cleaning.ts#L212-L240); [api/src/routes/maintenance.ts:41–49](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/routes/maintenance.ts#L41-L49) и [api/src/routes/maintenance.ts:429–550](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/routes/maintenance.ts#L429-L550); [api/src/services/sync.ts:120–319](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/sync.ts#L120-L319).

**Състояние:** два входа към същите услуги проверяват actions/scope, изграждат actor input и конфликти поотделно. Sync command има `type: string`/`Record<string, unknown>`; употребява `String`, `Boolean` и enum casts. Direct REST има Zod схеми. Cleaning conflict snapshot formatting е повторен в sync и cleaning.

**Проблем/причина:** трябва да се поддържа едно правило в два transport-а; B-02 вече доказва разминаване на bypass flags. Cast не доказва, че стойността е валидна. Масово прилагане на REST Zod към sync обаче би променило текущите приемани payload-и и error договори.

**Решение/файлове:** малки `cleaningCommandAccess.ts`/`maintenanceCommandAccess.ts` с actions, scope, actor-context; `cleaningConflict.ts` за snapshot; typed internal discriminated union `syncCommands.ts` и отделни transport adapters. Първото извличане запазва REST/sync различията явно. Еднаквата bypass политика идва само с отделна F-02. Validation tightening е отделна функционална промяна.

**Полза:** ясна authorization граница и проверими входове. **Риск:** ред на 400/403/404/409, expired user grant, scope snapshot и mutation между commands в batch. Да не се кешира scope през целия batch без доказателство. **Проверка:** role/action/scope матрица за двата transport-а, exact errors/details, malformed/legacy queue payload-и, same command replay. **Тип:** чисто рефакториране с изрично запазени различия. T-05/T-06.

### R-06 — Audit API има две несъвместими позиционни форми — P2

**Доказателство:** [api/src/services/audit.ts:25–82](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/audit.ts#L25-L82). `recordAudit(tx, input)` и `recordAudit(input, tx)` се различават чрез runtime проверка `"auditEvent" in value`; вторият argument е optional дори когато първият е DB client. Следва cast към input. Същото важи за `recordAuditMany`.

**Проблем/причина:** TypeScript допуска непълен/объркан call и не доказва кой client е използван; това е особено важно за transaction rollback.

**Решение/файлове:** една signature `recordAudit(input, db = prisma)` и аналогична за many; актуализиране на всички callers в services. JSON сериализацията остава със същите правила за `undefined/null`. Не се премества audit извън/вътре в transaction като част от signature промяната.

**Полза:** compiler защита и видима transaction boundary. **Риск:** случайно заменяне на `tx` с singleton; промяна на trim/JsonNull. **Проверка:** payload fixtures, empty many, null/undefined и injected audit failure води до същия rollback, където audit вече е вътре в транзакцията. **Тип:** чисто рефакториране. T-12.

### R-07 — People route съдържа business/data orchestration — P2

**Местоположение:** [api/src/routes/people.ts:13–219](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/routes/people.ts#L13-L219).

**Състояние:** controller има два person mapper-а, изгражда Prisma filters, проверява target/privileged/last owner, променя ролята и revoke-ва сесии.

**Проблем/причина:** домейн операцията е достъпна само през HTTP handler и трудно се проверява без Express; различните mapper-и повтарят полета на един Person договор.

**Решение/файлове:** нов `api/src/services/people.ts` с `listPeople`/`changePersonRole` и малки typed mapper-и; route остава validation/context/response. Last-owner проверката, grant/scope и моментът на session revoke се запазват. Въвеждане на нова транзакция за H-01/H-02 е отделна промяна.

**Полза:** лесни unit/DB проверки на ограниченията, по-тънък controller. **Риск:** null user за неonboardнат employee, target id срещу employee id, собствена демоция и текущите грешки. **Проверка:** всички role assignment случаи, inactive/notOnboarded/search filters, last owner rejection, session revocation. **Тип:** чисто рефакториране. T-13.

### R-08 — Maintenance HTTP модул смесва catalog CRUD и ticket lifecycle — P2

**Местоположение:** [api/src/routes/maintenance.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/routes/maintenance.ts). Catalog categories/options имат различни `issue_options.manage`/`tickets.report` guards и собствен CRUD от ticket commands.

**Проблем/причина:** независимите catalog и lifecycle договори изискват промени в един route модул. Повтаряните try/catch-to-next блокове правят route mapping-а по-труден за преглед, въпреки че `asyncHandler` вече съществува.

**Решение/файлове:** нов `routes/maintenanceCatalog.ts`, mount под същия `/maintenance` prefix; ticket route остава в `maintenance.ts`. Поетапно използване на съществуващия `asyncHandler` в засегнатите routes; никаква универсална CRUD/validation framework.

**Полза:** независими route договори и по-малко boilerplate. **Риск:** mount order, `/:id` match, validation error различия — `invalid_input` и `validation` не се уеднаквяват автоматично. **Проверка:** HTTP snapshot на methods/paths/status/body, права за list inactive/reorder/archive и forwarding към error middleware. **Тип:** чисто рефакториране. T-14.

### R-09 — Daily-plan повтаря fill-assignee/shift и priority patch — P2

**Доказателство:** [api/src/services/dailyPlanEffects.ts:214–280](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/dailyPlanEffects.ts#L214-L280) и [api/src/services/dailyPlanEffects.ts:425–590](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/dailyPlanEffects.ts#L425-L590). Две локални `connectAssigneeAndShift` функции и няколко еднакви priority/fill/update branches.

**Проблем/причина:** една промяна на „попълни само празен assignee/shift“ или „не понижавай priority“ трябва да се приложи на няколко места, включително deferred departure.

**Решение/файлове:** локална pure helper за task patch и флаг „priority increased“, ползвана в съществуващите branch-ове. Не се сливат whole plan create и manual cleaning create: техните audit/summary/error семантики са различни.

**Полза:** един източник на малкото общо правило. **Риск:** urgent→high downgrade, презаписан assignee/shift, changed `created/linked/bumped/skipped` резултат. **Проверка:** празни/попълнени комбинации, priority матрица, future/deferred/confirmed/protected departure и повторно прилагане. **Тип:** чисто рефакториране. T-15.

### R-10 — Location projection и mapper типове не гарантират съвместимост — P2

**Доказателство:** [api/src/services/locations.ts:20–139](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/locations.ts#L20-L139); [api/src/services/cleaning.ts:1436–1471](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/cleaning.ts#L1436-L1471). Съществува shared `locationInclude`, но mark-dirty дублира include с различен ticket filter и без sector. `LocationForMap` описва status enum-и като string, а `mapLocation` ги cast-ва с `any`.

**Проблем/причина:** query и DTO могат да се разминават без compiler error; B-03 вече е конкретен пример. Optional relation типове допускат silent omission.

**Решение/файлове:** typed Prisma include fragments и `GetPayload` или точен минимален projection type с действителните enum-и; ясно именувани projection profiles за list/mutation/minimal, без автоматично уеднаквяване на различните отговори. `cleaningTasksQuery.ts` остава съществуващият собственик на task include.

**Полза:** enum/type и relation drift става видим при компилация. **Риск:** добавени/липсващи response полета, сортировка/`take`, променено readiness. B-03 се поправя отделно или текущото различие остава изрично named profile. **Проверка:** serialized DTO fixtures за list/detail/dirty и null sector, all open statuses, task/session/inspection ordering. **Тип:** чисто рефакториране; B-03 е отделен дефект. T-16.


### R-11 — Analytics използва чисти метрики от DB-oriented cleaningResults — P2

**Местоположение:** [api/src/services/cleaningResults.ts:76–150](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/cleaningResults.ts#L76-L150); [api/src/services/analytics.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/analytics.ts).

**Състояние:** shared anomaly/duration/valid-minutes helpers са export-нати от module, който едновременно прави тежките results queries и aggregation. Analytics го imports за тези pure правила и съчетава Prisma заявки с in-memory counters/percentiles/forecast.

**Проблем/причина:** зависимостта не отразява общата отговорност „правила за cleaning метрики“; pure тестовете влизат през DB service. Промяна на правило за anomaly трябва да се вижда като споделена политика.

**Решение/файлове:** `cleaningMetrics.ts` за съществуващите pure helpers; temporary re-exports през `cleaningResults.ts`. Последващо отделяне на pure aggregation функции е допустимо само за действително използваните input/output структури; няма нов reporting framework или SQL rewrite.

**Полза:** изолирани metric tests и видима обща дефиниция. **Риск:** period boundaries, null/minute rounding, task срещу session denominator, assignee attribution, excluded anomalous minutes. **Проверка:** текущите cleaningResults тестове, фиксирани analytic fixtures с completed/awaiting_inspection/rework и same before/after JSON. Няма доказана performance печалба без измерване. **Тип:** чисто рефакториране. T-17.

### R-12 — Jobs повтаря управление на run status около различни алгоритми — P2

**Местоположение:** [api/src/services/jobs.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/jobs.ts).

**Състояние:** `createRun`/`finishRun` са общи, но всяка job повтаря start/success/catch/failure plumbing. В същия файл стоят inactive-user policy, overdue detection, SLA scanning, attendance job и scheduler.

**Проблем/причина:** metadata/error lifecycle и домейн scanning са различни отговорности; повторението затруднява съгласуваните JobRun резултати. Добрата `claimInactiveUserLock` защита не се нуждае от промяна.

**Решение/файлове:** малка `runRecordedJob` функция в `jobRun.ts`, извиквана от съществуващите jobs; scheduler в `jobScheduler.ts` със façade exports. Алгоритмите могат да останат в `jobs.ts`. Не се въвежда Redis/Bull/distributed queue.

**Полза:** един lifecycle за JobRun и по-лесни timer tests. **Риск:** променен summary при disabled/error, swallowed errors, order на четирите jobs и timing. Отстраняването на B-08 е отделна промяна. **Проверка:** success/disabled/failure фиксирани резултати, existing lockInactive tests, dedupe notifications, същият initial delay и interval. **Тип:** чисто рефакториране. T-18.

### R-13 — Offline outbox събира storage, session ownership, transport и retry engine — P1

**Местоположение:** [web/src/offline/index.ts:60–430](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/offline/index.ts#L60-L430), [web/src/offline/index.ts:433–618](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/offline/index.ts#L433-L618), [web/src/offline/index.ts:618–900](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/offline/index.ts#L618-L900); [web/src/api/http.ts:71–121](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/api/http.ts#L71-L121).

**Състояние:** 900-редовият модул има глобално mutable owner/lock/draining/reachability/backoff state, account switch chain, queue APIs/cache, fetch timeout/auth retry, batch push, per-item fallback, retry/conflict transitions и command wrappers. Storage и pure conflict rules вече са изнесени. Refresh single-flight вече е споделен в `http.ts`.

**Проблем/причина:** за тест на drain трябва да се контролира и session switch, HTTP, timers, IndexedDB и UI subscriptions. Runtime safety зависи от един собственик на globals; без ясна boundary случайно разделяне може да създаде два drain-а или достъп до чужда queue. Има два error parsing пътя: общият `parseJson` и offline transport, който има нужда от server code/details.

**Решение/файлове:** стъпка 1 `offline/transport.ts` за timeout/post/batch с текущия shared auth retry; стъпка 2 `offline/queueEngine.ts` за drain/recovery/transition и тесни аргументи към storage/transport; `index.ts` остава public façade и един runtime owner. Session partition може да остане там до доказана нужда от допълнителен модул. Error decoder се споделя само ако запазва различните public error shapes.

**Полза:** deterministic engine tests без реална мрежа, ясни side-effect граници. **Риск:** най-висок frontend regression риск — replay/duplicate, user switch mid-flight, logout purge, 401 transient срещу auth reject, batch Missing fallback, 403/409 semantics, orphaned sending и retry max=8/backoff. Не се променят IndexedDB version/keys или command format.

**Проверка:** fake transport и IndexedDB fixtures; sending→recovery; 401→single refresh→retry with fresh headers; request timeout; unreachable retry; switch A→B докато A drain чака; B не получава/cache-ва A; batch и direct fallback truth table. **Тип:** чисто рефакториране. T-19–T-21.

### R-14 — API client остава общ container за несвързани домейни — P2

**Местоположение:** [web/src/api/client.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/api/client.ts), 1674 реда.

**Състояние:** HTTP/capabilities/cleaning/maintenance/SSE вече са отделени, но client съдържа location/person/invitation/attendance/card/plan/settings/permissions/sector/shift/analytics/notification типове и requests, device fingerprint и mutable hotel timezone cache.

**Проблем/причина:** всяка домейн промяна минава през един container; типа и API ownership са неясни. Това продължава започнатото реално разделяне, без да създава нов слой.

**Решение/файлове:** typed `locationsApi.ts`, `peopleApi.ts`, `attendanceApi.ts`, `cardsApi.ts`, `dailyPlanApi.ts`, `settingsApi.ts`, `permissionsApi.ts`, `sectorsApi.ts`, `shiftsApi.ts`, `analyticsApi.ts`, `notificationsApi.ts`; exports през същия client barrel. Hotel timezone cache има точно един собственик — `hotelDate.ts`, обновяван от `fetchPublicSettings`; device fingerprint остава при invitation/device functions.

**Полза:** домейн типовете могат да се imports-ват пряко; по-малко конфликти при независима работа. **Риск:** import cycles, URL/query параметри, credentials/CSRF headers, public fetch изключения и reset на timezone cache. **Проверка:** request fixtures проверяват method/URL/body/headers; production build; timezone се обновява след public settings; всички legacy exports работят. Няма очаквана bundle-size печалба само от това. **Тип:** чисто рефакториране. T-22–T-24.

### R-15 — My Work cache губи домейн типовете на границата — P2

**Доказателство:** [web/src/offline/storage.ts:30–38](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/offline/storage.ts#L30-L38) описва `tasks/tickets: unknown[]`; [web/src/pages/MyWorkPage.tsx:177–189](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/MyWorkPage.tsx#L177-L189) ги casts като `CleaningTaskRow[]`/`MaintenanceTicket[]`.

**Проблем/причина:** producer и consumer не се проверяват един спрямо друг; променен DTO може да остане незабелязан при online build и да счупи само offline render.

**Решение/файлове:** точни cache DTO types, type-only imports от домейн API модули, `unknown` само в read boundary на IndexedDB. За съществуващ v2 cache се добавя минимално доказване на shape/fixture test; отхвърлянето на по-стари payload-и е отделна промяна, ако днес те се приемат. Не се добавя ненужна DB migration.

**Полза:** compile-time съгласуваност и проверимо offline payload. **Риск:** rejecting working legacy cache или runtime import cycle. **Проверка:** current v2 fixture round-trip, null/empty/legacy поля, cache recovery след network failure и owner isolation. **Тип:** чисто рефакториране на типовете; по-строга runtime validation се отделя. T-25.

### R-16 — MyWork/Repairs дублират connection status и subscriptions — P2

**Доказателство:** [web/src/pages/MyWorkPage.tsx:62–85](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/MyWorkPage.tsx#L62-L85) и [web/src/pages/RepairsPage.tsx:46–69](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/RepairsPage.tsx#L46-L69) имат еднакви `connClass`/`connLabel`; двете страници държат `ConnMode/QueueStats` и `subscribeOffline` lifecycle.

**Проблем/причина:** UI states за pending/sending/unreachable и локализацията им трябва да се променят два пъти; listener cleanup/initial stats лесно се разминават.

**Решение/файлове:** `hooks/useOfflineStatus.ts` за status/stats subscription; `components/ConnectionStatus.tsx` за съществуващия markup/labels. Page-specific refresh и cache fallback остават в страниците. Не се уеднаквява всяко online/offline поведение.

**Полза:** еднакъв индикатор и един subscription lifecycle. **Риск:** notification order, stale closure на page refresh, изчезнал initial queue count. **Проверка:** mount/unmount/StrictMode, всички connection modes, zero/pending/sending counts, същите BG/EN labels и класове. **Тип:** чисто рефакториране. T-26.

### R-17 — Locations page управлява няколко независими workflow-а — P2

**Местоположение:** [web/src/pages/LocationsPage.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/LocationsPage.tsx); съществуващи `LocationHistoryPanel`/`LocationIssueDialog`.

**Състояние:** в един page са room/common list+overdue fetch, cleaning actions, issue form/catalog loading, occupancy/service changes и audit detail drawer. List bootstrap/refresh частично повтарят заявки; drawer има собствен правилен cancellation guard.

**Проблем/причина:** множество независими form/error/loading states са събрани в един parent; повторен fetch flow и side effects затрудняват проверката на една операция.

**Решение/файлове:** `hooks/useLocationsData.ts` за една list-loading функция с запазени callers; `hooks/useLocationIssueDraft.ts` за draft/reset/select logic; `LocationDetailDrawer.tsx` за drawer lifecycle, използвайки текущия panel. Commands се подават явно; не се създава общ „location controller“ със скрити права.

**Полза:** изолирани lifecycle и data tests. **Риск:** selected drawer се затваря/нулира по-рано, промяна на busy/error scope, common/room API избор, direct issue reporting срещу queued reporting. **Проверка:** room/common варианти, всички cleaning transitions, issue option/custom defaults, drawer fetch A→B cancellation, mutation refresh, identical controls/labels. **Тип:** чисто рефакториране. T-27.

### R-18 — Repairs page съчетава list, report form и event detail lifecycle — P2

**Местоположение:** [web/src/pages/RepairsPage.tsx:71–245](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/RepairsPage.tsx#L71-L245); [web/src/pages/HomePage.tsx:37–52](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/HomePage.tsx#L37-L52).

**Състояние:** parent държи ticket filter/list, category/option/people lookups, report draft, selected ticket history и offline indicator. TicketLifecycleActions вече е добре отделен. Изборът на issue option повтаря настройването на title/priority/blocksRoom във Home/Locations.

**Проблем/причина:** report form state и ticket detail loading имат различен lifecycle от list; repeated option-to-draft правила могат да drift-нат.

**Решение/файлове:** `RepairReportForm.tsx` с explicit submit callback, `hooks/useTicketEvents.ts` за текущия detail flow, малка pure option→draft функция само за общите полета. Първо се запазват различията option/custom, direct/queue submit и form reset. B-09 за stale responses се поправя отделно.

**Полза:** form и history се проверяват независимо, reused lifecycle component се запазва. **Риск:** commandId се генерира повторно при retry, draft се губи при list refresh, offline success се показва като server success. **Проверка:** option/custom reporting, queued/offline резултат, draft persistence, selected history и duplicate-click busy guard. **Тип:** чисто рефакториране. T-28.

### R-19 — Housekeeping parent държи state на отделени Sector/Shift панели — P2

**Местоположение:** [web/src/pages/HousekeepingPage.tsx:45–153](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/HousekeepingPage.tsx#L45-L153); [web/src/components/SectorPanel.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/components/SectorPanel.tsx); [web/src/components/ShiftPanel.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/components/ShiftPanel.tsx).

**Състояние:** presentation е отделена, но sector edit/selection/filter, shift edit и roster drafts са всички в page и се подават като голям набор props/callbacks. Общият refresh fetch-ва четири домейна с Promise.all.

**Проблем/причина:** границата е само визуална; промяна на sector form все още засяга parent, който управлява roster/QR/catalog. Form ownership и reset rules са разпръснати.

**Решение/файлове:** последователно `useSectorForm.ts` и `useShiftRoster.ts`, или state в съответните mounted панели с explicit data/actions. Общият lookup snapshot/refresh остава в parent на първата стъпка. Не се прави lazy fetch само за активен tab като скрита функционална промяна.

**Полза:** по-малко prop drilling и самостоятелно form тестване. **Риск:** tab switch губи draft, roster date/reset и cross-sector permission check. **Проверка:** create/edit/active toggles/sector members, cancel/reset, tabs preserve draft, roster save с exact input. B-10 за permission-coupled fetch е отделна задача. **Тип:** чисто рефакториране. T-29/T-30.

## B.2. Отделен регистър на функционалните дефекти

Тези точки **не са част от чистото рефакториране**. Приоритетът им не означава разрешение да се промени бизнес логика по време на T задачите.

### B-01 — Повторният destructive demo seed нарушава Notification FK — P1, наблюдавано в CI

**Местоположение:** [api/prisma/seed.ts:31–64](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/seed.ts#L31-L64); [api/prisma/schema.prisma](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/schema.prisma); [Smoke job](https://github.com/perikliev00/Maintenance/actions/runs/37982024361/job/113994647053).

Reset-ът не изтрива `Notification/NotificationDelivery` преди `employee.deleteMany`. Seed и integration tests използват attendance services, които създават notifications. Вторият seed в CI получава P2003 `Notification_recipientEmployeeId_fkey` на ред 60; шестте последващи smokes се пропускат.

**Поправка:** reset на зависимите notification записи в точния FK ред, в disposable dev/test DB; ревизия на catch-и, които скриват cleanup failure. Не се добавя автоматично production reset. **Полза:** възстановен CI regression gate. **Риск:** разрушително изтриване при грешен DB URL; съществуващият seed вече е destructive. **Проверка:** migrate→seed→API tests→seed→всички smokes в отделна DB; ledger/grants setup остава правилен. **Задача:** F-01, необходимо предварително условие.

### B-02 — Една и съща команда има различен assignee bypass в REST/sync — P1, статично потвърдено

**Местоположение:** доказателствата за R-05.

| Команда | Direct REST | Sync service |
|---|---|---|
| Cleaning start | `bypassAssigneeCheck: isOwner(role)` | flag не се подава |
| Cleaning complete | `bypassSessionOwnerCheck: isOwner(role)` | flag не се подава |
| Ticket start/wait/resume/resolve | bypass за owner/supervisor/manager/admin/reception | flag не се подава |

User, който може да изпълни direct операция върху чужд assignee по current REST policy, може да получи отказ, когато queue мине през `/sync/push`. Direct fallback може да даде различен резултат от batch.

**Поправка:** потвърдена единна transport-независима policy и еднакъв actor context; не се разширяват права „за удобство“. **Риск:** да се разреши действие на грешна роля/scope. **Проверка:** всички роли, grant on/off, own/foreign assignee, owner cleaning и current ticket bypass роли; same status/body при equivalent command. **Задача:** F-02, отделно от extraction T-05/T-06.

### B-03 — Mark-dirty response има различна location projection — P2, статично потвърдено

**Местоположение:** [api/src/services/cleaning.ts:1436–1471](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/cleaning.ts#L1436-L1471) срещу [api/src/services/locations.ts:20–55](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/locations.ts#L20-L55).

Mark-dirty включва blocking tickets само със status `new/in_progress` и пропуска sector membership. Общият location projection включва още `assigned/waiting` и sector. Mapper получава частично relation съдържание: sector става null, а blocking ticket count/list е непълен.

**Поправка:** общата projection или изрично правилният mutation profile; това променя response полета и е отделен commit. Dirty readiness може все пак да остане „not ready“, затова не се твърди, че тази мутация задължително прави стаята falsely ready. **Риск:** UI assumptions за sector/null и ticket list. **Проверка:** dirty response срещу subsequent GET за active sector и всеки open blocking status. **Задача:** F-03.

### B-04 — UTC стойност се попълва като local datetime и се изпраща с изместен instant — P2, изолирано възпроизведено

**Местоположение:** [web/src/pages/CardsPage.tsx:34–47](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/CardsPage.tsx#L34-L47); [web/src/pages/AttendancePage.tsx:167–174](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/AttendancePage.tsx#L167-L174) и [web/src/pages/AttendancePage.tsx:340–348](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/AttendancePage.tsx#L340-L348).

`toISOString().slice(0,16)`/`endedAt.slice(0,16)` дава UTC clock string за `datetime-local`; `new Date(value).toISOString()` го тълкува като browser local. При `TZ=Europe/Sofia` и instant `2026-10-10T12:00:00Z` unchanged field `2026-10-10T12:00` се изпраща като `09:00Z` — минус три часа.

**Поправка:** explicit instant↔browser-local conversion; ако договорът е hotel-local, това първо се уточнява и се използва хотелската зона. **Полза:** без тихо изместване на card validity/attendance correction. **Риск:** DST ambiguous/nonexistent times и минути/секунди. **Проверка:** UTC/Sofia друга browser zone, зимно/лятно време, unchanged round-trip и DST boundaries. **Задача:** F-04. Не се променят backend date-only семантиките.

### B-05 — Initial theme application създава „потребителско предпочитание“ преди settings — P2, статично потвърдено

**Местоположение:** [web/src/main.tsx:5–9](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/main.tsx#L5-L9); [web/src/theme.ts:5–16](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/theme.ts#L5-L16); [web/src/App.tsx:256–275](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/App.tsx#L256-L275).

`applyTheme(getStoredTheme())` записва localStorage `theme` още преди mount. След това `hasUserThemePreference()` винаги е true дори за нов browser. `publicSettings.interface.defaultTheme` не се прилага по intended „ако няма предпочитание“ път; App effect също persist-ва initial theme.

**Поправка:** отделяне на apply-to-DOM от persist-user-choice; да не се записва default като explicit choice. **Риск:** flash/theme change и съществуващо explicit preference. **Проверка:** empty storage/default light, existing light/dark, toggle persist и reload, settings refresh. **Задача:** F-05.

### B-06 — Invitation credential се изпраща към външен QR provider — P1, статично потвърден data flow

**Местоположение:** [web/src/pages/TeamPage.tsx:24–26](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/TeamPage.tsx#L24-L26) и [web/src/pages/TeamPage.tsx:423–430](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/TeamPage.tsx#L423-L430); [api/src/services/invitations.ts:242–250](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/invitations.ts#L242-L250) и [api/src/services/invitations.ts:402–442](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/invitations.ts#L402-L442).

Invitation `qrPayload` съдържа activation URL с `code`. QR image `src` изпраща целия payload като `data` към `api.qrserver.com`. При вече активиран user redeem branch не изисква нов password; code е bearer credential за onboarding на устройство/сесия. Не са наблюдавани network traffic, злоупотреба или production deployment.

**Поправка:** локално QR генериране със същия payload и видим размер. Това е security correction с промяна на dependency/network behavior, не чисто разделяне на файл. Room QR token има друга identify-only семантика; не се приравнява на invitation credential. **Риск:** unreadable QR или различен encoded URL. **Проверка:** decode generated QR=exact issued payload, activation flow, няма external QR request. **Задача:** F-06.

### B-07 — Analytics risk CSV използва JSON escaping — P2, изолирано възпроизведено

**Местоположение:** [web/src/pages/AnalyticsPage.tsx:105–130](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/AnalyticsPage.tsx#L105-L130).

`JSON.stringify(label)` е JSON representation, не CSV escaping: embedded quotes се записват като backslash+quote, вместо двойни quotes. Изолираният пример `Стая "VIP", 101` се прочита като 4 колони вместо 3; label не round-trip-ва. Room/catalog inputs допускат такива символи.

**Поправка:** малка frontend CSV escaping функция по същото правило като проверения attendance exporter. Не се добавя generic export framework. **Риск:** delimiter/newline/BOM/file naming договор. **Проверка:** comma/quote/newline/кирилица, exactly 3 columns и ordinary output. **Задача:** F-07.

### B-08 — Stop scheduler не отменя initial timeout — P2, статично потвърдено

**Местоположение:** [api/src/services/jobs.ts:499–523](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/jobs.ts#L499-L523).

`startJobScheduler` създава `setTimeout(15_000)` без запазен handle. `stopJobScheduler` чисти само interval. Stop преди 15 секунди не отменя initial job run; start→stop→start може да остави повече от един initial trigger.

**Поправка:** tracked initial timer и stop на двата timers; ясно lifecycle състояние. **Риск:** пропуснат първи run/двойно стартиране. **Проверка:** fake clock: stop-before-initial, repeated start, restart, exact interval runs. **Задача:** F-08, отделно от T-18.

### B-09 — Стар async резултат може да презапише нов filter/detail state — P2, статично доказан race път

**Местоположение:** [web/src/pages/AttendancePage.tsx:74–129](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/AttendancePage.tsx#L74-L129); [web/src/pages/AnalyticsPage.tsx:189–218](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/AnalyticsPage.tsx#L189-L218); `ResultsPage.refresh`, `PlanPage.refresh` и `RepairsPage` event loading.

Effect cleanup пази catch/finally, но `refresh` сам извиква `setData/setIntervals` след await без cancelled/sequence guard. Заявка A за стар filter може да завърши след B и да показва A под B филтъра; attendance loadMore може да append-не стара page след промяна на query. Сценарият не е възпроизведен в браузър.

**Поправка:** per-query sequence/abort guard, включително pagination, explicit loading/error owner. Съществуващият Locations drawer има правилна защита и може да служи за ориентир; не се въвежда library само за това. **Риск:** пропуснат legitimate SSE refresh или оставен loading. **Проверка:** deferred A/B promises resolved B→A, query switch по време на loadMore, unmount и SSE refresh. **Задача:** F-09 — поведението се подобрява в отделен PR.

### B-10 — UI authorization и composite loading не следват DB actions последователно — P2, статично потвърдено

**Местоположение:** [web/src/api/capabilities.ts:198–225](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/api/capabilities.ts#L198-L225); `HomePage.canResolve`, `RepairsPage.canResolve/canAssign/canClose`, `ControlPage`; [web/src/pages/HousekeepingPage.tsx:86–112](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/HousekeepingPage.tsx#L86-L112).

Някои controls използват role-only helpers вместо `canPerformAction(user, action)`, въпреки че AuthUser има DB actions. При отнето action UI може да показва операция; при добавено action на друга роля може да я скрие. Housekeeping прави unconditional Promise.all на sector/shift/rooms/people; отказ на едно независимо право прекъсва целия refresh. Това са две прояви на частично приложен capability договор.

**Поправка:** capability-aware visibility и независимо permission-aware зареждане на ресурсите; legacy role fallback се запазва само при липсващ actions snapshot. **Риск:** grants/panels/module flags не са взаимозаменяеми; non-owner role assignment ограничения остават в backend. **Проверка:** revoked/default/custom grants, panel allowed/action denied, sectors allowed/shifts denied/people denied, owner и legacy offline user. **Задачи:** F-10a/F-10b. Не се включва в T-29/T-30.

## B.3. Рискове и несигурности, които не се обявяват за доказани production дефекти

| ID | Доказан кодов път / неизвестното | Следваща конкретна проверка |
|---|---|---|
| H-01 | `requestAdjustment` създава adjustment, сменя interval status и записва audit в отделни calls; review commit и audit/notification са отделени. SLA upsert→audit и device revoke→session revoke също са отделни. При injected failure е възможна частична операция; не е проверен очакваният failure contract. [api/src/services/attendance.ts:598–650](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/attendance.ts#L598-L650); [api/src/services/attendance.ts:684–781](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/attendance.ts#L684-L781); [api/src/services/slaPolicies.ts:24–60](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/slaPolicies.ts#L24-L60); [api/src/services/invitations.ts:507–524](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/invitations.ts#L507-L524) | DB fault injection на всяка граница; решете дали audit/session consistency е задължително атомична. Ако да — отделен bug-fix PR с transactions. Не се местят boundaries в чистото рефакториране. |
| H-02 | Last-owner count→role update и role update→revoke в `people.ts` са отделени. Две конкурентни демоции могат да минат през стари counts; няма локално concurrency reproduction. [api/src/routes/people.ts:179–212](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/routes/people.ts#L179-L212) | DB race test с два owners и barrier; изясняване на „поне един owner“ гаранцията. Ако тестът потвърди — отделна atomic correction. |
| H-03 | Cleaning/ticket mutations commit-ват преди awaited notifications. Delivery failure може да върне HTTP error след успешна основна промяна; не е наблюдавана такава авария. [api/src/services/cleaning.ts:562–581](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/cleaning.ts#L562-L581); [api/src/services/maintenance.ts:471–493](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/maintenance.ts#L471-L493) | Inject notification failure, retry същия commandId, проверка на DB+response/audit count. Решение за error semantics; не се предлага outbox като задължително рефакториране. |
| H-04 | Create/cleaning replay lookup е по commandId, без lifecycle fingerprint като ticket lifecycle; reuse на UUID с различен payload/actor/entity може да върне първия result. [api/src/services/cleaning.ts:583–620](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/cleaning.ts#L583-L620); [api/src/services/maintenance.ts:362–388](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/maintenance.ts#L362-L388) | HTTP/sync tests с еднакъв ID и различен input; уточняване на commandId binding договора. Reject вместо replay е функционална промяна. |
| H-05 | Attendance rebuild за различни events на един employee и daily-plan newer-stay evidence при конкурентно occupancy update имат потенциален stale-read/serialization риск. Unique constraints и transactions сами не доказват всички race interleavings. [api/src/services/attendance.ts:297–448](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/attendance.ts#L297-L448); [api/src/services/dailyPlanEffects.ts:311–424](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/dailyPlanEffects.ts#L311-L424) | Barrier-controlled PostgreSQL concurrency tests: две late events, adjustment freeze, check-in срещу deferred checkout. Не се добавят locks само по предположение. |
| H-06 | Jobs, grants cache и event bus са process-local; няма потвърден deployment с няколко API replicas. [api/src/events/bus.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/events/bus.ts); [api/src/services/jobs.ts:499–523](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/jobs.ts#L499-L523); [api/src/services/roleGrants.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/roleGrants.ts) | Deployment inventory и измерване на duplicate jobs/cache propagation/SSE при >1 instance. Redis/distributed queue са бъдещо архитектурно решение само при доказана нужда. |
| H-07 | `fetchCleaningTasks({mine:true})` изпраща `mine=1`, но cleaning list route не обработва този параметър. MyWork използва task/ticket lists вместо `fetchMyWork`, който има hotelDate/roster логика. HK scope ограничава задачите; owner/supervisor семантиката „мои“ не е уточнена. [web/src/pages/MyWorkPage.tsx:109–124](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/MyWorkPage.tsx#L109-L124); [web/src/api/cleaningApi.ts:5–27](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/api/cleaningApi.ts#L5-L27); [api/src/routes/cleaning.ts:32–52](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/routes/cleaning.ts#L32-L52); [api/src/services/myWork.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/myWork.ts) | Product acceptance case за owner/supervisor и shift filter. Замяна на endpoint е функционална промяна, не extraction. |
| H-08 | API package expose-ва `db:push`, а partial uniques са SQL migration-only. Не е установено използване на db push за production. Историческите audit deployments могат да имат checksum/history от стара версия; текущият код е поправен. [api/package.json:9–14](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/package.json#L9-L14); [README.md:611–615](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/README.md#L611-L615) | Инвентаризация на реалните `_prisma_migrations`/`pg_indexes` и backup restore drill. Production release използва reviewed migrations; не се препоръчва blanket checksum update или schema reset. |
| H-09 | `getDailyPlan` lastImport batch lookup и някои aggregate/global metadata отговори имат различна scope гранулярност от entry data. Не е потвърдено, че import summary metadata трябва да е sector-local. [api/src/services/dailyPlan.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/dailyPlan.ts) | Определете metadata disclosure договора; role/scope HTTP тест. Не се обявява automatic data leak без този договор. |
| H-10 | Analytics прави периодни заявки и in-memory aggregation, без production cardinality/EXPLAIN. Няма доказани N+1, липсващи индекси или нужда от materialized views само от размера на файла. | Read-only query timings и EXPLAIN на представителен staging dataset. Performance промени се правят след измерване. |

Няма предложение за нови функционалности. Stricter validation, различни UTC/day boundaries, разширени bypass права, отказ на стар commandId и нови failure semantics са промени на договора и трябва да се отделят.


# Част C: План за рефакториране

## C.1. Общ договор за всяка задача

Всяка T задача е отделен reviewable commit/PR. Преди започване агентът прочита текущата версия на засегнатите файлове и проверява дали доказателството още е валидно. Ако main се е променил, първо актуализира baseline-а; не прилага плана сляпо.

За всяка задача са задължителни:
1. Предварително изпълнение на посочените проверки върху предишната версия.
2. Само описаният обхват; B/H поправки и stricter validation са отделни commits.
3. Сравнение на HTTP/DTO/command/UI договора преди/след, включително error code, message, details, omitted/null поля, order, audit/notification/SSE брой.
4. Същите транзакции и ред на locks, освен в отделен одобрен bug fix. Няма schema migration в чистите задачи.
5. Production typecheck/build и засегнатите тестове. Пълният regression gate се изпълнява за междумодулни и lifecycle/offline промени.
6. **Rollback:** revert на конкретния commit, докато compatibility façade/exports и старите payload-и са запазени. Следваща зависима задача не започва преди успешна проверка.

Рефакториранията не добавят поведение. Съществуващ дефект може да бъде описан в characterization fixture като known behavior, без да се обявява за желан продуктово. След отделна F поправка се обновява очакването с регресионен тест за новия договор.

## C.2. Ред по зависимости

Числата в T ID са постоянни идентификатори; **редът за изпълнение е в тази таблица**.

| Етап | Задачи в препоръчания ред | Gate / причина |
|---|---|---|
| 0. Възстановяване | F-01 → T-01 → T-02 | Seed и type/test gates трябва да са надеждни. F-06 security correction може да е независим отделен PR. |
| 1. Реални договори | T-03 → T-04 → T-12 | Реални scope/seed tests, после единна audit signature преди moving callers. |
| 2. Command boundary | T-05 → T-06 | Общи snapshots/context с characterization на transport различията. F-02 може да последва отделно. |
| 3. Cleaning | T-07 → T-09 → T-08 → T-15 | Cycle първо, notification construction после, transactional session extraction последно. |
| 4. Останал backend | T-10 → T-11 → T-13 → T-14 → T-16 → T-17 → T-18 | Query/policy/type boundaries; запазени public exports. Независимите задачи могат да се изпълняват последователно в този ред. |
| 5. Offline | T-19 → T-20 → T-21 | Engine/ownership проверки преди разделяне. |
| 6. Frontend API/types | T-22 → T-23 → T-24a → T-24b → T-24c → T-24d → T-24e → T-25 | `client.ts` има един редактор на стъпка; imports се пренасочват след extraction. |
| 7. Frontend workflows | T-26 → T-27 → T-28 → T-29 → T-30 | Запазени UI controls, state lifetime и transport choice. |
| 8. Финална приемка | Пълен gate + before/after договори | Само приключени и проверени задачи; optional задачите може да се пропуснат. |

Независимост означава възможност за отделна проверка/revert, не разрешение да се редактира един файл едновременно. `cleaning.ts`, `maintenance.ts`, `offline/index.ts` и `client.ts` са последователни work streams. Ако по-късно се ползват няколко агента, всеки получава отделна задача/branch и файлове; merge след gate, без общи конкурентни промени в един модул.

## C.3. Подробни задачи

### T-01 — Компилируеми тестове и smoke скриптове — P1; R-01/R-04

**Обхват/файлове:** нови `api/tsconfig.tests.json`, `web/tsconfig.tests.json`; package scripts; 4 API test/smoke файла от A.4; точният result type на maintenance lifecycle; web test-only Node types/dependency.

**Действия:** запазване на production configs; test config включва tests/scripts/seed с `rootDir: "."` и `noEmit`. Премахване на остарелите `hotelDate` inputs, точни array/cursor annotations, `room` local non-null fixture binding, пълен typed ticket result за replay branch. Web test types са отделени от browser compilation.

**Предусловия/преди:** production build и наличните API/web tests baseline; всички текущи assertions са описани. Няма blanket casts.
**Приемане/след:** 0 test type errors; 0 production errors; същите runtime assertions/pass counts; lifecycle smoke result съдържа реалните id/status типове.
**Риск/rollback:** погрешно „поправен“ fixture contract. Revert config/type-only commit; без DB промяна.

### T-02 — CI изпълнява наличните реални проверки — P1; R-01

**Файлове:** `.github/workflows/ci.yml`, API/web package scripts.
**Действия:** web tests и test typecheck в jobs; lifecycle idempotency smoke след isolated seed; запазване на audit upgrade job. Да се различат unit и DB integration входовете, като aggregate `npm test` продължава да проверява и двата в подходяща test DB. За migration test се assert-ват имената/predicates на трите cleaning partial uniques и TicketEvent commandId unique.

**Предусловия:** F-01 и T-01; disposable PostgreSQL 16. **Преди:** exact current workflow results и existing smokes.
**Приемане/след:** CI достига до всички изброени smoke steps; API/web tests, types/build и SQL invariants са зелени; script failure fail-ва job. Няма skip, `continue-on-error` или fake green.
**Риск/rollback:** по-дълъг pipeline/fixtures; rollback само workflow/scripts, без намаляване на вече изискваните проверки като permanent workaround.

### T-03 — Реални grant bootstrap тестове и точни fixtures — P2; R-02

**Файлове:** `roleGrants.ensure.test.ts`, `attendance.rebuild.test.ts`, `cards.filter.test.ts`; нов `api/tests/fixtures.ts` и само нужните smoke setup callers.
**Действия:** заменяне на самостоятелната симулация с calls към production bootstrap върху контролирана DB boundary. Fixture employee/user/location IDs са уникални за теста; cleanup изтрива само тях, в FK ред. Не се изтрива цялата история на demo technician.
**Предусловия/преди:** T-01/T-02; записани revoke/restart, adjustment-history и cards AND expectations.
**Приемане/след:** два повторни запуска не влияят на unrelated fixture; revoked default остава absent при реален restart/seed delta; current attendance history/card asserts са запазени.
**Риск/rollback:** сложен FK cleanup и seed ledger state. Revert test-only changes; DB се пресъздава само в test environment.

### T-04 — Scope smoke с истински откази — P1; R-02

**Файлове:** `api/scripts/smoke-data-scope.ts`, test fixtures, workflow.
**Действия:** две предварително създадени области с actors и foreign tasks; app server с production middleware. Replace logs-as-checks с exact assertions: own list/read allowed, foreign read/write denied, housekeeper foreign assignee count=0, empty scope не е unrestricted. Добавяне на ticket/audit/live scope cases според съществуващите exports. Няма mutation backfill като предпоставка в проверяваната операция.
**Предусловия/преди:** T-03; seed и grants изрично подготвени, автентикацията работи.
**Приемане/след:** тестът fail-ва, ако се разреши foreign access или няма fixture; включен в CI с server start/stop cleanup.
**Риск/rollback:** грешни expected HTTP codes/CSRF setup. Revert smoke/CI addition; production scope код остава непроменен.

### T-12 — Единна audit signature — P2; R-06

**Файлове:** `services/audit.ts` и всички `recordAudit/recordAuditMany` callers; съответните tests.
**Действия:** inventory на callers с singleton/tx; typed `(input, db = prisma)`; механично пренареждане; remove runtime DB detection; не се променят payload mapping/transaction ownership.
**Предусловия/преди:** T-02–T-04; audit fixtures с JsonNull/undefined/trim/occurredAt и transaction rollback test.
**Приемане/след:** няма стара signature; compiler отказва missing input; exact audit row и rollback behavior са същите.
**Риск/rollback:** audit случайно извън transaction. Revert commit; няма schema/migration.

### T-05 — Един cleaning conflict snapshot — P2; R-05

**Файлове:** нов `services/cleaningConflict.ts`, `cleaning.ts`, `sync.ts`, техните conflict tests.
**Действия:** извличане на `TaskConflictDetails/taskConflictDetails` и общото DB snapshot read, където входът е действително еднакъв; re-export за текущите imports.
**Предусловия/преди:** T-04/T-12; direct/sync error snapshots за wrong version, missing task, wrong assignee.
**Приемане/след:** currentVersion/status/assignee/expectedVersion присъстват/липсват по същия начин; HTTP/sync codes не се променят.
**Риск/rollback:** optional details и lookup timing. Revert façade/helper change.

### T-06 — Typed command inputs и общ actor/access context — P1; R-05

**Файлове:** нови `services/cleaningCommandAccess.ts`, `maintenanceCommandAccess.ts`, `syncCommands.ts`; cleaning/maintenance routes и sync service.
**Действия:** explicit internal command union; adapters запазват current String/Boolean/default coercion. Извличане на общите action/scope checks и actor mapping; transport differences като B-02 остават видими до F-02. Checks се изпълняват със същия ред; не се кешира scope между mutations.
**Предусловия/преди:** T-05; role/grant/scope/assignee матрица, malformed/legacy payload characterization, replay/error contracts.
**Приемане/след:** общите checks нямат две implementations; пълната матрица дава същите results; без нови accepted/rejected payload-и.
**Риск/rollback:** authorization regressions и priority coercion. Revert commit, run scope+atomic smoke. Unifying policy е отделен F-02 commit.

### T-07 — Самостоятелен cleaning cycle module — P1; R-03

**Файлове:** нов `services/cleaningCycle.ts`, cleaning service/tests, `dailyPlanEffects.ts`.
**Действия:** преместване на sentinel/date/service-type/cycle allocation/rebind/current-cycle location updates и необходимия location lock; exact exports за callers. Transaction client винаги се подава от caller; façade не започва нов transaction.
**Предусловия/преди:** T-04/T-12; cleaning cycle unit+atomic smoke и daily-plan smoke са зелени.
**Приемане/след:** dailyPlan не imports cycle helpers от whole cleaning command module; cycles/statuses/audit counts са идентични; future tasks остават unbound.
**Риск/rollback:** lock order/deadlocks и stale room writes. Revert module move; няма schema/data rewrite.

### T-09 — Cleaning notification payload construction — P2; R-03

**Файлове:** нов `services/cleaningNotifications.ts`, cleaning service.
**Действия:** извличане на различните named notification builders/dispatch functions; същите recipients, type/title/body/entity/payload/dedupe keys; не се създава универсален notification DSL. Calls остават на същите post-commit места.
**Предусловия/преди:** T-07; fixture snapshots и recipient grant/scope checks.
**Приемане/след:** exact payload/recipient sets и one deduped delivery; H-03 failure semantics запазени.
**Риск/rollback:** lost recipient или timing. Revert extraction; audit/transaction code не се променя.

### T-08 — Session commands отделени от task management — P2; R-03

**Файлове:** нов `services/cleaningSessions.ts`; cleaning façade и routes/sync imports през него.
**Действия:** start/complete/cancel и private session/task CAS plumbing се преместват заедно; named cycle/notification helpers се ползват директно. Create/reassign/inspection остават явни, без shared generic transition engine.
**Предусловия/преди:** T-06/T-07/T-09; concurrent start, start/reassign, complete/cancel, replay и stale-cycle cases.
**Приемане/след:** exact service/API results, error precedence и lock order; no duplicate session/audit/SSE/notification on replay.
**Риск/rollback:** transaction split и accidental global Prisma call. Revert façade/session module; atomic smokes задължителни преди merge.

### T-15 — Общ daily-plan task patch — P2; R-09

**Файлове:** `dailyPlanEffects.ts`, daily-plan unit/smoke tests; optional local `dailyPlanTaskPolicy.ts` само ако helper е използван извън файла.
**Действия:** чиста функция получава current priority/assignee/shift и desired inputs, връща точния Prisma patch/priorityRaised. Повторените update branches я използват без промяна на create/link/effect flow.
**Предусловия/преди:** T-07/T-08; priority x assignee x shift table; latest deferred departure fixtures.
**Приемане/след:** няма downgrade/overwrite; current summary labels и roomEffectsAppliedAt claim са запазени; retry не създава втори task.
**Риск/rollback:** taskEffect „bumped“ срещу „linked“. Revert helper; няма backfill.

### T-10 — Ticket projections, DTO и queries — P2; R-04

**Файлове:** нов `services/maintenanceQueries.ts`, maintenance façade, callers/tests.
**Действия:** shared typed includes/mapper, list tickets/events; real lifecycle response type от T-01 се ползва консистентно; snapshot category fields не се заменят с live catalog fields.
**Предусловия/преди:** T-02/T-12; list filter/order/limit DTO fixtures, null assignee, legacy category.
**Приемане/след:** exact JSON и filters, backward-compatible exports; command branches не се променят.
**Риск/rollback:** relation/ordering drift. Revert query module extraction.

### T-11 — Чисти maintenance policy и event mapping — P2; R-04

**Файлове:** нови `maintenancePolicy.ts`/`maintenanceEvents.ts`, maintenance service и tests.
**Действия:** извличане на pause arithmetic/fingerprint с explicit now и съществуващи event-kind→action/summary mapping; writeEvent остава с подаден tx. Legacy fingerprint-less replay branch се запазва.
**Предусловия/преди:** T-10; lifecycle idempotency smoke, wait/resume/resolve/reopen tests с fixed clock.
**Приемане/след:** same SLA due/pause values, fingerprints, summaries/audit counts и replay acceptance/rejection.
**Риск/rollback:** обединяване на различни event messages или Date timings. Revert pure/helper moves.

### T-13 — People business service — P2; R-07

**Файлове:** нов `services/people.ts`, people route/tests.
**Действия:** list/filter/mapper и role mutation orchestration се преместват; route остава validation, current actor и response. Last-owner/count и revocation boundaries се запазват.
**Предусловия/преди:** T-03/T-12; privileged roles, last owner, self role change, inactive/notOnboarded Person fixtures.
**Приемане/след:** equivalent endpoint outputs/errors и session invalidation; business operation се тества без Express.
**Риск/rollback:** промяна на User/Employee identity или H-02 поправка по погрешка. Revert move; не се мигрира data.

### T-14 — Catalog route и async error forwarding — P2; R-08

**Файлове:** нов `routes/maintenanceCatalog.ts`, maintenance route, app mount; засегнатите route handlers.
**Действия:** category/issue-option routes под същия prefix/ред; `asyncHandler` вместо identical try/catch блокове само в тази област. Validation schemas/response shapes остават локални.
**Предусловия/преди:** T-06/T-10; HTTP path/method/guard snapshot, rejected-promise error test.
**Приемане/след:** route matching, inactive/reorder/archive и exact errors са идентични; няма нов route.
**Риск/rollback:** mount conflict и error forwarding. Revert router/mount change.

### T-16 — Typed location projections — P2; R-10

**Файлове:** location service/include/mapper, cleaning dirty projection, relevant query callers.
**Действия:** exact enum types, Prisma `satisfies`/GetPayload за known includes, minimum typed profile там, където relations са нарочно optional. Eliminate mapLocation `any`. B-03 се фиксира отделно или се запазва явно named current profile.
**Предусловия/преди:** T-07/T-10; list/detail/dirty DTO fixtures, sector null/active/inactive, task/session/inspection order.
**Приемане/след:** compiler checks enums/relations, no unintended additional query or response fields; readiness identical.
**Риск/rollback:** неволно „поправен“ mutation DTO. Revert types/includes; no migration.

### T-17 — Общи cleaning метрики — P2; R-11

**Файлове:** нов `services/cleaningMetrics.ts`, analytics/results services и tests.
**Действия:** move current pure functions; re-export compatibility; tests imports direct metric module; query/count/period definitions остават същите.
**Предусловия/преди:** T-02; results unit suite и fixture analytics JSON.
**Приемане/след:** no analytics import на DB results service за pure helpers; all anomaly/duration/denominator outputs unchanged.
**Риск/rollback:** rounding и missing finishedAt. Revert extraction; без SQL rewrite.

### T-18 — JobRun wrapper и scheduler boundary — P2; R-12

**Файлове:** нов `services/jobRun.ts`/`jobScheduler.ts`, jobs façade, index imports/tests.
**Действия:** named run wrapper използва текущите status/summary/error rules; scheduler се премества със същите timings и stop behavior, докато F-08 не го поправи. Job algorithms/claimInactiveUserLock не се променят.
**Предусловия/преди:** T-12; success/disabled/failure fixtures и fake-clock characterization.
**Приемане/след:** same runAllJobs order/response/JobRun writes и existing lock tests.
**Риск/rollback:** swallowed exception или нов scheduler instance. Revert extraction; F-08 е отделен commit.

### T-19 — Offline characterization и browser regression harness — P1; R-13

**Файлове:** нови `web/src/offline/queueEngine.test.ts`/`ownership.test.ts`; test-only IndexedDB setup; `web/tests/e2e/offline.spec.ts` и един minimal browser test config, CI job.
**Действия:** fake transport/clock/IndexedDB за transitions, batch/direct fallback и account switch; browser test за cached MyWork, queued action, reconnect и logout/switch purge. Използва се един test stack, например Node tests+fake-indexeddb и Playwright за browser; няма нов application framework.
**Предусловия/преди:** F-01/T-01/T-02/T-04; fixtures в isolated DB; current 34 web tests.
**Приемане/след:** deterministic tests fail при double send/wrong owner/cache leak, 401 transient/rejected distinction, malformed batch response и retry exhaustion.
**Риск/rollback:** test doubles пропускат IDB transaction behavior. Browser check покрива store persistence; revert test-only additions при setup проблем, без extraction преди зелен harness.

### T-20 — Offline transport отделен — P1; R-13

**Файлове:** нов `offline/transport.ts`, offline façade, http shared helpers, sessionRefresh tests.
**Действия:** move timeout/post/batch и response decoding; reuse existing refresh single-flight. Същите URL/body/commandId/credentials и refreshed CSRF headers; error shape на всеки caller е запазен.
**Предусловия/преди:** T-19; 401→refresh→retry, timeout/network/403/409 cases и current parseJson semantics.
**Приемане/след:** queue engine не строи HTTP requests; exact requests/errors; no duplicate refresh.
**Риск/rollback:** загубен details/code или auth wipe при transient failure. Revert transport module/exports; queued IDB данните остават съвместими.

### T-21 — Offline drain engine с един runtime owner — P1; R-13

**Файлове:** нов `offline/queueEngine.ts`, offline façade, queue tests.
**Действия:** move drain/recover/markSending/applyResult/fallback; narrow dependencies към existing storage/transport/timers. Public façade притежава един owner/switch lock; не се създават две subscriptions/timers/draining flags. Commands/storage/conflict modules остават съществуващите.
**Предусловия/преди:** T-20; batch/direct truth table, orphaned sending, switch/logout mid-flight и browser offline test.
**Приемане/след:** exact transitions/retries/backoff/max=8; no foreign user action; unchanged DB name/version/keys и command shapes.
**Риск/rollback:** най-рисков frontend move. Revert commit без изтриване на outbox; проверете pending/sending recovery със стария код.

### T-22 — Location и people/invitation API ownership — P2; R-14

**Файлове:** нови `locationsApi.ts`/`peopleApi.ts`, client barrel; room/person/invitation types.
**Действия:** механичен move по един домейн на commit; device fingerprint е при device/invitation functions. Pure QR URL helpers се запазват, F-06 е отделна correction.
**Предусловия/преди:** T-20/T-21; request fixtures за list/dirty/occupancy/service/catalog/QR и invitation redeem credential mode.
**Приемане/след:** same methods/query/body/headers и exported types; no runtime circular import.
**Риск/rollback:** public redeem fetch стане authenticated retry случайно. Revert отделния домейн commit; client exports остават.

### T-23 — Plan/settings/permissions API и един timezone cache — P2; R-14

**Файлове:** нови `dailyPlanApi.ts`/`settingsApi.ts`/`permissionsApi.ts`/`hotelDate.ts`, client.
**Действия:** move requests/types последователно; един cachedHotelTimezone owner, update от fetchPublicSettings; todayHotelDate signature/Intl behavior запазени.
**Предусловия/преди:** T-22; URL/import partial result/settings patch/permissions matrix fixtures; timezone setting → todayHotelDate.
**Приемане/след:** no cache reset on domain import; identical date/requests/legacy exports.
**Риск/rollback:** различна hotel day около midnight/DST. Revert per-domain move; storage/API contracts не се променят.

### T-24a — Attendance API extraction — P2; R-14

**Файлове:** нов `attendanceApi.ts`, client.
**Действия:** types, intervals query/cursor, export download, adjustment/review calls; без промяна на download headers/truncation UI.
**Предусловия/преди:** T-23; request/body/CSV-download fixtures.
**Приемане/след:** exact cursor/query/status/headers и promise return type; build/tests.
**Риск/rollback:** CSV blob fallback или dropped filter. Revert one-domain extraction.

### T-24b — Cards API extraction — P2; R-14

**Файлове:** нов `cardsApi.ts`, client.
**Действия:** types и list/employees/issue/revoke requests; datetime helpers остават UI и не се поправят в този move.
**Предусловия/преди:** T-24a; filters/body fixtures и issue response.
**Приемане/след:** same employee/cardType/staffOnly/status query и commandId body.
**Риск/rollback:** default field omission. Revert cards move.

### T-24c — Sectors/shifts API extraction — P2; R-14

**Файлове:** нови `sectorsApi.ts`/`shiftsApi.ts`, client.
**Действия:** relation types, active/inactive queries, sector members, roster requests; по един domain commit.
**Предусловия/преди:** T-24b; sector transfer/roster payload fixtures.
**Приемане/след:** same includeInactive/query and hotelDate/entries bodies; barrel compatibility.
**Риск/rollback:** sector/current snapshot confusion. Revert domain commit; no cache/schema change.

### T-24d — Analytics/operations API extraction — P2; R-14

**Файлове:** нови `analyticsApi.ts`/`operationsApi.ts`, client.
**Действия:** move discriminated AnalyticsSummary types и read-only requests; KPI/forecast meanings не се променят.
**Предусловия/преди:** T-24c; both domains/from/to request и response fixtures.
**Приемане/след:** same discriminated types, optional fields and routes.
**Риск/rollback:** losing union type or forecast null semantics. Revert move.

### T-24e — Оставащи audit/jobs/sync/notification API exports — P2; R-14

**Файлове:** `auditApi.ts`/`jobsApi.ts`/`syncApi.ts`/`notificationsApi.ts`, client barrel.
**Действия:** последователни малки move commits; отделни request snapshots за всеки домейн. Client остава compatibility barrel, без business/types/requests, които вече имат собственик. Shared AuthUser/http exports се запазват.
**Предусловия/преди:** T-24d; notification unread/read/dismiss, audit filters и sync envelope fixtures.
**Приемане/след:** public imports работят; no hidden mutable state в barrel; exact sync response types.
**Риск/rollback:** pagination/options omission и import cycle. Всеки domain commit се revert-ва самостоятелно.

### T-25 — Typed v2 MyWork cache — P2; R-15

**Файлове:** storage/cache payload types, MyWork consumers/tests.
**Действия:** type-only imports от cleaning/maintenance API, точен tasks/tickets DTO; remove unsafe page casts; fixture за existing stored representation. `unknown` остава само на IDB boundary.
**Предусловия/преди:** T-21/T-24e; existing v2 cache fixture и offline browser test.
**Приемане/след:** producer/consumer compiler checked; current persisted payload reads identically; DB version не се променя.
**Риск/rollback:** legacy field rejection. Revert types/consumer move; не се purge-ва cache като migration.

### T-26 — Един offline status hook и indicator — P2; R-16

**Файлове:** `hooks/useOfflineStatus.ts`, `components/ConnectionStatus.tsx`, MyWork/Repairs.
**Действия:** subscription/stats/mode и labels/classes се изнасят; page refresh callback остава page-owned; lifecycle с cleanup/StrictMode.
**Предусловия/преди:** T-19/T-21/T-25; status/initial stats/render fixtures.
**Приемане/след:** exact labels/classes/counts, one active listener per mounted consumer, no lost reconnect refresh.
**Риск/rollback:** stale page callback и notification order. Revert hook/component extraction.

### T-27 — Locations data/form/drawer ownership — P2; R-17

**Файлове:** `useLocationsData.ts`/`useLocationIssueDraft.ts`/`LocationDetailDrawer.tsx`, LocationsPage и existing panels.
**Действия:** първо един shared list-loading function, после drawer state, после issue draft; всяка стъпка отделен commit. Existing abort guard се пренася целият.
**Предусловия/преди:** T-22/T-26; room/common workflows, issue/cleaning/mutation/drawer browser assertions.
**Приемане/след:** същите controls, selected IDs, defaults, errors/busy boundaries и requests; без loss на drawer cancellation.
**Риск/rollback:** draft/state lifetime и early reset. Revert последната extraction; component CSS класовете не се променят.

### T-28 — Repairs report form и ticket event hook — P2; R-18

**Файлове:** `RepairReportForm.tsx`/`useTicketEvents.ts`, RepairsPage; option draft helper при доказано еднакво правило.
**Действия:** report form с explicit queued submit callback; preserve draft/reset/error; history lifecycle се изнася отделно; current TicketLifecycleActions се използва.
**Предусловия/преди:** T-24e/T-26; report option/custom, offline queued, ticket selection tests. F-09 ако е изпълнен, новият query guard се пренася; иначе known behavior остава.
**Приемане/след:** exact payload/commandId ownership; draft не се губи при unrelated list refresh; same event order.
**Риск/rollback:** двойна команда или stale selected detail. Revert form/hook commit; no queue format change.

### T-29 — Sector form ownership — P2; R-19

**Файлове:** `useSectorForm.ts` или state в mounted SectorPanel, HousekeepingPage.
**Действия:** sector draft/edit/filter/selection/reset се местят заедно; lookup data и explicit mutation/refresh callbacks остават ясни.
**Предусловия/преди:** T-24c/T-26; sector create/update/members/cancel and tab-switch tests.
**Приемане/след:** същите source/destination constraints, checked location IDs и draft persistence; по-малко form-state props.
**Риск/rollback:** unmount resets и cross-sector selection. Revert sector-state move; permissions не се променят.

### T-30 — Shift/roster form ownership — P2; R-19

**Файлове:** `useShiftRoster.ts`/ShiftPanel, HousekeepingPage.
**Действия:** shift edit и roster date/draft/save state се изнасят, след проверка кои states имат общ lifecycle. Не се променя unconditional refresh като част от extraction.
**Предусловия/преди:** T-29; inactive shifts, clock defaults, roster date change/save/clear, tabs preserve tests.
**Приемане/след:** same roster input/hotelDate, reset behavior и user feedback; Housekeeping parent държи само shared lookups/tab composition.
**Риск/rollback:** запазен draft към грешна дата/empty assignment. Revert move; F-10b е отделен permission-loading PR.

## C.4. Отделни задачи за дефекти — не се смесват с T задачите

Всички F задачи използват общия acceptance/rollback договор от C.1, но **умишлено коригират поведение**. За всяка първо се добавя regression test, който показва стария дефект. F-01 е необходим за regression gate; останалите не са предварителни условия за pure extraction, ако known behavior е фиксирано явно.

| ID / приоритет | Точен обхват и действия | Предусловие и тест преди | Приемане/проверка след; риск и rollback |
|---|---|---|---|
| F-01 / P1 | `seed.ts` reset NotificationDelivery→Notification преди Employee; ревизия на cleanup catch-ите само за действителните FK зависимости. | Isolated empty PostgreSQL; migrate→seed→API tests→second seed reproduces P2003. | Second seed и 6 atomic smokes успешно; unrelated bootstrap ledger contracts проверени. Риск destructive URL; само test/dev DB. Revert seed fix; не може да се „върнат“ вече изтрити данни без backup. |
| F-02 / P1 | REST/sync command access flags от R-05, без промяна на grant/scope правилата. | Потвърдена bypass матрица; tests показват direct success/batch denial. Желателни T-05/T-06. | Equivalent commands дават equivalent status/result, чужд scope остава denied. Риск privilege expansion; revert policy commit, остават extraction модулите. |
| F-03 / P2 | Mark-dirty projection само, правилни open blocking statuses и sector include. | DTO diff спрямо GET за assigned/waiting и active sector; T-16 може да помогне. | Mutation DTO съдържа очакваните relations; dirty/status/cycle/audit unchanged. Риск UI null assumptions; revert projection commit. |
| F-04 / P2 | Cards/Attendance datetime conversion helper; двата callers. | Избран browser-local или hotel-local договор; 12Z→09Z regression case. | Unchanged input preserves instant/minute precision; Sofia/UTC/DST tests. Риск ambiguous local time; revert UI conversion, без DB rewrite на исторически записи. |
| F-05 / P2 | `theme.ts`/`main.tsx`/App theme effects: apply DOM отделно от explicit persistence. | Empty localStorage + server default light; existing preference cases. | Default се прилага, toggle/reload пазят explicit choice. Риск theme flash; revert theme commit; no settings schema change. |
| F-06 / P1 | Team invitation QR локално генериране; минимална локална QR dependency/компонент. | Current payload decode fixture; network request containing code е записан като стар път. | QR decode exact payload, redeem flow успешно, no external QR request. Риск scan quality; revert implementation технически възможен, но връща credential disclosure — предпочитайте поправка напред. |
| F-07 / P2 | Analytics CSV helper/consumer, 3-column договор. | Quote/comma/newline regression fixture; ordinary rows baseline. | Correct CSV round-trip/columns/filename/type; риск BOM/line-endings; revert exporter commit. |
| F-08 / P2 | Scheduler initial timeout tracking/clear. | Fake-clock stop-before-15s и restart case; T-18 по желание. | Stop отменя всички pending timers; exact one initial/interval run. Риск no initial run; revert scheduler fix. |
| F-09 / P2 | Attendance/Analytics/Results/Plan query response guards и Repairs history; първо една страница на PR. | Controlled deferred A/B completion и attendance old loadMore. | Последният query/selected ID притежава state; unmount/refresh/empty/error работят. Риск lost refresh/loading; revert отделната page correction. |
| F-10a / P2 | Role-only UI controls към `canPerformAction`, запазен legacy fallback. | DB custom grants/revoked grants/owner/legacy tests. | Visibility съответства на actions; server checks остават authoritative. Риск смесване на panel/action/role constraints; revert UI capability commit. |
| F-10b / P2 | Housekeeping independent permission-aware loading; евентуално catalog manager read guard след endpoint matrix review. | Sectors allowed/shifts denied/people denied fixtures; текущият Promise.all failure. | Разрешените панели получават данните си; denied calls не блокират други. Риск changed partial-loading UX; explicit per-resource errors и browser tests; revert loading correction. |

H-01–H-10 първо изискват посочената конкретна проверка. Ако се потвърди дефект или изискване, за него се създава нов F ID с договор и regression test. Нито една T задача не „решава“ тези рискове с неописана transaction/locking/performance промяна.


# Част D: Предложена крайна архитектура

## D.1. Принцип и обхват

Запазва се модулният монолит и текущият frontend модел. Организацията се довършва около **съществуващите отговорности**, а не около нови абстрактни слоеве. Routes адаптират HTTP; command services притежават mutations/transactions; query modules притежават projections/DTO; policy modules съдържат конкретните shared pure правила.

Frontend API modules притежават своите домейн договори; offline има ясно отделен transport/engine и един owner; feature components/hooks притежават един form/query lifecycle. `client.ts` и старите service exports остават compatibility входове през прехода. Не е нужно да се премахват веднага след extraction.

**Всички нови файлове по-долу са предложения, а не вече създадени промени в Maintenance.**

## D.2. Backend организация след необходимите задачи

| Модул/файлове | Отговорност след промяната | Променени текущи файлове / задачи |
|---|---|---|
| `routes/cleaning.ts`, `routes/maintenance.ts` | HTTP validation и adapters; service calls; същите endpoints. | T-06/T-14 |
| `routes/maintenanceCatalog.ts` | Catalog categories/options routes под съществуващия prefix. | maintenance route + app mount; T-14 |
| `services/cleaningCommandAccess.ts`, `maintenanceCommandAccess.ts` | Конкретни action/scope/actor input helpers. Transport differences са explicit до F-02. | routes/sync; T-06 |
| `services/syncCommands.ts`, `sync.ts` | Typed internal commands и current sync transport coercion; batch result envelope. | sync; T-06 |
| `services/cleaningConflict.ts` | Conflict detail contract и общ snapshot helper. | cleaning/sync/tests; T-05 |
| `services/cleaningCycle.ts` | Cycle allocation/rebinding, service type и current-cycle location writes с caller tx. | cleaning/dailyPlanEffects; T-07 |
| `services/cleaningSessions.ts` | Start/complete/cancel и свързан CAS/lock orchestration. | cleaning façade; T-08 |
| `services/cleaningNotifications.ts` | Named cleaning notification payload/recipient dispatch; current post-commit timing. | cleaning; T-09 |
| `services/cleaning.ts` | Public façade и останалите task create/reassign/inspection operations. Не се разделя допълнително по размер. | T-07–T-09 |
| `services/cleaningTasksQuery.ts` | Съществуващ typed task projection/formatting. | Запазва се |
| `services/maintenanceQueries.ts` | Ticket relation projection, DTO и list/events reads. | maintenance; T-10 |
| `services/maintenancePolicy.ts`, `maintenanceEvents.ts` | SLA pause/fingerprint pure rules и конкретен event/audit mapping с подаден tx. | maintenance; T-11 |
| `services/maintenance.ts` | Явни ticket lifecycle commands и съвместими exports. | T-10/T-11 |
| `services/people.ts` | Person mapping/list и role change orchestration. | people route; T-13 |
| `services/locations.ts` | Typed named projections + mapper; location mutations. | T-16 |
| `services/dailyPlan.ts`, `dailyPlanEffects.ts` | Plan CRUD/import и existing effects; един small task-patch helper. | T-15; разделението вече съществува |
| `services/cleaningMetrics.ts` | Shared anomaly/duration arithmetic. | analytics/results; T-17 |
| `services/audit.ts` | Една typed write signature; read/scope helpers остават. | всички write callers; T-12 |
| `services/jobRun.ts`, `jobScheduler.ts`, `jobs.ts` | Recorded run lifecycle, timers и existing domain job algorithms. | index/jobs; T-18 |
| `readiness.ts`, `assignees.ts`, `dataScope.ts`, `hotelTime.ts` | Съществуващи shared domain rules. | Запазват се, освен нужни type/import adjustments |
| `attendance.ts`/`attendanceRules.ts`/`attendanceReports.ts` | Съществуващо подходящо разделение на orchestration, pairing и reports. | Без wholesale refactor |
| `authSessions.ts`/`invitations.ts`/middleware/events` | Съществуващи auth/session/SSE граници. | Само audit caller/types при съответните задачи |
| `prisma/schema.prisma`/`migrations` | Текущ модел и DB constraints. | **Няма миграция, необходима за pure plan** |
| `api/tests`/test configs/CI | Реални fixtures и проверка на production contracts. | T-01–T-04 |

Основната зависимост остава `route → конкретен service → Prisma`. Policy/query helpers се извикват от съответния service; не се добавя общ base service/repository. TransactionClient остава explicit argument за helper, който пише в текуща транзакция.

## D.3. Frontend организация след необходимите задачи

| Модул/файлове | Отговорност | Задачи |
|---|---|---|
| `api/http.ts`, `sessionPolicy.ts` | Общ auth retry/refresh и transient/auth-rejected classification. | Запазени; narrow transport reuse в T-20 |
| `api/*Api.ts` | DTO types и requests за конкретен домейн; existing cleaning/maintenance modules остават. | T-22–T-24e |
| `api/hotelDate.ts` | Един timezone cache/todayHotelDate owner. | T-23 |
| `api/client.ts` | Compatibility barrel; поетапно direct imports от новите модули. | T-22–T-24e |
| `api/liveEvents.ts`, `hooks/useLiveRefresh.ts` | Една SSE връзка и current refresh batching. | Запазени |
| `offline/storage.ts` | IndexedDB v2 I/O и typed cache/queue payloads. | T-25, без DB version change |
| `offline/commands.ts` | Съществуващи named command payload builders. | Запазени |
| `offline/conflict.ts` | Съществуващи pure conflict/rebase decisions. | Запазени; truth-table tests |
| `offline/transport.ts` | Current timeout/post/batch/error transport и shared session retry. | T-20 |
| `offline/queueEngine.ts` | Drain/recover/transitions/retry/fallback с тесни dependencies. | T-21 |
| `offline/index.ts` | Съвместим public API, един owner/lock/runtime orchestration. | T-20/T-21 |
| `hooks/useOfflineStatus.ts`/`ConnectionStatus.tsx` | Subscription и current connection presentation. | T-26 |
| `useLocationsData.ts`/`useLocationIssueDraft.ts`/`LocationDetailDrawer.tsx` | Locations list, issue draft и drawer lifecycle. | T-27 |
| `RepairReportForm.tsx`/`useTicketEvents.ts` | Repairs report draft и detail read. | T-28 |
| `useSectorForm.ts`/`useShiftRoster.ts` | Housekeeping form ownership. | T-29/T-30 |
| `App.tsx`, останалите pages/components/CSS | Съществуващ shell/навигация/дизайн и подходящи small components. | Без задължително пренаписване |

Новите модули не означават задължително повече network requests, global state или нов UI. Крайният брой файлове не е success criterion; правилният собственик на policy/state и запазените договори са.

## D.4. Какво не се променя

- URLs, methods, body/query contracts, status/error/details и видимите workflow-и в pure задачите.
- Cleaning status machine, cleaningCycle=0 за future tasks, soft guards за стар cycle и task/session unique constraints.
- Ticket SLA pause/reopen/idempotency semantics и исторически category snapshots.
- Plan partial import, deferred departure/confirmation/newer-stay защита и assignee/shift persistence.
- Runtime grants, owner/privileged role правила и data scope snapshot semantics.
- Attendance hotel timezone, date-only срещу instant, pairing/export/history behavior.
- IndexedDB име/version/key format, per-user isolation, queued commands/retry/rebase behavior.
- In-process scheduler/event bus deployment модел; PWA precache policy.

# Част E: Оценка на ефекта

## E.1. Реалистични подобрения и проверими показатели

| Подобрение | Как се доказва | Какво не се обещава |
|---|---|---|
| Надежден regression gate | Всички предвидени test/smoke steps се изпълняват; test typecheck=0; scope smoke fail-ва при foreign access; grant tests викат production code. | 100% coverage или absence на всички дефекти. |
| По-безопасни command промени | Една action/scope/snapshot implementation; запазена transport characterization матрица; equivalent след отделна F-02. | Автоматично по-широки права или нов sync protocol. |
| По-ясни critical transactions | Cycle/session helpers приемат същия tx; lock order и audit count са assert-нати. | Нов isolation level, нулев deadlock или решени всички concurrency H рискове. |
| По-тестируем offline engine | Изолирани ownership/transport/retry tests и browser account-switch case; façade има един owner. | Повишена offline durability без допълнителни runtime проверки. |
| По-силни домейн типове | Пропуснат relation/enum или cache DTO drift се открива при compile; tests включени в types gate. | Runtime validation на всяка външна стойност само чрез TypeScript. |
| По-малко дублиране | Един daily-plan patch, audit signature, metric rules и connection status; inspection на callers. | Минимален брой редове/файлове като самоцел. |
| По-малко frontend coupling | Form/query lifecycle се тества отделно; draft/tab/selection contracts остават. | Нов UX, по-малко requests или гарантиран по-малък bundle. |
| По-малко merge конфликти | Различните API домейни се променят в собствени modules след migration. | Паралелен безопасен edit на един shared file. |

Няма достатъчно данни за точни часове, performance проценти или production incident reduction. Ефектът се оценява чрез горните критерии, а усилието се оценява след T-01–T-04 и първата малка extraction.

## E.2. Най-голяма полза

1. **F-01 и T-01–T-04:** възстановяват проверките и поправят false confidence. Те са първи, независимо колко добре изглежда новата структура.
2. **R-05/T-05–T-06:** премахват доказано повторените authorization/command boundaries; F-02 отстранява отделно функционалното разминаване.
3. **R-13/T-19–T-21:** отделят най-сложния frontend side-effect flow, без да жертват вече правилната account isolation.
4. **R-03/T-07–T-09:** правят cleaning cycle обща explicit policy и запазват transaction invariants.
5. **T-12/T-16/T-25:** сравнително ограничени промени с ясна compiler/contract полза.

F-06 има висока security полза, но е отделна correction. Не трябва да чака пълното архитектурно пренареждане.

## E.3. Какво може да се отложи или пропусне

- T-17 и T-18 са полезни, но могат да се отложат, ако metrics/jobs рядко се променят; B-08 може да се поправи без пълния scheduler extraction.
- T-14 може да се пропусне, ако няма текуща работа по catalog/lifecycle routes. `asyncHandler` migration извън засегнатите модули не е необходима голяма задача.
- T-27–T-30 се изпълняват там, където съответният workflow се развива; няма нужда всички pages да се унифицират.
- API extraction може да се изпълни домейн по домейн. Compatibility barrel може да остане дългосрочно.
- Допълнително раздробяване на cleaning task/inspection façade се прави само при доказана нова нужда; сегашният план не го изисква.
- Общи date-format utilities, CSS split, икона/style rename, общ form library, общ repository и generic state machine **не са задължителни предложения**. Не е доказана достатъчна полза за Maintenance.
- **P3 задачите не се добавят само за попълване на категория.** Няма отделен задължителен P3 пакет.

## E.4. Оставащи рискове след pure refactor

Pure extraction не поправя B дефектите, ако съответните F задачи не са изпълнени. Не доказва H concurrency/failure/metadata/deployment въпросите. SQL migration invariants трябва да се проверят и в реалния release процес. Legacy audit history, която вече е изтрита в стар deployment, не може да се възстанови чрез refactor или нова migration без backup.

UI/IndexedDB integration остава големият предварително непроверен слой. Преди moving feature state и offline engine е необходим посоченият browser harness. Production correctness за performance, cardinality и multi-instance behavior изисква реална deployment/DB информация.

Правилният резултат е серия малки зелени PR-и със запазени API/UI договори, а не еднократен rewrite.

# Приложение 1: Обхват, ограничения и непрегледани части

## Прегледан обхват

- Всички runtime backend модули в `api/src` са обхванати в статичния преглед: routes, services, auth, middleware, events, app/config/error boundary. Критичните mutations са проследени през controller→scope/action→service→transaction→audit/notification.
- Schema и всички 34 SQL migrations са прегледани; explicit SQL invariants и audit restore script са проследени. **Не са приложени локално**; CI за същия SHA е независимото доказателство за migration/upgrade изпълнение.
- Frontend HTTP/session/capabilities/SSE/offline, App и основните MyWork/Repairs/Locations workflow-и са прегледани подробно.
- Бизнес логиката, imports, state/effects/callbacks и сложните inline JSX handlers във всички останали pages/components са прегледани систематично чрез AST projection и targeted reads. Това не е визуална QA и не е пълен ред-по-ред преглед на всички declarative JSX елементи.
- За 25 test файла са инвентаризирани suites/assertions и са изпълнени наличните тестове при описаните ограничения; критичните role/grant/scope/cycle/attendance/results/session cases са прочетени целево. **Не се твърди пълен ред-по-ред преглед на всеки fixture/helper във всички tests.**
- За 9 smoke scripts са прегледани entry/setup/assertion flows и критичните concurrency/idempotency cases. Data-scope script е прочетен изцяло. **Не всички атомарни smoke fixture блокове са проверени ред по ред и не са изпълнени локално.**

## Изрични ограничения

| Част | Какво не е напълно проверено |
|---|---|
| `api/prisma/seed.ts` | Reset/FK зависимости и релевантните service-driven fixtures са проверени; всички 3039 реда demo-generation сценарии не са прочетени ред по ред. |
| Declarative frontend JSX | Targeted UI conditions/handlers са проверени; всички labels/layout combinations не са изчерпателно проверени. |
| CSS | Imports, organization, theme tokens и media/animation секции са огледани; няма пълна selector/cascade/unused-style проверка или render screenshots. CSS refactor не се предлага. |
| README BG/EN и `референция` | Релевантни domain/API/startup/migration секции и документният контекст; няма пълна спецификационна сверка на всеки документен ред с runtime. |
| Package lockfiles | Използвани за reproducible install/version baseline; не е прегледан всеки transitive package/source и няма dependency security audit. |
| PostgreSQL deployment/data | Няма production/staging DB, real `pg_indexes/_prisma_migrations`, row counts, EXPLAIN или backup restore execution. |
| Hardware/external интеграции | Няма terminal/card/PMS/provider runtime тестове; текущият проект включва demo/симулирани потоци. |
| Browser/runtime | Не са проверени real cookie/session network flow, responsive UI, offline reload, multi-tab/account-switch или camera/QR scan в работещ browser. |
| Deployment | Няма инфраструктура извън наличния compose/workflow и състоянието на репото. Реплики, monitoring и production environment не са установени. |
| Бинарни/vendor файлове | Неизтеглени: двата `web/dev-dist/workbox-*.js` vendor bundles, `web/public/pwa-192.png`, `web/public/pwa-512.png`, `web/src/assets/hero.png`. Не са анализирани съдържателно. Generated `sw.js` е разглеждан като generated artifact, не като място за ръчна поправка. |

По тази причина докладът е задълбочен статичен анализ и изпълним план за проверените области, **а не изчерпателно доказателство за всички възможни runtime проблеми**.

# Приложение 2: Инвентаризация на файловете

В таблицата „код“ означава статичен преглед на отговорности/логика; „логика“ означава frontend AST/targeted review с ограниченията по-горе. „тест“/„smoke“ означават suite/assertion/setup преглед, не обещание за пълна fixture QA. За всяка реална промяна агентът трябва да прочете целия засегнат файл отново в текущия branch.


| Файл | Обхват на проверката |
|---|---|
| [.github/workflows/ci.yml](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/.github/workflows/ci.yml) | config/структурен контекст |
| [.gitignore](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/.gitignore) | config/структурен контекст |
| [README.en.md](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/README.en.md) | релевантни секции/контекст; частично |
| [README.md](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/README.md) | релевантни секции/контекст; частично |
| [api/.env.example](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/.env.example) | config/структурен контекст |
| [api/.gitignore](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/.gitignore) | config/структурен контекст |
| [api/fixtures/daily-plan-import.example.json](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/fixtures/daily-plan-import.example.json) | config/структурен контекст |
| [api/package-lock.json](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/package-lock.json) | lockfile/install; без dependency source audit |
| [api/package.json](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/package.json) | config/структурен контекст |
| [api/prisma/migrations/20261002135731_init/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261002135731_init/migration.sql) | SQL migration; статичен преглед |
| [api/prisma/migrations/20261002143102_step2_ops_control/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261002143102_step2_ops_control/migration.sql) | SQL migration; статичен преглед |
| [api/prisma/migrations/20261002143843_add_roles_technician_manager_admin/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261002143843_add_roles_technician_manager_admin/migration.sql) | SQL migration; статичен преглед |
| [api/prisma/migrations/20261002155022_add_role_owner/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261002155022_add_role_owner/migration.sql) | SQL migration; статичен преглед |
| [api/prisma/migrations/20261002161636_resolution_audit/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261002161636_resolution_audit/migration.sql) | SQL migration; статичен преглед |
| [api/prisma/migrations/20261002165204_add_attendance/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261002165204_add_attendance/migration.sql) | SQL migration; статичен преглед |
| [api/prisma/migrations/20261002172700_location_kind/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261002172700_location_kind/migration.sql) | SQL migration; статичен преглед |
| [api/prisma/migrations/20261002173700_app_settings/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261002173700_app_settings/migration.sql) | SQL migration; статичен преглед |
| [api/prisma/migrations/20261002174900_role_grants/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261002174900_role_grants/migration.sql) | SQL migration; статичен преглед |
| [api/prisma/migrations/20261002180000_daily_plan/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261002180000_daily_plan/migration.sql) | SQL migration; статичен преглед |
| [api/prisma/migrations/20261002190000_invitations_devices/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261002190000_invitations_devices/migration.sql) | SQL migration; статичен преглед |
| [api/prisma/migrations/20261002193000_analytics_sla_reopen/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261002193000_analytics_sla_reopen/migration.sql) | SQL migration; статичен преглед |
| [api/prisma/migrations/20261002195400_access_cards/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261002195400_access_cards/migration.sql) | SQL migration; статичен преглед |
| [api/prisma/migrations/20261002200000_sectors_shifts/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261002200000_sectors_shifts/migration.sql) | SQL migration; статичен преглед |
| [api/prisma/migrations/20261002210000_issue_catalog/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261002210000_issue_catalog/migration.sql) | SQL migration; статичен преглед |
| [api/prisma/migrations/20261002220000_ticket_lifecycle/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261002220000_ticket_lifecycle/migration.sql) | SQL migration; статичен преглед |
| [api/prisma/migrations/20261002230000_task_sector_snapshot/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261002230000_task_sector_snapshot/migration.sql) | SQL migration; статичен преглед |
| [api/prisma/migrations/20261002230000_task_status_rework/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261002230000_task_status_rework/migration.sql) | SQL migration; статичен преглед |
| [api/prisma/migrations/20261002240000_daily_plan_import/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261002240000_daily_plan_import/migration.sql) | SQL migration; статичен преглед |
| [api/prisma/migrations/20261002250000_roadmap_modules/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261002250000_roadmap_modules/migration.sql) | SQL migration; статичен преглед |
| [api/prisma/migrations/20261002250000_task_sector_supervisor_and_qr/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261002250000_task_sector_supervisor_and_qr/migration.sql) | SQL migration; статичен преглед |
| [api/prisma/migrations/20261002260000_unified_audit_events/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261002260000_unified_audit_events/migration.sql) | SQL migration; статичен преглед |
| [api/prisma/migrations/20261002270000_session_cancel_command_id/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261002270000_session_cancel_command_id/migration.sql) | SQL migration; статичен преглед |
| [api/prisma/migrations/20261002280000_auth_sessions/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261002280000_auth_sessions/migration.sql) | SQL migration; статичен преглед |
| [api/prisma/migrations/20261006210000_cleaning_atomic_invariants/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261006210000_cleaning_atomic_invariants/migration.sql) | SQL migration; статичен преглед |
| [api/prisma/migrations/20261006220000_backfill_legacy_audit_history/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261006220000_backfill_legacy_audit_history/migration.sql) | SQL migration; статичен преглед |
| [api/prisma/migrations/20261006220000_cleaning_service_type_completed_at/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261006220000_cleaning_service_type_completed_at/migration.sql) | SQL migration; статичен преглед |
| [api/prisma/migrations/20261006230000_shift_roster_task_shift/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261006230000_shift_roster_task_shift/migration.sql) | SQL migration; статичен преглед |
| [api/prisma/migrations/20261006231000_notifications/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261006231000_notifications/migration.sql) | SQL migration; статичен преглед |
| [api/prisma/migrations/20261006240000_location_cleaning_cycle/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261006240000_location_cleaning_cycle/migration.sql) | SQL migration; статичен преглед |
| [api/prisma/migrations/20261006250000_daily_plan_room_effects_applied/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261006250000_daily_plan_room_effects_applied/migration.sql) | SQL migration; статичен преглед |
| [api/prisma/migrations/20261008220000_applied_data_seed/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261008220000_applied_data_seed/migration.sql) | SQL migration; статичен преглед |
| [api/prisma/migrations/20261009210000_daily_plan_deferred_assignee/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261009210000_daily_plan_deferred_assignee/migration.sql) | SQL migration; статичен преглед |
| [api/prisma/migrations/20261009220000_ticket_event_command_id/migration.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/20261009220000_ticket_event_command_id/migration.sql) | SQL migration; статичен преглед |
| [api/prisma/migrations/migration_lock.toml](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/migrations/migration_lock.toml) | SQL migration; статичен преглед |
| [api/prisma/schema.prisma](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/schema.prisma) | DB schema; статичен преглед |
| [api/prisma/scripts/restore_permission_setting_history.sql](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/scripts/restore_permission_setting_history.sql) | SQL restore; без изпълнение |
| [api/prisma/seed.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/prisma/seed.ts) | reset/релевантни fixtures; частично |
| [api/scripts/smoke-attendance-atomic.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/scripts/smoke-attendance-atomic.ts) | smoke setup/assertions; не е изпълнен локално |
| [api/scripts/smoke-cleaning-atomic.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/scripts/smoke-cleaning-atomic.ts) | smoke setup/assertions; не е изпълнен локално |
| [api/scripts/smoke-daily-plan-atomic.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/scripts/smoke-daily-plan-atomic.ts) | smoke setup/assertions; не е изпълнен локално |
| [api/scripts/smoke-data-scope.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/scripts/smoke-data-scope.ts) | smoke setup/assertions; не е изпълнен локално |
| [api/scripts/smoke-invitation-atomic.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/scripts/smoke-invitation-atomic.ts) | smoke setup/assertions; не е изпълнен локално |
| [api/scripts/smoke-invitation-role.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/scripts/smoke-invitation-role.ts) | smoke setup/assertions; не е изпълнен локално |
| [api/scripts/smoke-legacy-audit-upgrade.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/scripts/smoke-legacy-audit-upgrade.ts) | smoke setup/assertions; не е изпълнен локално |
| [api/scripts/smoke-maintenance-atomic.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/scripts/smoke-maintenance-atomic.ts) | smoke setup/assertions; не е изпълнен локално |
| [api/scripts/smoke-ticket-lifecycle-idempotency.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/scripts/smoke-ticket-lifecycle-idempotency.ts) | smoke setup/assertions; не е изпълнен локално |
| [api/src/app.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/app.ts) | backend код; статичен преглед |
| [api/src/auth/tokens.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/auth/tokens.ts) | backend код; статичен преглед |
| [api/src/constants.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/constants.ts) | backend код; статичен преглед |
| [api/src/db.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/db.ts) | backend код; статичен преглед |
| [api/src/env.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/env.ts) | backend код; статичен преглед |
| [api/src/errors.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/errors.ts) | backend код; статичен преглед |
| [api/src/events/authorizeLiveEvent.test.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/events/authorizeLiveEvent.test.ts) | test suites/assertions; изпълнение според A.4 |
| [api/src/events/authorizeLiveEvent.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/events/authorizeLiveEvent.ts) | backend код; статичен преглед |
| [api/src/events/bus.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/events/bus.ts) | backend код; статичен преглед |
| [api/src/index.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/index.ts) | backend код; статичен преглед |
| [api/src/middleware/asyncHandler.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/middleware/asyncHandler.ts) | backend код; статичен преглед |
| [api/src/middleware/auth.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/middleware/auth.ts) | backend код; статичен преглед |
| [api/src/middleware/security.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/middleware/security.ts) | backend код; статичен преглед |
| [api/src/middleware/session.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/middleware/session.ts) | backend код; статичен преглед |
| [api/src/permissions.roleAssignment.test.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/permissions.roleAssignment.test.ts) | test suites/assertions; изпълнение според A.4 |
| [api/src/permissions.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/permissions.ts) | backend код; статичен преглед |
| [api/src/routes/analytics.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/routes/analytics.ts) | backend код; статичен преглед |
| [api/src/routes/attendance.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/routes/attendance.ts) | backend код; статичен преглед |
| [api/src/routes/audit.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/routes/audit.ts) | backend код; статичен преглед |
| [api/src/routes/auth.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/routes/auth.ts) | backend код; статичен преглед |
| [api/src/routes/cards.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/routes/cards.ts) | backend код; статичен преглед |
| [api/src/routes/cleaning.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/routes/cleaning.ts) | backend код; статичен преглед |
| [api/src/routes/commonAreas.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/routes/commonAreas.ts) | backend код; статичен преглед |
| [api/src/routes/dailyPlan.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/routes/dailyPlan.ts) | backend код; статичен преглед |
| [api/src/routes/events.scope.test.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/routes/events.scope.test.ts) | test suites/assertions; изпълнение според A.4 |
| [api/src/routes/events.ticket.test.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/routes/events.ticket.test.ts) | test suites/assertions; изпълнение според A.4 |
| [api/src/routes/events.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/routes/events.ts) | backend код; статичен преглед |
| [api/src/routes/invitations.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/routes/invitations.ts) | backend код; статичен преглед |
| [api/src/routes/jobs.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/routes/jobs.ts) | backend код; статичен преглед |
| [api/src/routes/locations.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/routes/locations.ts) | backend код; статичен преглед |
| [api/src/routes/maintenance.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/routes/maintenance.ts) | backend код; статичен преглед |
| [api/src/routes/myWork.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/routes/myWork.ts) | backend код; статичен преглед |
| [api/src/routes/notifications.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/routes/notifications.ts) | backend код; статичен преглед |
| [api/src/routes/operations.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/routes/operations.ts) | backend код; статичен преглед |
| [api/src/routes/people.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/routes/people.ts) | backend код; статичен преглед |
| [api/src/routes/permissions.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/routes/permissions.ts) | backend код; статичен преглед |
| [api/src/routes/rooms.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/routes/rooms.ts) | backend код; статичен преглед |
| [api/src/routes/sectors.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/routes/sectors.ts) | backend код; статичен преглед |
| [api/src/routes/settings.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/routes/settings.ts) | backend код; статичен преглед |
| [api/src/routes/sync.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/routes/sync.ts) | backend код; статичен преглед |
| [api/src/services/analytics.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/analytics.ts) | backend код; статичен преглед |
| [api/src/services/assignees.test.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/assignees.test.ts) | test suites/assertions; изпълнение според A.4 |
| [api/src/services/assignees.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/assignees.ts) | backend код; статичен преглед |
| [api/src/services/attendance.adjustment.test.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/attendance.adjustment.test.ts) | test suites/assertions; изпълнение според A.4 |
| [api/src/services/attendance.csv.test.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/attendance.csv.test.ts) | test suites/assertions; изпълнение според A.4 |
| [api/src/services/attendance.ingest.test.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/attendance.ingest.test.ts) | test suites/assertions; изпълнение според A.4 |
| [api/src/services/attendance.rebuild.test.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/attendance.rebuild.test.ts) | test suites/assertions; изпълнение според A.4 |
| [api/src/services/attendance.stale.test.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/attendance.stale.test.ts) | test suites/assertions; изпълнение според A.4 |
| [api/src/services/attendance.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/attendance.ts) | backend код; статичен преглед |
| [api/src/services/attendanceReports.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/attendanceReports.ts) | backend код; статичен преглед |
| [api/src/services/attendanceRules.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/attendanceRules.ts) | backend код; статичен преглед |
| [api/src/services/audit.scope.test.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/audit.scope.test.ts) | test suites/assertions; изпълнение според A.4 |
| [api/src/services/audit.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/audit.ts) | backend код; статичен преглед |
| [api/src/services/authSessions.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/authSessions.ts) | backend код; статичен преглед |
| [api/src/services/cards.filter.test.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/cards.filter.test.ts) | test suites/assertions; изпълнение според A.4 |
| [api/src/services/cards.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/cards.ts) | backend код; статичен преглед |
| [api/src/services/cleaning.conflict.test.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/cleaning.conflict.test.ts) | test suites/assertions; изпълнение според A.4 |
| [api/src/services/cleaning.cycle.test.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/cleaning.cycle.test.ts) | test suites/assertions; изпълнение според A.4 |
| [api/src/services/cleaning.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/cleaning.ts) | backend код; статичен преглед |
| [api/src/services/cleaningResults.test.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/cleaningResults.test.ts) | test suites/assertions; изпълнение според A.4 |
| [api/src/services/cleaningResults.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/cleaningResults.ts) | backend код; статичен преглед |
| [api/src/services/cleaningTasksQuery.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/cleaningTasksQuery.ts) | backend код; статичен преглед |
| [api/src/services/dailyPlan.test.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/dailyPlan.test.ts) | test suites/assertions; изпълнение според A.4 |
| [api/src/services/dailyPlan.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/dailyPlan.ts) | backend код; статичен преглед |
| [api/src/services/dailyPlanEffects.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/dailyPlanEffects.ts) | backend код; статичен преглед |
| [api/src/services/dataScope.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/dataScope.ts) | backend код; статичен преглед |
| [api/src/services/hotelTime.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/hotelTime.ts) | backend код; статичен преглед |
| [api/src/services/invitations.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/invitations.ts) | backend код; статичен преглед |
| [api/src/services/issueCatalog.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/issueCatalog.ts) | backend код; статичен преглед |
| [api/src/services/jobs.lockInactive.test.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/jobs.lockInactive.test.ts) | test suites/assertions; изпълнение според A.4 |
| [api/src/services/jobs.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/jobs.ts) | backend код; статичен преглед |
| [api/src/services/locations.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/locations.ts) | backend код; статичен преглед |
| [api/src/services/maintenance.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/maintenance.ts) | backend код; статичен преглед |
| [api/src/services/myWork.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/myWork.ts) | backend код; статичен преглед |
| [api/src/services/notifications.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/notifications.ts) | backend код; статичен преглед |
| [api/src/services/operationsLive.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/operationsLive.ts) | backend код; статичен преглед |
| [api/src/services/readiness.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/readiness.ts) | backend код; статичен преглед |
| [api/src/services/roleGrants.ensure.test.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/roleGrants.ensure.test.ts) | test suites/assertions; изпълнение според A.4 |
| [api/src/services/roleGrants.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/roleGrants.ts) | backend код; статичен преглед |
| [api/src/services/sectors.transfer.test.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/sectors.transfer.test.ts) | test suites/assertions; изпълнение според A.4 |
| [api/src/services/sectors.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/sectors.ts) | backend код; статичен преглед |
| [api/src/services/settings.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/settings.ts) | backend код; статичен преглед |
| [api/src/services/settingsSchema.test.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/settingsSchema.test.ts) | test suites/assertions; изпълнение според A.4 |
| [api/src/services/settingsSchema.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/settingsSchema.ts) | backend код; статичен преглед |
| [api/src/services/shifts.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/shifts.ts) | backend код; статичен преглед |
| [api/src/services/slaPolicies.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/slaPolicies.ts) | backend код; статичен преглед |
| [api/src/services/sync.conflict.test.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/sync.conflict.test.ts) | test suites/assertions; изпълнение според A.4 |
| [api/src/services/sync.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/src/services/sync.ts) | backend код; статичен преглед |
| [api/tsconfig.json](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/api/tsconfig.json) | config/структурен контекст |
| [docker-compose.yml](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/docker-compose.yml) | config/структурен контекст |
| [web/.gitignore](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/.gitignore) | config/структурен контекст |
| [web/dev-dist/sw.js](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/dev-dist/sw.js) | generated artifact; без manual refactor |
| [web/dev-dist/workbox-290dd570.js](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/dev-dist/workbox-290dd570.js) | неизтеглен; vendor/изображение |
| [web/dev-dist/workbox-d3a36d94.js](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/dev-dist/workbox-d3a36d94.js) | неизтеглен; vendor/изображение |
| [web/index.html](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/index.html) | config/структурен контекст |
| [web/package-lock.json](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/package-lock.json) | lockfile/install; без dependency source audit |
| [web/package.json](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/package.json) | config/структурен контекст |
| [web/public/favicon.svg](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/public/favicon.svg) | asset metadata/usage; без visual QA |
| [web/public/icons.svg](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/public/icons.svg) | asset metadata/usage; без visual QA |
| [web/public/pwa-192.png](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/public/pwa-192.png) | неизтеглен; vendor/изображение |
| [web/public/pwa-512.png](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/public/pwa-512.png) | неизтеглен; vendor/изображение |
| [web/src/App.css](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/App.css) | структура/theme/imports; без пълна cascade QA |
| [web/src/App.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/App.tsx) | frontend workflow; подробен преглед |
| [web/src/api/capabilities.test.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/api/capabilities.test.ts) | test suites/assertions; изпълнение според A.4 |
| [web/src/api/capabilities.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/api/capabilities.ts) | frontend инфраструктура/логика; подробен преглед |
| [web/src/api/cleaningApi.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/api/cleaningApi.ts) | frontend инфраструктура/логика; подробен преглед |
| [web/src/api/client.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/api/client.ts) | frontend инфраструктура/логика; подробен преглед |
| [web/src/api/http.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/api/http.ts) | frontend инфраструктура/логика; подробен преглед |
| [web/src/api/liveEvents.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/api/liveEvents.ts) | frontend инфраструктура/логика; подробен преглед |
| [web/src/api/maintenanceApi.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/api/maintenanceApi.ts) | frontend инфраструктура/логика; подробен преглед |
| [web/src/api/sessionPolicy.test.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/api/sessionPolicy.test.ts) | test suites/assertions; изпълнение според A.4 |
| [web/src/api/sessionPolicy.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/api/sessionPolicy.ts) | frontend инфраструктура/логика; подробен преглед |
| [web/src/assets/hero.png](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/assets/hero.png) | неизтеглен; vendor/изображение |
| [web/src/audit/labels.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/audit/labels.ts) | frontend инфраструктура/логика; подробен преглед |
| [web/src/components/AnalyticsCharts.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/components/AnalyticsCharts.tsx) | frontend логика/AST + целеви JSX; без пълна visual QA |
| [web/src/components/AuditTimeline.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/components/AuditTimeline.tsx) | frontend логика/AST + целеви JSX; без пълна visual QA |
| [web/src/components/BrandMark.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/components/BrandMark.tsx) | frontend логика/AST + целеви JSX; без пълна visual QA |
| [web/src/components/IssueCatalogPanel.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/components/IssueCatalogPanel.tsx) | frontend логика/AST + целеви JSX; без пълна visual QA |
| [web/src/components/LocationCatalogPanel.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/components/LocationCatalogPanel.tsx) | frontend логика/AST + целеви JSX; без пълна visual QA |
| [web/src/components/LocationHistoryPanel.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/components/LocationHistoryPanel.tsx) | frontend логика/AST + целеви JSX; без пълна visual QA |
| [web/src/components/LocationIssueDialog.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/components/LocationIssueDialog.tsx) | frontend логика/AST + целеви JSX; без пълна visual QA |
| [web/src/components/LocationQrPanel.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/components/LocationQrPanel.tsx) | frontend логика/AST + целеви JSX; без пълна visual QA |
| [web/src/components/NotificationInbox.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/components/NotificationInbox.tsx) | frontend логика/AST + целеви JSX; без пълна visual QA |
| [web/src/components/OutboxIssuesPanel.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/components/OutboxIssuesPanel.tsx) | frontend логика/AST + целеви JSX; без пълна visual QA |
| [web/src/components/ScopeHint.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/components/ScopeHint.tsx) | frontend логика/AST + целеви JSX; без пълна visual QA |
| [web/src/components/SectorPanel.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/components/SectorPanel.tsx) | frontend логика/AST + целеви JSX; без пълна visual QA |
| [web/src/components/ShiftPanel.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/components/ShiftPanel.tsx) | frontend логика/AST + целеви JSX; без пълна visual QA |
| [web/src/components/TicketLifecycleActions.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/components/TicketLifecycleActions.tsx) | frontend логика/AST + целеви JSX; без пълна visual QA |
| [web/src/hooks/useLiveRefresh.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/hooks/useLiveRefresh.ts) | frontend инфраструктура/логика; подробен преглед |
| [web/src/index.css](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/index.css) | структура/theme/imports; без пълна cascade QA |
| [web/src/main.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/main.tsx) | frontend инфраструктура/логика; подробен преглед |
| [web/src/offline/commands.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/offline/commands.ts) | frontend инфраструктура/логика; подробен преглед |
| [web/src/offline/conflict.test.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/offline/conflict.test.ts) | test suites/assertions; изпълнение според A.4 |
| [web/src/offline/conflict.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/offline/conflict.ts) | frontend инфраструктура/логика; подробен преглед |
| [web/src/offline/index.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/offline/index.ts) | frontend инфраструктура/логика; подробен преглед |
| [web/src/offline/sessionRefresh.test.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/offline/sessionRefresh.test.ts) | test suites/assertions; изпълнение според A.4 |
| [web/src/offline/storage.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/offline/storage.ts) | frontend инфраструктура/логика; подробен преглед |
| [web/src/pages/ActivatePage.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/ActivatePage.tsx) | frontend логика/AST + целеви JSX; без пълна visual QA |
| [web/src/pages/AnalyticsPage.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/AnalyticsPage.tsx) | frontend логика/AST + целеви JSX; без пълна visual QA |
| [web/src/pages/AttendancePage.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/AttendancePage.tsx) | frontend логика/AST + целеви JSX; без пълна visual QA |
| [web/src/pages/AuditPage.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/AuditPage.tsx) | frontend логика/AST + целеви JSX; без пълна visual QA |
| [web/src/pages/CardsPage.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/CardsPage.tsx) | frontend логика/AST + целеви JSX; без пълна visual QA |
| [web/src/pages/CommonAreasPage.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/CommonAreasPage.tsx) | frontend логика/AST + целеви JSX; без пълна visual QA |
| [web/src/pages/ControlPage.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/ControlPage.tsx) | frontend логика/AST + целеви JSX; без пълна visual QA |
| [web/src/pages/HomePage.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/HomePage.tsx) | frontend логика/AST + целеви JSX; без пълна visual QA |
| [web/src/pages/HousekeepingPage.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/HousekeepingPage.tsx) | frontend логика/AST + целеви JSX; без пълна visual QA |
| [web/src/pages/LiveBoardPage.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/LiveBoardPage.tsx) | frontend логика/AST + целеви JSX; без пълна visual QA |
| [web/src/pages/LocationsPage.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/LocationsPage.tsx) | frontend workflow; подробен преглед |
| [web/src/pages/LoginPage.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/LoginPage.tsx) | frontend логика/AST + целеви JSX; без пълна visual QA |
| [web/src/pages/MyWorkPage.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/MyWorkPage.tsx) | frontend workflow; подробен преглед |
| [web/src/pages/NotificationsPage.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/NotificationsPage.tsx) | frontend логика/AST + целеви JSX; без пълна visual QA |
| [web/src/pages/PermissionsPage.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/PermissionsPage.tsx) | frontend логика/AST + целеви JSX; без пълна visual QA |
| [web/src/pages/PlanPage.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/PlanPage.tsx) | frontend логика/AST + целеви JSX; без пълна visual QA |
| [web/src/pages/RepairsPage.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/RepairsPage.tsx) | frontend workflow; подробен преглед |
| [web/src/pages/ResultsPage.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/ResultsPage.tsx) | frontend логика/AST + целеви JSX; без пълна visual QA |
| [web/src/pages/RoomQrPage.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/RoomQrPage.tsx) | frontend логика/AST + целеви JSX; без пълна visual QA |
| [web/src/pages/RoomsPage.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/RoomsPage.tsx) | frontend логика/AST + целеви JSX; без пълна visual QA |
| [web/src/pages/SettingsPage.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/SettingsPage.tsx) | frontend логика/AST + целеви JSX; без пълна visual QA |
| [web/src/pages/TeamPage.tsx](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/pages/TeamPage.tsx) | frontend логика/AST + целеви JSX; без пълна visual QA |
| [web/src/theme.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/theme.ts) | frontend инфраструктура/логика; подробен преглед |
| [web/src/vite-env.d.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/src/vite-env.d.ts) | config/структурен контекст |
| [web/tsconfig.json](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/tsconfig.json) | config/структурен контекст |
| [web/tsconfig.tsbuildinfo](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/tsconfig.tsbuildinfo) | config/структурен контекст |
| [web/vite.config.ts](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/web/vite.config.ts) | config/структурен контекст |
| [референция](https://github.com/perikliev00/Maintenance/blob/16d1b61aded6a3a19b598f9531e06ea469bf6bef/референция) | релевантни секции/контекст; частично |
