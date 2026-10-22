# Одит: съществени непокрити тестови сценарии

**Дата:** 22 октомври 2026  
**Базов commit (HEAD / `main`):** `8d4f1465af8e3fa3586844250f89b7fbaa4bb216`  
**Работно дърво:** включва некоментирани production-hardening и mutation артефакти (разгледани статично заедно с `main`)  
**Режим:** READ-ONLY — без промени по код, тестове, конфигурация или състояние на проекта; единственият нов артефакт е този доклад.  
**Метод:** статичен преглед на имплементация ↔ съществуващи unit / integration / HTTP / E2E / mutation доказателства; кръстосана сверка с предишни одити (`maintenance-independent-bug-audit.md`, `remaining-gaps-progress.md`, `MUTATION_TESTING_REPORT.md`, `project-audit-review-2026-10-22.md`).

---

## 1. Обобщение

Проектът има **плътно, целенасочено покритие** на критичните риск зони: auth/CSRF/SSE, data-scope/RoleGrant, cleaning concurrency, ticket lifecycle/SLA, attendance ingest, cards idempotency, offline conflict/connState/drain identity, и background job семантика. Документираните P0/P1 concurrency сценарии и targeted mutation scores (~99% за критичните модули) подкрепят тази оценка.

Целта на този одит **не** беше да изброи всеки липсващ unit тест, а да установи дали има **реалистични, съществени** сценарии, чиято липса на автоматизирана проверка създава обоснован риск.

**Установени съществени пропуски:** 4  
**Critical:** 0 · **High:** 2 · **Medium:** 2

Не са установени Critical пропуски. Най-важният High пропуск е **непълната regression защита за AUDIT-003** (assignee gate през `/sync/push`). Останалите са конкретни wiring/fail-closed пропуски с ясна тестова стойност.

Този доклад **не** е гаранция за пълно покритие или отсъствие на дефекти.

---

## 2. Анализ на съществуващото тестово покритие

### 2.1 Инвентар (приблизително)

| Слой | Обхват | Роля |
| --- | --- | --- |
| API unit (`api/src/**/*.test.ts`) | ~50+ файла | Домейн правила, middleware, jobs lock/scheduler, env/demo-seed |
| API integration (`api/tests/**`) | ~50+ файла | HTTP/DB concurrency, lifecycle, sync, SSE, tickets, cleaning, attendance, cards |
| Web unit (`web/src/**/*.test.ts`) | ~11 файла | sessionPolicy, offline (conflict/connState/drain/scenarios/…), capabilities, location permissions |
| E2E (Playwright) | ~20 spec файла | login/CSRF, workflows, offline queue, role kickout, repairs/readiness flows |
| Mutation (targeted) | API/Web ~99% | attendanceRules, dataScope/where, readiness, conflict, connState, sessionPolicy |

Пълен Web mutation scope (~5.68%) показва широки NoCoverage gaps в TSX; това **не** се третира автоматично като съществен непокрит сценарий — UI поведението за ключови flows е частично защитено от E2E, а одитът търси конкретен риск, не „всеки TSX без unit тест“.

### 2.2 Зони с адекватно покритие (без констатация)

