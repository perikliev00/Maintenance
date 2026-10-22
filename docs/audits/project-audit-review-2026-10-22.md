# Meridian Maintenance — пълен одит и ревю на проекта

**Дата на одита:** 22 октомври 2026  
**Базов commit (HEAD / `main`):** `8d4f1465af8e3fa3586844250f89b7fbaa4bb216`  
**Работно дърво:** значителен набор некоментирани production-hardening, mutation-testing и ops артефакти (виж §H)  
**Метод:** документален + статичен преглед на кода и инфраструктурата; **без** промени по код, конфигурация или тестове. Не са пускани нови suite-ове в рамките на този одит.

**Първични входни документи:**

| Документ | Роля в одита |
| --- | --- |
| `docs/operations/deploy.md` | Staging/prod deploy контракт, роли, rollback |
| `docs/operations/status-2026-10-21.md` | Локална верификация на hardening (2026-10-21) |
| `docs/testing/MUTATION_TESTING.md` | Архитектура и процес за Stryker |
| `docs/testing/MUTATION_TESTING_REPORT.md` | Измерени mutation scores и слабости |
| `docs/audits/maintenance-independent-bug-audit.md` | Предишни P1/P2 находки (2026-10-20) |
| `docs/audits/remaining-gaps-progress.md` | Статус на concurrency/auth gap сценарии |

---

## A. Executive summary

Проектът е зрял домейн продукт (housekeeping + maintenance) с **силна защитна инженерия**: транзакции, row locks, idempotency, data-scope, CSRF/session, SSE authorization, offline sync, и обширна изолирана тестова база. На `main` (`8d4f146`) са затворени трите потвърдени дефекта от независимия bug audit (deadlock при cleaning start/reassign; UI ticket gates; offline assignee bypass).

Върху този commit в working tree е добавен **пълен production-readiness слой**: fail-closed env/demo-seed, bootstrap/owner команди, health/metrics/graceful shutdown, job serialization, Compose prod топология, CI release/deploy workflows, monitoring, backup/restore и runbook-и. Локалната верификация от 2026-10-21 докладва зелени build/test/E2E и успешен Docker build — **без commit и без реален staging/prod deploy**.

**Вердикт:** кодът е готов за **контролиран staging go-live**, при условие че операторът затвори инфраструктурните празнини (секрети, DB роли, GHCR/GH Environments, DNS/TLS, backup drill, alert webhook). Не е готов за невнимателен multi-replica prod scale-out. Mutation testing покрива критичните модули отлично (~99%), но широкият web scope показва големи coverage gaps в TSX.

| Категория | Оценка | Коментар |
| --- | :---: | --- |
| Домейн коректност / concurrency | Висока | Много P0/P1 сценарии VERIFIED; AUDIT-001..003 remediирани на `main` |
| AuthZ / data scope | Висока | Action grants + scope re-check; UI вече през `canPerformAction` |
| Offline / sync | Висока (с остатъчни рискове) | Assignee bypass изравнен; outbox/conflict hardening в tree |
| Test / mutation quality | Висока (targeted) / ниска (full web) | Targeted ~99%; full web 5.68% заради NoCoverage |
| Production packaging | Висока (в tree) | Compose hardening, роли, images — некоментирано |
| Ops readiness (live) | Средна / блокирана от среда | Workflows и runbook-и готови; GH auth, DNS, secrets, drills — не |
| Scalability | Ограничена by design | API `replicas: 1` до споделен SSE/rate-limit/cache/job ownership |

**Потвърдени отворени P0 в този преглед:** 0  
**Критични блокиращи за prod (оперативни, не код):** секрети/роли/GHCR/DNS + smoke през Caddy + backup restore drill.

---

## B. Обхват и ограничения на този одит

### Включено

- Преглед на deploy/status/mutation документи и свързани ops runbook-и.
- Статична проверка на production Compose, env validation, demo-seed guard, owner bootstrap, observability, security middleware, job lock, deploy/release/CI workflows.
- Сверка на предишните AUDIT-001/002/003 срещу текущия код на `main` + working tree.
- Оценка на mutation posture и test evidence от документираните runs.

### Изключено / невалидирано тук

- Повторно изпълнение на API/web/E2E/mutation suites в тази сесия.
- Remote GitHub Actions, GHCR push, staging/prod SSH deploy.
- Live TLS, публичен Caddy smoke, реален S3 backup/restore, alert webhook delivery.
- Penetration test, load test, multi-device offline полеви тест.
- Пълна линия по линия на всички ~260 API source файлове и всички web TSX екрани.

