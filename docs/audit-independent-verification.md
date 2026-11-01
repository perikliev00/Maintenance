# Независима форензична проверка — модул „Одит лог“

**Дата:** 31 октомври 2026  
**Проект:** `C:\Users\Admin\Desktop\maintenance`  
**Git baseline (committed):** `2b2aa00` (`main`, clean build)  
**Работно дърво:** мръсно (много паралелни непрокарани промени извън Одит)  
**Оригинален одит:** `C:\Users\Admin\Documents\Codex\2026-10-29\files-mentioned-by-the-user-codex-7\outputs\Одит-лог-ръководство-и-технически-одит.md`  
**Ремонтен отчет (не е приет за доказателство):** `docs/audit-remediation-report.md`  

**Ограничение:** Оригиналният одит **не е в хранилището**; използван е единственият намерен екземпляр под Documents/Codex. В проекта липсва копие.

**Метод:** независима реконструкция на изискванията → code review → изпълнение на тестове в `maintenance_p1_test` → mutation probes във временни копия / restore → git worktree проверка на HEAD builds. Production код **не е поправян** (освен кратък mutation restore на `ticketSlaBreach.ts`, потвърден с `RESTORE_OK`).

---

## 1. Executive verdict

### Вердикт: **PASS_WITH_RISKS**

**Критерии:**

| Вердикт | Кога |
|---|---|
| PASS | 10/10 VERIFIED end-to-end, няма материални остатъчни рискове, builds зелени |
| **PASS_WITH_RISKS** | **Първопричините на BUG-01..10 са адресирани в кода; тестовете + mutations подкрепят критичните пътища; остават документирани gaps (DOM/E2E, исторически null, multi-process, live `permissions.changed`)** |
| FAIL | Поне един от 10-те дефекта все още се възпроизвежда в текущия код |
| INCONCLUSIVE | Ключови проверки не могат да се изпълнят |

**Защо не PASS:** липсват React DOM и Playwright E2E за `AuditPage`; историческите `locationId = null` не са backfill-нати; multi-process job recovery остава рисков; live refresh не слуша `permissions.changed`; ремонтният отчет **грешно** класифицира web build failure като pre-existing спрямо git HEAD.

**Защо не FAIL:** за всеки от оригиналните BUG-01..10 има възпроизводимо доказателство, че описаната първопричина е премахната в текущия код, подкрепено с преминали тестове и/или чувствителни mutation failures.

---

## 2. Независима оценка на 10-те дефекта

Легенда статуси: **VERIFIED** / **PARTIAL** / **FAILED** / **NOT VERIFIED**.

### BUG-01 — `locationId` / sector scope / own vs foreign

| Поле | Оценка |
|---|---|
| Очаквано | SLA/overdue одитни редове с известно помещение да са видими под sector/location scope; чуждите — скрити |
| Поправка | `ticketSlaBreach.ts` и `overdueSessions.ts` подават `locationId`, `summary`, богато `after`; SLA под `FOR UPDATE` + re-check |
| Положително | DB: own SLA видим; foreign скрит (`audit.sla-scope.db.test.ts`); jobs.db asserts `locationId`/summary за SLA и overdue |
| Отрицателно / concurrency | Concurrent SLA → един marker (`jobs.db.test.ts`); mutation: премахнат `locationId` → **sla-scope FAIL** |
| Тестова чувствителност | Висока за SLA scope; overdue scope през `listAuditEvents` **не** е отделен тест (само assert на записан `locationId`) |
| Остатъчен риск | Исторически редове с `locationId = null` остават невидими; multi-process SLA без unique constraint |
| **Статус** | **VERIFIED** (нови записи); исторически — **PARTIAL** |

### BUG-02 — race / overlapping refresh / stale apply