| Зона | Доказателства (представителни) | Заключение |
| --- | --- | --- |
| Auth / CSRF / session / refresh | `session.csrf.http.test.ts`, `authSessions.*.test.ts`, `auth.logout*.test.ts`, `e2e/cookie-csrf-mutate.spec.ts` | Адекватно |
| SSE authorization / delivery races | `sse.authorization.db.test.ts`, `sse.http.test.ts`, `authorizeLiveEvent.test.ts`, P1-115 VERIFIED | Адекватно |
| Data scope / RoleGrant | `scope.http.test.ts`, `roleGrants/*.test.ts`, `permissions.roleAssignment.test.ts` | Адекватно |
| Cleaning lifecycle + concurrency | `lifecycle.*.test.ts`, `assignment.serialization.test.ts`, `cleaning-replay.db.test.ts` | Адекватно |
| Ticket REST transitions / SLA / idempotency | `transitions.matrix`, `idempotency.concurrency`, `sla.lifecycle`, `assignee.gate.http` | REST слой адекватен |
| Attendance concurrency / DST / adjustments | `ingest.concurrency`, `dst/overnight/late-events`, `adjustments.*` | Адекватно |
| Cards issue/revoke | `issue.*.http.test.ts`, `revoke.idempotency.http.test.ts` | Адекватно |
| Offline conflict / connState / identity / mid-drain | web offline `*.test.ts`, `e2e/.../offline.spec.ts`, `mid-drain-switch.spec.ts` | Адекватно с изключение на §3.2 |
| Job domain (overdue, SLA breach, scheduler overlap) | `jobs.db.test.ts`, `scheduler.test.ts`, `executionLock.test.ts` | Домейн адекватен; HTTP wiring — §3.4 |
| Demo-seed fail-closed | `demoSeedGuard.test.ts` | Адекватно |
| JWT insecure/short refuse in production | `security.http.test.ts` (P1-128) | Частично; остатък — §3.3 |

### 2.3 Прегледани, но изключени като недостатъчно съществени

Следните липси **не** влизат като констатации, защото не отговарят на критериите от задачата (реалистичен риск + реална стойност от нов тест):

- **Широки Web TSX unit gaps** — mutation NoCoverage; без конкретен бизнес/сигурностен сценарий, който E2E/API не покриват косвено.
- **`createOwner.ts` opt-in gate** — еднократен operator CLI с advisory lock и отказ при съществуващ owner; изисква shell/compose достъп; покрит оперативно от `deploy.md` / `compose.prod.yml`. Липсата на unit тест е реална, но практическата стойност е ниска спрямо бара на одита.
- **`bootstrap.ts` / `observability.ts` / graceful shutdown wrappers** — тънки обвивки; readiness/`setShuttingDown` са покрити в `app.health.test.ts`; scheduler stop е тестван.
- **Multi-process job locking** — by design in-process; не е непокрит сценарий, а архитектурно ограничение (вече документирано в production одита).

---

## 3. Установени съществени непокрити сценарии

### 3.1 [High] Sync `/sync/push` — assignee gate / bypass regression (AUDIT-003)

1. **Функционалност:** Offline sync на ticket lifecycle (start/wait/resume/resolve) и паритет с REST assignee authorization.  
2. **Локация:**
   - `api/src/services/sync/commands/tickets.ts` — `handleTicketStart/Wait/Resume/Resolve` подават `bypassAssigneeCheck: canBypassTicketAssignee(user.role)` (напр. редове 87–91, 114–118, 145–149, 172–176).
   - `api/src/services/maintenance/authorization.ts` — `canBypassTicketAssignee`.
   - Домейн отказ без bypass: `api/src/services/maintenance/progress.ts` / `resolveClose.ts`.
3. **Непокрит сценарий:**
   - Privileged роля (manager/supervisor/…) **прогресира чужд assigned ticket** през `/sync/push` (позитивен bypass).
   - Non-bypass роля (technician) е **отказана** за чужд ticket през `/sync/push` (негативен контрол).
4. **Съществуващо покритие:**
   - REST негативен/позитивен gate: `api/tests/tickets/assignee.gate.http.test.ts` (T-TKT-03 / P1-39).
   - Sync happy-path batch: `api/tests/scenarios/sync.http.test.ts` P1-104 — owner изпълнява start→resolve, но ticket-ът е **assigned към същия owner** (`assigneeId: world.owner.employeeId`), т.е. **не упражнява bypass**.
   - Cleaning assignee recheck през sync: P1-105–107 (друг домейн).
   - AUDIT-003 в `docs/audits/maintenance-independent-bug-audit.md` изрично препоръчва sync HTTP regression + technician negative control — **не е напълно реализирана**.