---

## C. Архитектура и продуктов профил

**Стек:** Express + Prisma/PostgreSQL API; React/Vite web; Playwright E2E; Caddy reverse proxy; optional Prometheus/Grafana/Alertmanager.

**Домейн ядро:** readiness композиция, cleaning lifecycle + inspection, maintenance tickets + SLA, sectors/shifts/roster, daily plan, attendance, cards, RoleGrant матрица, data scope („мои сектори“), live SSE, offline command queue/sync.

**Силни страни на дизайна:**

1. Ясно разделение HTTP controller ↔ domain service ↔ sync command handlers.
2. Идемпотентни команди (`commandId`) за offline/retry.
3. Стабилен lock ordering в критични пътища (User преди task/location където е нужно за SSE/concurrency).
4. Capability модел: `panels` / `actions` / landing + DB-driven RoleGrant.
5. Production топология с разделени DB роли (migration / runtime / bootstrap / metrics) и internal backend network.

---

## D. Статус на предишни defect findings

Референция: `docs/audits/maintenance-independent-bug-audit.md` (20 Oct 2026) и commit `8d4f146` („Fix audit findings…“).

| ID | Severity | Заглавие | Статус към 22 Oct 2026 |
| --- | :---: | --- | --- |
| AUDIT-001 | P1 | Cleaning start ↔ reassign deadlock (обратен lock order) | **Remediated** — `startCleaningTask` заключва starter (`assertActiveWorkStarter`) **преди** `lockTask`; reassign запазва User → Task. Коментарите в кода изрично документират deadlock-safe реда. |
| AUDIT-002 | P2 | UI ticket controls игнорират `user.actions` | **Remediated** — `HomePage`, `RepairsPage`, `ControlPage`, `MyWorkPage`, `locations/permissions` ползват `canPerformAction`. Legacy helpers остават само като fallback вътре в `canPerformAction`. |
| AUDIT-003 | P2 | Offline sync губи `bypassAssigneeCheck` | **Remediated** — споделен `canBypassTicketAssignee` в `services/maintenance/authorization.ts`; HTTP controller и sync handlers (`ticket.start/wait/resume/resolve`) подават един и същ флаг. |

**Оценка:** независимият bug audit е бил точен; remediation commit затваря потвърдените дефекти. Този одит **не** преизпълни concurrency reproductions; разчита на code review + документираните regression suites от `remaining-gaps-progress.md`.

### Gap progress (concurrency / auth)

`remaining-gaps-progress.md` показва голям брой сценарии като **VERIFIED** (P0-06, P1-03/04/08/11/12/15/21/25/27/29/35/44/46/68/115, P2-43 и др.), с няколко „Final regression running“ към момента на записа. За production readiness това означава: concurrency/auth повърхността е **силно покрита с детерминистични DB тестове**, но операторът трябва да потвърди, че всички „final regression“ редове са затворени преди go-live checklist.

---

## E. Production hardening (работно дърво + документи)

Източник: `status-2026-10-21.md`, `deploy.md`, `compose.prod.yml`, `api/src/env.ts`, `demoSeedGuard.ts`, `createOwner.ts`, `index.ts`, workflows.

### E.1 Какво е имплементирано (в tree / docs)

| Област | Наблюдение |
| --- | --- |
| Env fail-closed | Production изисква PostgreSQL URL, HTTPS `WEB_ORIGIN`, `TRUST_PROXY=1`, силен JWT (≥32, не denylist, без „demo“), забранява `E2E_DISABLE_RATE_LIMIT` и `COOKIE_SECURE=false`. |
| Demo seed | `assertDemoSeedAllowed` — disabled в production; изисква `ALLOW_DEMO_SEED=true` + exact disposable DB name match. |
| Bootstrap / owner | Отделни image targets; owner creation зад profile + `ALLOW_INITIAL_OWNER_CREATION` + advisory lock; без password в логове. |
| Health / shutdown | `/health/live`, `/health/ready`; graceful SIGTERM (SSE close, scheduler stop, 25s timeout). |
| Observability | Structured JSON logs с request id; Prometheus metrics (HTTP, sync, jobs, SSE, event-loop); alert rules за 5xx, DB, jobs, SSE, sync, stale backup. |
| Jobs | In-process `runWithJobExecutionLock` — сериализация на scheduled + operator runs в един процес. |
| Compose security | `read_only` API + tmpfs; `cap_drop: ALL`; `no-new-privileges`; mem/cpu/pids limits; backend `internal: true`; Postgres не публикува 5432. |
| Images / release | Multi-target Dockerfile; release workflow tag-ва по SHA с SBOM/provenance; deploy изисква успешен CI run за SHA. |
| Backup / recovery | `backup-db.sh` / `restore-db.sh` / `verify-restore.sh`; age encryption; disposable restore gates; RPO/RTO targets документирани. |
| Dependabot | Weekly npm (api/web/e2e) + GitHub Actions. |