| Поле | Оценка |
|---|---|
| Очаквано | Стар HTTP отговор да не презаписва по-ново поколение филтри/load |
| Поправка | `refreshGen` + `shouldApplyAuditRefresh` в `AuditPage` / `auditPageLogic`; busy flags само за latest gen |
| Wiring | `AuditPage.tsx` реално импортира и ползва helper-ите (code review) |
| Тест | `auditPageLogic.test.ts` — обърнат ред old/new |
| Mutation | `shouldApply` → always `true` → тест **FAIL** (остава `old-filter`) |
| Остатъчен риск | Няма React DOM тест; unmount без abort (P3) |
| **Статус** | **VERIFIED** на helper + wiring; UI DOM — **NOT VERIFIED** |

### BUG-03 — refresh error / offline recovery / banner

| Поле | Оценка |
|---|---|
| Очаквано | Ръчно „Обнови“ чисти/задава error; recovery маха банера |
| Поправка | Общ `load()`: `setError(null)` → settle → `formatAuditLoadErrors`; бутон disabled докато busy |
| Тест | Recovery матрица в `auditPageLogic.test.ts` |
| Бележка | SSE callback има празен `catch`, но `load()` **не хвърля** при HTTP settle failure — банерът пак се сетва през `setError` |
| Остатъчен риск | Няма DOM тест за реален бутон/banner |
| **Статус** | **VERIFIED** (logic + wiring); browser — **NOT VERIFIED** |

### BUG-04 — независим audit vs jobs failure

| Поле | Оценка |
|---|---|
| Очаквано | Успехът на едната секция да не зависи от другата |
| Поправка | Паралелни `settleAuditFetch` + `combineAuditLoadResults` (post-prior-audit hardening запазен) |
| Тест | jobs fail / audit fail матрица — PASS |
| Остатъчен риск | При fail на events старите `rows` остават (banner + stale table) — UX tradeoff, не оригиналния all-or-nothing bug |
| **Статус** | **VERIFIED** |

### BUG-05 — nested JSON diff

| Поле | Оценка |
|---|---|
| Очаквано | Без `[object Object]`; nested keys, arrays, null, removed |
| Поправка | `appendDiffLines` + `JSON.stringify` fallback в `formatScalar` |
| Тест | `labels.test.ts` — PASS |
| Mutation | `JSON.stringify` → `String(value)` → тест **FAIL** |
| Остатъчен риск | Depth cap 6; няма DOM render тест |
| **Статус** | **VERIFIED** (formatter) |

### BUG-06 — `location.changed` → UI refresh

| Поле | Оценка |
|---|---|
| Очаквано | Producer публикува; Audit page слуша; UI refetch |
| Поправка | `AUDIT_PAGE_LIVE_EVENTS` включва `location.changed`; producers в `locations/crud.ts` и др.; client allowlist в `liveEvents.ts` |
| Тест | Contract membership only (`auditLiveEvents.test.ts`) |
| E2E | **Не изпълнен** — няма Playwright сценарий за Audit page |
| **Статус** | **PARTIAL** (wiring VERIFIED by code; browser delivery **NOT VERIFIED**) |

### BUG-07 — `jobs.changed` start/finish/failure/delivery/UI

| Поле | Оценка |
|---|---|
| Очаквано | Приключване (и ideally start) на JobRun да обновява панела |
| Поправка | `publish("jobs.changed", {})` в `startJobRun`, `finishJobRun`, `abandonStaleRunningJobRuns`; authorize always-deliver; web allowlist; Audit subscription |
| Тест | `runLifecycle.test.ts` (finish + abandon); authorize unit |
| Gap | Няма изолиран assert само за **start** publish (тестът вижда ≥1 след start+finish) |
| UI | Без DOM/E2E |
| **Статус** | **PARTIAL** → близо до VERIFIED за bus/API; UI **NOT VERIFIED** |

### BUG-08 — SLA identity / summary / permissions

| Поле | Оценка |
|---|---|
| Очаквано | Две SLA повреди да са различими; summary/room/title |
| Поправка | Server summary + `after.title/locationNumber/ticketId`; UI `auditHeadline` + `formatAuditRelated` |
| Тест | Unit + DB summary asserts |
| Остатъчен риск | Няма deep-link; summary текстът от jobs е EN; permissions за четене са отделни от identity |
| **Статус** | **VERIFIED** спрямо оригиналния P2 scope (различимост); deep-link извън минималния fix |