5. **Причина за пропуска:** REST тестовете не минават през sync handlers. P1-104 доказва wiring на command types, но не assignee-bypass семантиката. Регресия към `bypassAssigneeCheck: true` константа или към пропускане на флага няма да се хване от текущите sync тестове.
6. **Реален риск:**
   - Повторение на AUDIT-003 класа: privileged offline команди остават `forbidden`, докато online работят (операционен дефект).
   - Или обратното: разширяване на bypass през sync → неоторизиран прогрес на чужди тикети по основния offline път.
7. **Необходим вид тест:** **API / Integration (HTTP)** срещу реален `/sync/push` + DB fixtures (не чист unit на `canBypassTicketAssignee`).  
8. **Обосновка:** Дефектът е във wiring между sync adapter и domain flags; unit на helper-а не доказва HTTP/sync пътя. E2E би бил по-скъп и по-нестабилен за същата assertion.  
9. **Примерен тестов сценарий:**
   - **Setup:** Ticket assigned към technician A; потребители A (tech), B (tech), M (manager) със scope върху локацията.
   - **Действия:** `POST /sync/push` като B с `ticket.start` → очаквай `results[0].status === "forbidden"`, без state change.
   - `POST /sync/push` като M с start→wait→resume→resolve → очаквай `ok` и същите статуси както REST с bypass.
   - Сравни финален ticket graph с еквивалентен REST control (по желание).
10. **Приоритет:** **High**  
11. **Доказателства:** `tickets.ts` sync handlers; P1-104 assignee=owner; `assignee.gate.http.test.ts` само REST; AUDIT-003 §B recommended regression.

---

### 3.2 [High] Web offline drain — URL→entity id enrichment (`commandPayload`)

1. **Функционалност:** Offline queue drain → `/sync/push` payload construction.  
2. **Локация:** `web/src/offline/queueDrain.ts` — функция `commandPayload` (редове 76–89): извлича `taskId` / `sessionId` / `ticketId` от `item.url` чрез `split("/tasks/"|"/sessions/"|"/tickets/")`.  
3. **Непокрит сценарий:** При enqueue builders в `web/src/offline/commands.ts` body съдържа `commandId` (+ optional notes/version), **без** `taskId`/`ticketId`/`sessionId`. Коректният sync batch **зависи** от URL enrichment в `commandPayload`. Никой тест не assert-ва формата на изпратения push payload за cleaning/ticket lifecycle.  
4. **Съществуващо покритие:**
   - Подобен (но **друг**) URL/id parser: `entityIdFromQueued` в `conflict.ts` + обширни `conflict.test.ts` кейсове.
   - `queueDrain.test.ts` / `scenarios.test.ts` / E2E offline: mock-ват успешен `/sync/push`, проверяват commandId/status/switch behavior — **не** payload shape.
5. **Причина за пропуска:** Enrichment логиката е private в drain пътя; conflict тестовете не изпълняват `commandPayload`; mock-натите drain тестове крият API validation failures.  
6. **Реален риск:** Регресия в splitter-а (напр. смяна на URL shape, query/hash, грешен segment) → sync команди без `ticketId`/`taskId` → systematic offline sync failure за cleaning/ticket lifecycle след reconnect, трудно забележим от UI unit suite.  
7. **Необходим вид тест:** **Unit** на drain/payload (inject fake queue + capture `fetch` body) и/или тънък **contract** assert, че lifecycle push съдържа entity ids.  
8. **Обосновка:** Чиста трансформация URL+body→payload; unit с captured fetch е най-евтиният и детерминистичен. E2E срещу реален API би хванал симптома, но по-късно и по-скъпо; съществуващите E2E mock-и не го правят.  
9. **Примерен тестов сценарий:**
   - **Вход:** QueuedAction `type: "ticket.start"`, `url: "/api/maintenance/tickets/t-9/start"`, `body: { commandId }`.
   - **Действие:** `drainQueue` с mock fetch.
   - **Очакван резултат:** Request JSON съдържа `commands[0].payload.ticketId === "t-9"` (и аналогично за `cleaning.start` → `taskId`, `cleaning.complete` → `sessionId`).
   - Негатив: URL без `/tickets/` сегмент → липса на `ticketId` (или ясен fail path).