### E.2 Локална верификация (status-2026-10-21) — приета като evidence

| Check | Result (документиран) |
| --- | --- |
| API unit/integration | 323 passed |
| Web unit | 112 passed |
| Playwright scenarios | 52 passed |
| Cleaning lifecycle | 51 passed (`maintenance_p1_test`) |
| Compose parse + Docker build | API/migrate/bootstrap/owner/web targets OK |
| npm audit (API runtime image) | 0 high/critical; 2 moderate в пълното dependency tree |
| Caddy / Grafana JSON / S3 lifecycle JSON | validation passed |

**Бележка:** тестовете са минали след override на недостъпен `127.0.0.1:55439` към съществуваща изолирана DB на `:5433`. Web bundling все още докладва съществуващи static/dynamic import warnings в offline модули.

### E.3 Отворени оперативни блокери (не код)

От `status-2026-10-21.md` и `deploy.md` — все още **изискват deployment environment**:

1. GitHub: permissions, GHCR, Environment protection, staging/prod SSH secrets (`DEPLOY_*`), `gh` auth за remote workflow inspection.
2. DNS + TLS за `APP_DOMAIN`; host firewall 80/443 (+ UDP 443).
3. Външни PostgreSQL роли/grants (migration / runtime / bootstrap / metrics) — не само Compose admin user.
4. Secret manager стойности (не placeholders от `.env.production.example`).
5. One-shot `create-owner` след migrate/bootstrap.
6. Staging smoke през публичен Caddy: login/CSRF, SSE > 2×25s heartbeat, offline outbox по време на release, SW/asset update.
7. Production-like DB privilege test; live S3 backup/restore drill; alert webhook + external uptime/dead-man.
8. Key custody за age encryption и S3 retention policy.

**Оценка:** приложението е „packaged for production“; **организацията още не е „operated in production“**.

---

## F. Deploy / release / rollback ревю

### F.1 Силни страни на контракта (`deploy.md` + workflows)

- Immutable SHA tagging; deploy валидира 40-char SHA и успешен CI `push` run.
- Deploy concurrency per environment без cancel-in-progress (избягва прекъсване на migrate mid-flight).
- Migrate → bootstrap → API → web dependency chain; failed migrate блокира API.
- Rollback = предишни image digests / `RELEASE_SHA`; изрично: Prisma migrations **не** се reverse-ват автоматично → expand/contract задължителен.
- Demo seed забранен при rollback; owner creation не е част от нормалния deploy.

### F.2 Рискове и несъответствия

| ID | Severity | Находка |
| --- | :---: | --- |
| OPS-001 | P2 | `deploy.md` препоръчва promote на **същите registry digests без rebuild на host**; `deploy.yml` прави `git checkout` + `docker compose pull` + `up -d --no-build`. Това е добро, но checked-in Compose също има `build:` блокове — локален `compose build` на prod host остава възможен операторски грешен път. Нужна е дисциплина / deployment tooling, което пише само `image:`. |
| OPS-002 | P2 | API е **умишлено 1 replica**. In-process rate limits, SSE fan-out, settings cache invalidation и `executionLock` **не** са cross-process. Хоризонтално скалиране без Redis/bus/advisory job lease би довело до дублирани jobs, неконсистентни rate limits и разкъсани live events. |
| OPS-003 | P2 | Job lock е process-local (`activeExecution` Promise). При бъдещ multi-instance това е silent correctness bug, не само perf. Документирано в deploy.md, но трябва да остане hard gate в runbook. |
| OPS-004 | P3 | Compose вгражда Postgres volume (`pgdata`). Docs предпочитат managed/private endpoint. За hotel prod е по-безопасно managed Postgres + отделен backup identity; bundled DB е OK за self-host при стриктно backup/PITR. |
| OPS-005 | P3 | Release workflow trigger-ва на успешен CI на `main`, но production hardening **още не е commit-нат** — remote pipeline за новите файлове не е доказан. |
| OPS-006 | P3 | Alertmanager default webhook е non-routable fallback — правилно fail-visible, но лесно да се забрави в go-live checklist. |