### BUG-09 — филтри vs producers

| Поле | Оценка |
|---|---|
| Очаквано | Филтрите да покриват реалните producers |
| Поправка | `filtersFromLabels` + разширени ACTION/ENTITY maps |
| Тест | Checklist в `labels.test.ts` (не генерация от всички `recordAudit` call sites) |
| Бележка | Някои filter keys съществуват главно в seed (`invitation.revoke`, `task.rework`, …) — излишъкът не е дефект |
| **Статус** | **VERIFIED** за оригиналния gap list; drift risk → **PARTIAL** (потвърдено: жив producer `sector.save` липсва от филтрите — NEW-07) |

### BUG-10 — локализация `stale_open_attendance`

| Поле | Оценка |
|---|---|
| Очаквано | BG етикет + четим summary |
| Поправка | `JOB_KEY_LABELS` + `formatJobSummary` |
| Тест | `labels.test.ts` — PASS |
| **Статус** | **VERIFIED** |

### Обобщение

| BUG | Статус |
|---|---|
| 01 | VERIFIED (new) / PARTIAL (history) |
| 02 | VERIFIED (logic+wiring) |
| 03 | VERIFIED (logic+wiring) |
| 04 | VERIFIED |
| 05 | VERIFIED |
| 06 | PARTIAL |
| 07 | PARTIAL |
| 08 | VERIFIED |
| 09 | VERIFIED / PARTIAL (drift) |
| 10 | VERIFIED |

---

## 3. Новооткрити дефекти / несъответствия

### NEW-01 — Web `tsc` failure **не** е pre-existing спрямо git HEAD

- **Severity:** P1 (release / докладна точност; блокира `web` build в текущото дърво)
- **Файлове:** `web/src/pages/PermissionsPage.tsx:203` (`reloadOnConflict: () => refresh(role)` връща `Promise<PermissionMatrix>` вместо `Promise<void>` per `permissionsSaveFlow.ts`)
- **Първопричина:** Непрокарана Permissions refactor в working tree; **не** AuditPage промените
- **Доказателство:** Detached HEAD worktree `2b2aa00` → `web npm run build` **EXIT 0**. Working tree → **TS2322** на ред 203
- **Expected (remediation report):** „pre-existing“  
- **Actual:** Въведено в dirty tree след HEAD; HEAD е чист
- **Въздействие:** Невалидира твърдението в ремонтния отчет; блокира пълния frontend release gate
- **Корекция:** `reloadOnConflict: async () => { await refresh(role); }` (или промяна на типа)
- **Тест:** `npm run build` в CI на чисто дърво
- **Увереност:** Висока

### NEW-02 — API `tsc` failure в working tree (извън Одит)

- **Severity:** P1 (текущо дърво)
- **Файлове:** `api/src/controllers/locations.ts:97`, `:100` (`LocationForMap` vs Prisma select без `floor`)
- **Доказателство:** HEAD API build **EXIT 0**; WT `npm run build` → TS2345
- **Въздействие:** Ремонтният отчет твърди API build OK — вярно за audit-era момент / HEAD, **не** за текущото dirty tree
- **Увереност:** Висока

### NEW-03 — Audit page не слуша `permissions.changed`

- **Severity:** P2
- **Файлове:** `api/src/services/roleGrants/replace.ts` (publish); `web/src/pages/auditPageLogic.ts` (`AUDIT_PAGE_LIVE_EVENTS` без `permissions.changed`); `AuditPage.tsx`
- **Първопричина:** Live allowlist на Audit page не включва permission grant events
- **Стъпки:** Отворен Audit; друга сесия променя role grants; без ръчно refresh / друг event тип таблицата остава стара
- **Expected:** Live refresh при permission audit writes (както при people/settings)
- **Actual:** Само manual refresh или страничен event
- **Въздействие:** Закъсняла видимост на permission audit редове
- **Корекция:** Добавяне на `permissions.changed` към `AUDIT_PAGE_LIVE_EVENTS` + contract тест
- **Увереност:** Висока (код); browser — не пуснат