10. **Приоритет:** **High**  
11. **Доказателства:** `commands.ts` (body без entity ids); `queueDrain.ts` `commandPayload`; липса на `payload`/`ticketId` assertions в `queueDrain.test.ts`; `conflict.test.ts` покрива само `entityIdFromQueued`.

---

### 3.3 [Medium] Production `assertEnv` — непълна матрица на fail-closed откази

1. **Функционалност:** Startup fail-closed за production конфигурация.  
2. **Локация:** `api/src/env.ts` — `assertEnv()` production клон (редове 32–67): `DATABASE_URL` postgres, HTTPS `WEB_ORIGIN`, `TRUST_PROXY=1`, JWT без `"demo"`, забрана на `COOKIE_SECURE=false`, плюс вече тестваните JWT/E2E rate-limit правила.  
3. **Непокрит сценарий:** Автоматични **rejection** кейсове за:
   - липсващ/не-postgres `DATABASE_URL`;
   - production `WEB_ORIGIN` с HTTP или празен allowlist;
   - `TRUST_PROXY !== "1"`;
   - JWT съдържащ `"demo"`;
   - `COOKIE_SECURE=false`.
4. **Съществуващо покритие:**
   - `api/src/env.test.ts`: `E2E_DISABLE_RATE_LIMIT` в production; malformed `PORT`.
   - `api/tests/scenarios/security.http.test.ts` P1-128: missing / example / short JWT (+ child process refuse before listen).
   - Happy-path `assert.doesNotThrow` при валиден secret предполага останалите prod vars са зададени в средата, но **не assert-ва** отказните клонове.
5. **Причина за пропуска:** Тестовете покриват JWT insecurity и един E2E flag, не пълната production hardening матрица добавена с ops работата.  
6. **Реален риск:** Регресия (премахнат/разхлабен check) позволява API да стартира в production с HTTP origin, insecure cookies или без trust-proxy — класически deploy misconfig с security impact; открива се късно (или никога) без startup тест.  
7. **Необходим вид тест:** **Unit** разширение на `env.test.ts` (таблица от env fixtures → expected throw message). По желание един child-process smoke като P1-128 за най-критичния HTTPS/TRUST_PROXY кейс.  
8. **Обосновка:** Чиста синхронна валидация без I/O; unit е достатъчен и стабилен. Integration/E2E не добавят стойност.  
9. **Примерен тестов сценарий:** За всеки ред: базов валиден prod env → мутирай едно поле → `assert.throws(assertEnv, /…/)`. Включи позитивен контрол с пълен валиден набор.  
10. **Приоритет:** **Medium**  
11. **Доказателства:** `env.ts` 32–67; `env.test.ts` само 2 кейса; `security.http.test.ts` само JWT ветви.

---

### 3.4 [Medium] `POST /jobs/run` — HTTP wiring на shared execution lock (409)

1. **Функционалност:** Ръчен trigger на background jobs през HTTP, сериализиран със scheduler.  
2. **Локация:** `api/src/controllers/jobs.ts` — `run()` вика `runWithJobExecutionLock(job)` и при `!acquired` връща `409 { error: "job_already_running" }` (редове 63–64). Route: `api/src/routes/jobs.ts` (`requireAction("jobs.view")`).  
3. **Непокрит сценарий:** Concurrent/manual HTTP trigger докато lock е държан → **409**; контролерът продължава да ползва споделения lock (не само scheduler пътя).  
4. **Съществуващо покритие:**
   - Lock primitive: `api/src/services/jobs/executionLock.test.ts`.
   - Scheduler non-overlap: `scheduler.test.ts`, `api/tests/scenarios/scheduler.test.ts`.
   - Job семантика/идемпотентност: `api/tests/scenarios/jobs.db.test.ts`.
   - **Няма** `api/tests/**` или e2e попадение на `/jobs/run` / `job_already_running`.