### F.3 Rollback maturity

Добър за **application** rollback. **Schema** rollback е съзнателно ръчен (forward-fix / approved recovery). Това е правилна политика; изисква миграционна дисциплина и staging migrate rehearsal преди всяка destructive schema промяна.

---

## G. Сигурност — ревю

### G.1 Положителни контроли

- Helmet + named rate limiters (login по IP+email, invitation, global); health/metrics извън global budget.
- `TRUST_PROXY` opt-in; production enforce.
- Cookie secure defaults; CSRF session тестове документирани като минали в предишни одити.
- SSE authorization ordering hardened (P1-115 VERIFIED) с User/Sector share locks през delivery.
- Metrics DB URL отделен read-only/`pg_monitor` intent.
- Log redaction за DB URLs / Bearer / password-like fields.
- Owner bootstrap password ≥16 chars, bcrypt cost 12, advisory lock.
- Restore scripts reject production mode и common live DB names.

### G.2 Остатъчни рискове / наблюдения

| ID | Severity | Находка |
| --- | :---: | --- |
| SEC-001 | P2 (ops) | Rate limiting е in-memory per process — приемливо при 1 replica; при scale-out е bypassable през друг instance. |
| SEC-002 | P3 | `canResolveIssues` / `canAssignIssues` / `canCloseIssues` все още експортирани от client barrel — риск от бъдещ regression ако UI отново ги извика директно. Препоръка: deprecate/discourage в code review checklist (без задължителна промяна сега). |
| SEC-003 | P3 | Cleaning controller все още подава `bypassAssigneeCheck: isOwner(...)` на места — по-тясно от ticket `canBypassTicketAssignee(role)`. Не е потвърден дефект; заслужава domain consistency review дали supervisor трябва същия bypass offline/online за cleaning. |
| SEC-004 | Info | 2 moderate npm findings в пълното API tree — следене чрез Dependabot; не блокират според status doc. |
| SEC-005 | Info | Няма конфигуриран lint script в пакетите (mutation report) — style/security lint gate липсва в CI. |

**Не са намерени** в този статичен преглед: очевиден CSRF bypass, публикуван Postgres порт в prod Compose, production demo seed path, или hardcoded production secrets в tracked example (placeholders only).

---

## H. Working-tree / release hygiene

Към момента на одита:

- `main` == `origin/main` @ `8d4f146`.
- Голям volume **uncommitted** промени: CI, Dockerfiles, `compose.prod.yml`, env/bootstrap/observability/jobs hardening, mutation configs, `docs/operations/*`, `docs/testing/*`, `infra/*`, `scripts/*`, Dependabot, README edits, offline conflict/connState fixes и др.
- Status doc изрично предупреждава: pre-existing mutation-testing edits бяха запазени; **нищо не е commit-нато**.

**Риск:** staging deploy docs предполагат immutable SHA от Git, но hardening слойът **не е в Git history**. Докато не се commit/PR/merge, release/deploy workflows на remote не покриват реалното intended production състояние.

**Препоръка (процес, без действие в този одит):** един или няколко фокусирани PR-а — (1) prod packaging + ops docs, (2) mutation tooling + report, (3) останали test/offline fixes — с чист `git status` review преди staging.

---

## I. Mutation testing и качество на тестовете

Източници: `MUTATION_TESTING.md`, `MUTATION_TESTING_REPORT.md`, status counts.

### I.1 Targeted (критична логика) — отличен сигнал

| Package | Mutants (scored) | Mutation score | Covered score | Survivors |
| --- | ---: | ---: | ---: | ---: |
| API targeted | 300 scored (+122 compile err) | **98.67%** | 98.67% | 4 (еквивалентни) |
| Web targeted | 273 scored (+172 compile err) | **98.90%** | 98.90% | 3 (еквивалентни) |

Покрити домейни: attendance rules, data-scope where, role-grant normalize, cleaning deriveServiceType, readiness; web sessionPolicy, offline conflict/connState, location permissions.

Survivors са прегледани като behavioral equivalents за текущия контракт — добра практика.

### I.2 Full scope — различен смисъл