### NEW-04 — Failed events refetch запазва stale rows

- **Severity:** P3 (UX)
- **Файлове:** `AuditPage.tsx` (`if (combined.events !== undefined) setRows`)
- **Поведение:** Banner показва грешка, но старата таблица остава
- **Въздействие:** Потребителят може да мисли, че видимите редове са свежи
- **Корекция:** Ясен stale индикатор или изчистване при hard failure на initial load
- **Увереност:** Висока (code)

### NEW-05 — `jobs.view` = list **и** manual trigger

- **Severity:** P2 (permission model / policy) — **потенциален риск**, не ново експлоатиране от ремонта
- **Файлове:** `api/src/routes/jobs.ts` — GET `/runs` и POST `/run` с `requireAction("jobs.view")`
- **Въздействие:** Всеки с преглед на job history може да стартира background jobs
- **Препоръка:** Отделен `jobs.run` action, ако политиката изисква least privilege
- **Увереност:** Висока (код); дали е intentional — неизвестно без product spec

### NEW-06 — Липса на DOM/E2E за Audit page (покритие, не runtime bug)

- **Severity:** P2 (verification gap)
- **Доказателство:** Няма `AuditPage*.test.tsx`; Playwright `e2e` няма сценарий за страницата „Одит лог“ (има само `location-audit` UI harness)
- **Въздействие:** Wiring regressions възможни въпреки зелени helper тестове

### NEW-07 — Жив producer `sector.save` липсва от audit filter/label каталога

- **Severity:** P3 (UX / filter completeness; разширение на BUG-09 drift)
- **Файлове:** `api/src/services/sectors/commands.ts` (action `sector.save` когато се подават `locationIds`); `web/src/audit/labels.ts` (`ACTION_LABELS` / `AUDIT_ACTION_FILTERS` имат `sector.locations.set`, **не** `sector.save`)
- **Първопричина:** UI каталогът и server action string са разминати; checklist тестът в `labels.test.ts` не извежда actions от producers
- **Expected:** Филтър/етикет за реално записвания action (или server да емитира ключа от каталога)
- **Actual:** Редовете се рендерират през `humanizeKey("sector.save")`; dropdown филтърът не може да избере точния action
- **Въздействие:** Непълно филтриране на sector location saves; не връща BUG-01..10
- **Корекция:** Добави `sector.save` към labels/filters **или** преименувай producer към съществуващия ключ; разшири теста да fail-ва при producer∉filters
- **Увереност:** Висока (код); открито при follow-up security преглед ([Audit security boundaries](702abff4-dd5c-403d-bc7d-94fecc42105b))

---

## 4. Test evidence

### Изпълнени команди (този одит)

| Команда | Среда | Резултат |
|---|---|---|
| `cd web && npm test` | local | **285 pass / 0 fail / 0 skip** |
| `cd api && node ./tests/runWithP1Isolation.mjs --test-concurrency=1 src/services/audit.scope.test.ts src/services/jobs/runLifecycle.test.ts src/events/authorizeLiveEvent.test.ts tests/scenarios/jobs.db.test.ts tests/scenarios/audit.sla-scope.db.test.ts` | `maintenance_p1_test` @ `127.0.0.1:5433` | **27 pass / 0 fail** |
| Повторно `jobs.db.test.ts` след mutation restore | същата | **8 pass / 0 fail** |
| `cd web && npm run build` (WT) | local | **FAIL** TS2322 `PermissionsPage.tsx:203` |
| Detached HEAD worktree `web npm run build` | `2b2aa00` | **PASS** |
| `cd api && npm run build` (WT) | local | **FAIL** TS2345 `locations.ts` |
| Detached HEAD worktree `api npm run build` | `2b2aa00` | **PASS** |
| `cd api && npm run lint` | local | **PASS** (oxlint) |
| Playwright Audit page E2E | — | **НЕ ПУСНАТ** (няма подходящ spec; dev сървър на seed не е използван за мутации) |
| React DOM / Testing Library за `AuditPage` | — | **НЕ ПУСНАТ** (липсват тестове) |