5. **Причина за пропуска:** Тестовете валидират lock модула и scheduler интеграцията, но не HTTP контролера, който е вторият вход към същия lock.  
6. **Реален риск:** Регресия, която маха lock-а от контролера → припокриващи се scheduled + manual цикли. Домейн jobs са до голяма степен идемпотентни (напр. SLA 12h dedupe), затова severity е Medium, не High — но wiring-ът е единственият нетестван вход за „duplicate runs“.  
7. **Необходим вид тест:** **API / Integration HTTP** — задръж lock (или mock/long-running job), втори `POST /jobs/run` → 409; след release → 200. Auth negative (без `jobs.view`) е полезен, но вторичен.  
8. **Обосновка:** Целта е да се докаже controller wiring + status contract; unit на lock вече съществува и не е достатъчен сам.  
9. **Примерен тестов сценарий:**
   - Login като роля с `jobs.view`.
   - Стартирай job, който държи lock (или `runWithJobExecutionLock` barrier в процеса на теста).
   - Паралелен `POST /jobs/run` `{ "jobKey": "overdue_sessions" }` → `409` / `job_already_running`.
   - След освобождаване → успешен run с очакван JSON shape.
10. **Приоритет:** **Medium**  
11. **Доказателства:** `controllers/jobs.ts` 63–64; `executionLock.test.ts` без HTTP; grep в `api/tests` за `/jobs/run` / `job_already_running` — 0 попадения.

---

## 4. Приоритизация

| ID | Приоритет | Сценарий | Препоръчан вид тест |
| --- | :---: | --- | --- |
| 3.1 | **High** | Sync assignee bypass / denial parity (AUDIT-003 regression) | API/Integration HTTP (`/sync/push`) |
| 3.2 | **High** | Offline `commandPayload` URL→id enrichment | Unit (drain + captured fetch) |
| 3.3 | **Medium** | Production `assertEnv` rejection matrix | Unit (`env.test.ts`) |
| 3.4 | **Medium** | `POST /jobs/run` shared lock → 409 | API/Integration HTTP |

Препоръчан ред на работа: **3.1 → 3.2 → 3.3 → 3.4**.

---

## 5. Заключение

След доказателствено обоснован преглед **са установени четири съществени непокрити сценария**, които оправдават добавяне на автоматизирани тестове. Критичните домейн пътища (auth, scope, cleaning concurrency, ticket REST, attendance, cards, job semantics, по-голямата част от offline hardening) са **адекватно покрити** и не генерират допълнителни констатации.

Най-значимият пропуск е **непълната sync regression за assignee gate** спрямо вече потвърдения AUDIT-003 и неговата препоръчана тестова стратегия. Вторият High пропуск е **нетестваното URL enrichment** при offline drain — критичен мост между enqueue формата и sync API контракта.

Не са установени Critical пропуски. Добавянето на тестове извън горния списък (напр. широки TSX unit suites „за mutation score“) **не** се препоръчва като приоритет на базата на този одит.

### Ограничения на анализа

- Не са изпълнявани test suites, mutation runs или E2E в тази сесия (read-only; избягване на промяна на състояние).
- Разчита се на статичен code review + съдържанието на тестовите файлове + предишни документирани резултати.
- Не е правен live penetration/load тест; multi-replica job ownership е извън scope като архитектурен лимит, не като липсващ тест.
- Working-tree hardening файлове са включени в прегледа; някои тестове (`env.test.ts`, `executionLock.test.ts`) може да са част от некоментирани промени — констатациите важат за текущото дърво към датата на одита.

---

*Край на доклада.*
