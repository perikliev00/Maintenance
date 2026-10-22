# Remediation: съществени тестови пропуски (одит 2026-10-22)

**Дата:** 22 октомври 2026  
**Източник на констатациите:** `docs/audits/test-coverage-gaps-audit-2026-10-22.md`  
**База за имплементация:** актуално локално работно дърво (без `git pull` / remote sync)  
**Commit не е създаден.**

---

## A. Резултати по констатации

### A.1 [High] `/sync/push` assignee authorization (AUDIT-003) — **RESOLVED**

| Поле | Съдържание |
| --- | --- |
| Първоначален проблем | REST assignee gate беше покрит; sync P1-104 упражняваше owner като assignee и не доказваше bypass / foreign denial през `/sync/push`. |
| Локално състояние | Production wiring вече подава `canBypassTicketAssignee(user.role)` в sync handlers (`api/src/services/sync/commands/tickets.ts`). Липсваше HTTP regression. |
| Промени | Добавен `api/tests/scenarios/sync.assignee.http.test.ts`. Production код **не** е променян (дефект не е възпроизведен). |
| Тестове | (1) Foreign technician → `forbidden`, ticket graph непроменен. (2) Manager bypass start/wait/resume/resolve → `ok` + resolved. (3) Assignee sync start → `ok` (non-bypass control). |
| Production дефект | Не. |
| Изпълнение | 3/3 passed (изолирана DB `maintenance_p1_test` на `127.0.0.1:5433`). |
| Остатъчен риск | За technician ролята denial обикновено идва от data-scope (`assigned_tickets`) преди assignee gate — тестът приема и двата `forbidden` message variant-а. Manager bypass е пряката AUDIT-003 защита. |

### A.2 [High] Offline `commandPayload` enrichment — **RESOLVED**

| Поле | Съдържание |
| --- | --- |
| Първоначален проблем | Drain извлича `ticketId`/`taskId`/`sessionId` от URL, но тестовете не assert-ваха push payload shape. |
| Локално състояние | `commandPayload` в `web/src/offline/queueDrain.ts` работи коректно за production URL shapes от `commands.ts`. |
| Промени | Разширен `web/src/offline/queueDrain.test.ts` с suite „drainQueue commandPayload URL enrichment“ (captured `/sync/push` body). Production код **не** е променян. |
| Тестове | ticketId enrichment; cleaning taskId/sessionId; запазване на body + query/hash strip; ticket.report / unsupported URL без измислен ticketId. |
| Production дефект | Не. |
| Изпълнение | 11/11 в `queueDrain.test.ts`; пълен web suite **116/116** passed. |
| Остатъчен риск | Naive `split` parser остава (за разлика от по-строгия `conflict.ts` URL parser). Покритието хваща регресии в текущия contract; екзотични URL shapes извън builders не са hardening цел тук. |

### A.3 [Medium] Production `assertEnv()` fail-closed — **RESOLVED**

| Поле | Съдържание |
| --- | --- |
| Първоначален проблем | Само E2E rate-limit + PORT (+ JWT insecure в `security.http.test.ts`) бяха покрити; останалите production откази — не. |
| Локално състояние | `api/src/env.ts` вече съдържа пълната fail-closed матрица. |
| Промени | Разширен `api/src/env.test.ts`: `withEnv` isolation, валиден positive control, table-driven rejections (DATABASE_URL, WEB_ORIGIN empty/HTTP/mixed, TRUST_PROXY, JWT `demo`, COOKIE_SECURE=false). Запазени съществуващите JWT/E2E кейсове. Production политика **не** е разхлабена. |
| Production дефект | Не. |
| Изпълнение | 11/11 passed. |
| Остатъчен риск | Нисък; child-process smoke за HTTPS/TRUST_PROXY (като P1-128 за JWT) не е добавен — unit покритието е достатъчно за тези синхронни checks. |

### A.4 [Medium] `POST /jobs/run` shared lock — **RESOLVED**