### Mutation probes (изолирани; production restored)

| Mutation | Резултат |
|---|---|
| A: `shouldApplyAuditRefresh` always `true` | **FAIL** (stale overwrite) — тестът е чувствителен |
| B: `formatScalar` → `String(value)` | **FAIL** (`[object Object]`) — чувствителен |
| C: премахнат `locationId` от SLA `recordAudit` | **FAIL** `audit.sla-scope.db.test.ts` — чувствителен; файл **RESTORE_OK** |

### Потвърдени assertions (извадка)

- Own-room SLA в `listAuditEvents({ scopeLocationIds: [A] })`; foreign липсва
- Overdue/SLA audit rows имат `locationId` + summary в `jobs.db.test.ts`
- Concurrent SLA → `rows.length === 1`
- Partial settle: jobs 403 запазва events
- Nested settings diff без `[object Object]`
- `jobs.changed` / `location.changed` в allowlists и Audit live list
- `stale_open_attendance` BG label + scanned/flagged summary

### Непуснати тестове

- Playwright срещу Audit page (липсва spec; изолацията изисква отделен webServer — не е стартиран за този одит)
- Component/DOM тестове за `AuditPage`
- Multi-process scheduler / bus
- Backfill verification за исторически null `locationId`

---

## 5. Coverage gaps

| Requirement | Risk | Existing test | Actual assertions | Gap | Required type | Priority |
|---|---|---|---|---|---|---|
| SLA own/foreign scope | High | `audit.sla-scope.db.test.ts` | listAuditEvents filters | — | DB | — |
| Overdue scope via list API | High | jobs.db `locationId` only | row field, not scoped list | Own/foreign overdue list | DB | P1 |
| Filter race in React | High | `auditPageLogic` | pure gen | Component mount/unmount + setState | DOM | P0 |
| Refresh banner UX | Med | helper recovery | no button/DOM | Playwright / RTL | E2E/DOM | P1 |
| Partial API failure UI | High | helpers | no DOM | RTL | DOM | P1 |
| Nested details UI | Med | labels unit | no expand click | RTL | DOM | P2 |
| location.changed E2E | Med | contract membership | no SSE browser | Playwright 2-session | E2E | P1 |
| jobs.changed start publish | Med | finish/abandon | start not isolated | Unit | Unit | P2 |
| jobs.changed UI panel | Med | bus unit | no UI | E2E | E2E | P1 |
| SLA identity UI | Med | formatters + DB | no table render | DOM | DOM | P2 |
| Filter vs all producers | Low | fixed checklist | misses live `sector.save` (NEW-07) | Generator/CI check + label for `sector.save` | Unit | P2 |
| Historical null locationId | Med | scope unit null exclusion | no backfill | Migration + DB | DB | P1 |
| Multi-process abandon | Med | single-process DB | — | Architecture test / doc | Arch | P1 |
| permissions.changed live | Med | — | missing subscription | Contract + E2E | Unit/E2E | P2 |
| XSS of summaries | Low | React text nodes (review) | no adversarial string test | Security unit | Sec | P3 |
| jobs.view vs jobs.run | Med | HTTP jobs lock tests | no least-privilege split | Policy + HTTP | Sec | P2 |

---

## 6. Regression & Security assessment

### Регресии (засегнати модули)

| Модул | Проверка | Резултат |
|---|---|---|
| Background jobs / SLA / overdue | `jobs.db.test.ts` пълен | PASS |
| Audit scope predicate | `audit.scope.test.ts` | PASS |
| SSE authorize | `authorizeLiveEvent.test.ts` | PASS |
| Web suite | 285 tests | PASS |
| Cleaning / tickets / notifications | покрити индиректно през jobs scenarios | PASS в jobs suite |
| API/Web typecheck (WT) | `tsc` | **FAIL** (не от Audit файлове; concurrent dirty tree) |
| API/Web typecheck (HEAD) | worktree | **PASS** |
| Backward compatibility | `/audit` + `/audit-events` alias; `jobs.changed` empty payload | запазени |