| Run | Резултат |
| --- | --- |
| Full Web | 11 843 mutants; score **5.68%** / covered **61.70%**; **8 139 NoCoverage** (вкл. 6 265 в TSX) |
| Full API | Спрян: ~21–40h ETA при single-worker DB isolation; **няма** пълен score |

Интерпретация: ниският full-web score е **coverage map**, не регресия на targeted модулите. Полезност: приоритизира къде да се добавят component/page тестове.

### I.3 Отворени testing слабости

| ID | Severity | Находка |
| --- | :---: | --- |
| TEST-001 | P2 | 9 API attendance timeout mutants — mutation-induced full-file block; не са „killed“ чисто; timeout не е вдиган. Нужно отделно разследване на TAP/runner interaction. |
| TEST-002 | P2 | Full API mutation непрактичен при текущата DB serialization — няма baseline за целия `api/src`. |
| TEST-003 | P2 | Повечето web TSX нямат unit coverage под mutation runner — UI regressions разчитат на Playwright. |
| TEST-004 | P3 | Mutation CI е weekly/manual, non-blocking (`break: null`) — правилно за baseline; още няма regression gate. |
| TEST-005 | P3 | Няма lint script; CI API job на remote прави build+typecheck (smoke/E2E отделно) — локалният status показва по-пълни numbers от remote verification (remote не е инспектиран). |
| TEST-006 | Info | Потвърдени и оправени web дефекти по време на mutation work: unsafe `currentVersion` rebase; URL fallback leak на query/hash — добър пример за стойност на mutation. |

### I.4 Test pyramid (синтез от docs)

- API: голям unit + DB integration + scenario + cleaning lifecycle + smoke scripts.
- Web: ~112 unit (offline/policy/permissions тежки).
- E2E: Playwright main + scenarios (12 + 52 в report; status: 52 scenarios).
- Mutation: targeted CI; full ad-hoc.

**Оценка:** за домейн коректност pyramid-ът е **над средното** за продукт от този размер. Слабото място е UI component isolation и full-API mutation economics.

---

## J. Наблюдаемост, backup, incident response

| Област | Зрялост | Бележки |
| --- | :---: | --- |
| Metrics / alerts | Висока (config) | Ready alerts за API down, 5xx, DB, jobs, SSE, sync, backup stale |
| Dashboards | Средна | Grafana overview provisioning налично; невалидирано live |
| Backup | Средна→висока (design) | Hourly dump + age + S3; RPO≤15m изисква PITR/WAL — docs са честни |
| Restore | Висока (guards) | Disposable confirmation; още няма измерен drill в status |
| Incident runbook | Добра | Ясен triage ред; credentials hygiene; close criteria |
| External probes | Липсващи | Dead-man / uptime извън host — задължителни преди prod claim |

---

## K. Синтезирана risk register (активни)

| ID | Severity | Тип | Резюме | Препоръчан следващ ход |
| --- | :---: | --- | --- | --- |
| RISK-01 | **Blocker (ops)** | Deploy | Hardening не е commit-нат; remote release path недоказан | Commit/PR → CI green → publish images → staging deploy |
| RISK-02 | **Blocker (ops)** | Secrets/infra | DNS/TLS, DB роли, GH Environments, S3/age, alert webhook | Operator checklist от `deploy.md` + status §„Items requiring…“ |
| RISK-03 | **Blocker (ops)** | DR | Няма измерен restore drill / RTO | Staging restore + smoke + запис на време |
| RISK-04 | P2 | Scale | Single-replica invariants | Остани на 1 API до shared bus/locks; документирай в runbook |
| RISK-05 | P2 | Test | Attendance mutation timeouts | Минимална reproduction; не вдигай timeout „на сляпо“ |
| RISK-06 | P2 | Coverage | TSX NoCoverage | Фокусирани behavior тестове по mutation survivors map |
| RISK-07 | P2 | Ops | Digest-promotion vs accidental host build | Deployment tooling без `build` на prod |
| RISK-08 | P3 | Hygiene | Untracked mutation + mixed working tree | Раздели PR-и; review пълен `git status` |
| RISK-09 | P3 | DX | No lint gate | Добави ESLint/oxlint в CI когато е удобно |
| RISK-10 | Info | Consistency | Cleaning bypass = owner-only vs ticket role matrix | Domain review |

**Закрити в кода спрямо Oct 20 audit:** AUDIT-001, AUDIT-002, AUDIT-003.

---

## L. Готовност по фази

### L.1 Development / merge-ready (код)