| Поле | Съдържание |
| --- | --- |
| Първоначален проблем | `executionLock` unit + scheduler бяха покрити; HTTP wiring / 409 в контролера — не. |
| Локално състояние | `controllers/jobs.ts` вече ползва `runWithJobExecutionLock` и връща `job_already_running`. |
| Промени | Добавен `api/tests/scenarios/jobs.run.http.test.ts`: държи lock с deferred promise → concurrent POST → 409; след release → 200 с `{ flagged }`; housekeeper без `jobs.view` → 403. |
| Production дефект | Не. |
| Изпълнение | 2/2 passed. |
| Остатъчен риск | Lock е in-process (by design); multi-replica не е покрит и не е цел на тази констатация. |

---

## B. Валидация

### Изпълнени команди (доказателства)

```text
# API (с override към локалния Docker Postgres на :5433 — .env.p1_test сочи към недостъпен :55439)
$env:P1_TEST_DATABASE_URL='postgresql://maintenance:maintenance@127.0.0.1:5433/maintenance_p1_test?schema=public&connection_limit=20'
node ./tests/runWithP1Isolation.mjs --test-concurrency=1 `
  src/env.test.ts `
  tests/scenarios/sync.assignee.http.test.ts `
  tests/scenarios/jobs.run.http.test.ts `
  tests/scenarios/sync.http.test.ts
# → 23/23 passed

npx tsc --noEmit -p tsconfig.tests.json
npx tsc --noEmit
# → exit 0 (след премахване на невалидно ticket.version assertion)

# Web
npx tsx --test src/offline/queueDrain.test.ts   # 11/11
npm test                                        # 116/116
npx tsc --noEmit -p tsconfig.tests.json         # ok
```

### Резултати

| Suite | Резултат |
| --- | --- |
| `api/src/env.test.ts` | 11/11 pass |
| `api/tests/scenarios/sync.assignee.http.test.ts` | 3/3 pass |
| `api/tests/scenarios/jobs.run.http.test.ts` | 2/2 pass |
| `api/tests/scenarios/sync.http.test.ts` (regression) | 7/7 pass |
| `web/src/offline/queueDrain.test.ts` | 11/11 pass |
| Web full unit suite | 116/116 pass |
| API / Web typecheck (tests + main) | pass |

### Пропуснати / ограничения

- Пълен API `npm test` / E2E Playwright **не** са пускани в тази сесия (време + обхват); релевантните sync/jobs/env/web offline suites са валидирани.
- `api/.env.p1_test` сочи към `127.0.0.1:55439` (недостъпен). Използван е `P1_TEST_DATABASE_URL` → Docker `maintenance-db-1` на **5433** / DB `maintenance_p1_test` (същият подход като в `docs/operations/status-2026-10-21.md`). `.env` / `.env.p1_test` **не** са редактирани.
- Lint scripts липсват в api/web package.json — не са изпълнявани.

### Файлове, пипани в тази задача

| Файл | Действие |
| --- | --- |
| `api/tests/scenarios/sync.assignee.http.test.ts` | нов |
| `api/tests/scenarios/jobs.run.http.test.ts` | нов |
| `api/src/env.test.ts` | разширен (вече беше untracked локално) |
| `web/src/offline/queueDrain.test.ts` | разширен |
| `docs/audits/test-coverage-gap-remediation-2026-10-22.md` | нов (този отчет) |

Няма промени по production runtime код. Съществуващите локални uncommitted промени извън горния списък са запазени.

---

## C. Заключение

| Констатация | Статус |
| --- | :---: |
| 3.1 Sync assignee / AUDIT-003 | **RESOLVED** |
| 3.2 Offline commandPayload enrichment | **RESOLVED** |
| 3.3 Production assertEnv matrix | **RESOLVED** |
| 3.4 POST /jobs/run lock HTTP | **RESOLVED** |

Четирите одитни пропуска имат адекватни автоматизирани regression тестове; тестовете са реално изпълнени и преминават. Не са открити и коригирани production дефекти в актуалния локален код — пропуските бяха в **покритието**, не в текущата authorization/lock/env/drain логика.

---

*Край на отчета.*