### Security

| Тема | Находка |
|---|---|
| AuthZ `/audit`, `/audit-events` | `requireAuth` + controller gates (`audit.view` / `settings.manage` / `permissions.manage`; location filter + `operations.view_live`) + DataScope |
| Sector leakage | Scope predicate изключва чужди `locationId` и null non-sector — BUG-01 fix намалява false negatives, не увеличава leakage |
| SSE `jobs.changed` | Delivered to all authed subscribers; payload `{}` — **няма metadata leak**; предизвиква refetch само на вече отворени live pages |
| `jobs.view` → POST `/run` | Потвърден policy risk (NEW-05); seed grants само manager/admin |
| JSON/summary XSS | React text children — safe by default; няма `dangerouslySetInnerHTML` в Audit details |
| Concurrent locking | Ticket `FOR UPDATE` + revalidation — ефективно в single DB; multi-instance app lock остава in-process |
| Job recovery | `abandonStaleRunningJobRuns` OK за single-process; опасно при multi-instance |
| SSE `jobs.changed` без `jobs.view` | Empty payload; все пак тригерира audit refetch (timing side channel, Low) |
| Cross-sector list | Scope HTTP + DB tests: supervisor чужди rooms блокирани; `kind=all` вижда всичко by design |

---

## 7. Production readiness

### Оценка: **NOT_READY** (за текущото working tree като release candidate)

**Блокиращи условия:**

1. `web npm run build` FAIL (`PermissionsPage.tsx:203`) — NEW-01  
2. `api npm run build` FAIL (`locations.ts`) — NEW-02  
3. Липса на browser E2E за Audit live/filter/refresh — приемливо като **условие**, не като абсолютен блокер само за Одит, но намалява увереността  

### Ако се изолират само Audit remediation промените върху чист HEAD build:

### **READY_WITH_CONDITIONS**

Условия:

1. Документиран residual: исторически `locationId = null` без backfill  
2. Single-process (или еквивалентен) deployment assumption за scheduler/job lock  
3. Приемане на липса на Playwright за Audit page **или** добавяне преди GA  
4. Поправка на NEW-03 (`permissions.changed`) преди „пълна live audit“ claim  

---

## 8. Prioritized remediation backlog

### Задължителни преди production (на текущото dirty tree)

1. **Fix NEW-01** — PermissionsPage `reloadOnConflict` тип/`await`  
2. **Fix NEW-02** — locations controller typing / include `floor`  
3. Потвърди `npm run build` за `api` и `web` на кандидата за release  

### Важни, неблокиращи за самия Одит fix

4. Playwright E2E: отваряне, филтри, refresh, offline recovery, location change от друга сесия, job finish  
5. React DOM тестове за `AuditPage` wiring (gen race, partial failure, banner)  
6. NEW-03: `permissions.changed` в `AUDIT_PAGE_LIVE_EVENTS` + тест  
7. Overdue scoped `listAuditEvents` DB тест (mirror на SLA)  
8. Изолиран тест: `startJobRun` публикува `jobs.changed`  
9. Документирай/изпълни политика за historical null `locationId` (backfill или accepted loss)  

### Допълнителен hardening

10. Разделяне `jobs.view` / `jobs.run` (NEW-05)  
11. Multi-instance job lock / abandon strategy  
12. Stale-table UX при failed events refresh (NEW-04)  
13. **NEW-07:** `sector.save` в labels/filters (или rename producer) + generator тест producer⊆filters  
14. Unique DB constraint или по-силна идемпотентност за SLA markers  

---

## 9. Специална оценка на 6-те документирани риска