| Критерий | Статус |
| --- | :---: |
| Критични audit bugs remediирани на `main` | ✅ |
| Силна concurrency/auth test evidence | ✅ (docs) |
| Targeted mutation ~99% | ✅ |
| Production packaging в working tree | ✅ (некомитнато) |
| Един чист release commit на remote | ❌ |

### L.2 Staging-ready

| Критерий | Статус |
| --- | :---: |
| Документиран deploy контракт | ✅ |
| Compose + images локално build-нати | ✅ (status) |
| Staging secrets/DNS/GHCR | ❌ operator |
| Staging smoke през Caddy (вкл. SSE/offline) | ❌ |
| Privilege-separated DB roles verified | ❌ |

### L.3 Production-ready

| Критерий | Статус |
| --- | :---: |
| Staging green + immutable digest promote | ❌ |
| Backup + restore drill measured | ❌ |
| Alert webhook + external uptime | ❌ |
| Initial owner one-shot + secret wipe | ❌ |
| Expand/contract миграционна дисциплина | ⚠️ процес (docs OK) |
| Multi-AZ / multi-replica API | ❌ (not designed yet) |

**Практическа препоръка:** третирай текущото състояние като **„staging candidate after commit“**, не като „production certified“.

---

## M. Препоръки (приоритизирани)

### P0 — преди първи staging с реални данни

1. Commit/PR на production-hardening + ops docs + mutation tooling с внимателен split и review.
2. Конфигурирай GitHub Environments, GHCR, deploy secrets; пусни CI + release publish за SHA.
3. Provision DB роли/grants и secrets от secret manager; deploy staging по `deploy.md`.
4. Изпълни пълния staging smoke (login/CSRF, SSE heartbeats, offline outbox during release, SW update).
5. Направи disposable restore drill; запиши RTO/RPO evidence.

### P1 — преди hotel production cutover

6. Потвърди alert webhook + dead-man; провери Grafana/Prometheus scrape.
7. Закрий всички „Final regression running“ редове в gap tracker с evidence.
8. Разследвай 9 attendance timeout mutants.
9. Добави минимален набор TSX/page тестове за най-рисковите NoCoverage модули (auth gates, offline queue UI).
10. Freeze API на 1 replica в runbook; план за shared job lease преди scale-out.

### P2 — качество / устойчивост

11. След няколко стабилни weekly mutation runs — обмисли non-blocking → soft regression threshold само за targeted scope.
12. Добави lint в CI.
13. Прегледай cleaning assignee bypass consistency спрямо ticket matrix.
14. Dependabot triage на 2 moderate findings.

---

## N. Заключение

Meridian Maintenance показва **висока инженерна зрялост в домейна**: concurrency, authorization, offline sync и тестова изолация са на ниво, което надхвърля типичното за mid-size operational SaaS prototype. Независимият bug audit от 20 Oct е адресиран на `main`. Production hardening пакетът (Compose, env guards, monitoring, backup, deploy workflows, mutation testing) е **съществен и добре документиран**, локално верифициран на 21 Oct, но все още **извън Git history** и **неизпълнен в реална staging/prod среда**.

Mutation testing дава **силна увереност за критичните pure-logic модули** и честно разкрива **широки UI coverage gaps**. Оперативният риск за go-live е предимно **organizational/infrastructure**, не „неизвестен P0 в cleaning/tickets“.

**Обща оценка:** **B+ / Staging-ready candidate** (след commit + operator checklist). **Не** „Production-certified“ докато RISK-01..03 не са затворени с evidence.

---

## O. Evidence index

| Артефакт | Път |
| --- | --- |
| Deploy contract | `docs/operations/deploy.md` |
| Hardening status | `docs/operations/status-2026-10-21.md` |
| Incident / DB recovery | `docs/operations/incident-response.md`, `docs/operations/db-recovery.md` |
| Mutation process | `docs/testing/MUTATION_TESTING.md` |
| Mutation results | `docs/testing/MUTATION_TESTING_REPORT.md` |
| Prior bug audit | `docs/audits/maintenance-independent-bug-audit.md` |
| Gap tracker | `docs/audits/remaining-gaps-progress.md` |
| Prod compose | `compose.prod.yml` |
| Env example | `.env.production.example` |
| CI / release / deploy / mutation workflows | `.github/workflows/*.yml` |
| Remediation commit | `8d4f146` |

---

*Този документ е само аналитичен артефакт. Не променя код, конфигурация, тестове или други файлове извън създаването на настоящия audit файл.*