| # | Риск | Действително | Вероятност × impact | Клас | Блокира prod? |
|---|---|---|---|---|---|
| 1 | Няма Playwright E2E | Потвърдено; e2e няма Audit page flow | Med × Med | Gap / limitation | Не сами по себе си; намалява увереност |
| 2 | Няма React DOM тестове | Потвърдено; само helpers + code review | Med × Med | Gap | Не |
| 3 | Исторически `locationId = null` | Scope predicate все още ги крие | High × Med (legacy) | Accepted limitation / data debt | Само ако legacy SLA visibility е задължителна |
| 4 | Multi-process `abandonStaleRunningJobRuns` | Кодът updateMany-ва всички `running` | Low–Med × High | Architecture risk | Да, ако >1 API instance без distributed lock |
| 5 | SSE broadcast `jobs.changed` | Always deliver; empty payload; UI gated | High × Low | Acceptable risk | Не (няма payload leak) |
| 6 | Frontend TS build | **Не** pre-existing vs HEAD; WT broken | High × High | **Confirmed defect in WT** | **Да** |

### Допълнителни недокументирани в ремонтния отчет

- NEW-03 `permissions.changed` live gap  
- NEW-02 API build break в WT  
- NEW-07 `sector.save` filter/label drift  
- Неточна класификация „pre-existing“ за web build  

---

## 10. Независимост спрямо предишния субагент

Предишният независим агент ([Independent audit validation](db5711fc-cacc-47e3-bb41-93a1f55d5a5d)) даде **PASS_WITH_RISKS**. Този одит **запазва същия клас вердикт за 10-те BUG-а**, но:

- **не** наследява автоматично PASS за post-audit hardening — паралелният settle и `jobs.changed` на start са **препроверени в кода**; start publish остава слабо тестван  
- открива **фалшиво „pre-existing“ build** твърдение спрямо git HEAD  
- добавя NEW-03..NEW-07  
- follow-up: [Find original audit doc](b12052b1-e402-4a1d-bb93-730515be59d3), [Explore audit BUG fixes](0c5bff19-cccb-4684-913a-f511512e8385), [Audit security boundaries](702abff4-dd5c-403d-bc7d-94fecc42105b)  

---

## 11. Заключение

Ремонтът на модула „Одит“ **действително адресира първопричините** на BUG-01..10 в текущия код. Критичните DB/unit пътища минават; mutation probes показват, че ключовите тестове **биха хванали рецидив**.  

Останалите рискове са главно **verification gaps**, **deployment assumptions** и **concurrent dirty-tree build breaks**, не връщане на оригиналните 10 дефекта.  

**Финал:** **PASS_WITH_RISKS** за одитния ремонт; **NOT_READY** за production deploy на текущото working tree докато NEW-01/NEW-02 не са оправени и release gates не са зелени.

---

## 12. Follow-up remediation

Подробности: [`docs/audit-remediation-followup.md`](./audit-remediation-followup.md).

| ID | Статус |
|---|---|
| NEW-01 | **DONE** — PermissionsPage `reloadOnConflict` |
| NEW-02 | **DONE / N/A** — API build зелен |
| NEW-03 | **DONE** — `permissions.changed` live |
| NEW-04 | **DONE** — stale/clear events UX |
| NEW-05 | **DONE** (01.11) — `jobs.run` отделен от `jobs.view` |
| NEW-06 | **DONE** (01.11) — Playwright `audit-page-smoke.spec.ts` |
| NEW-07 | **DONE** — `sector.save` labels/filters |
| Overdue scope DB | **DONE** |
| `startJobRun` publish | **DONE** |
| Historical null `locationId` | **DONE** (01.11) — SQL migration + `backfillAuditLocationIds` |
| Multi-process job lock/abandon | **DONE** (01.11) — PG advisory lock + 30m stale TTL |
| Producer ⊆ filters | **DONE** (01.11) — `KNOWN_AUDIT_PRODUCER_ACTIONS` / `REQUIRED_AUDIT_PRODUCER_ACTIONS` |

**Gates (01.11):** api/web lint+build PASS; web 292/292; audit API suite **37/37**; e2e audit smoke **1/1**.

**Readiness:** **READY** спрямо verification backlog (няма отворени NEW/residual точки).
